//! Application drafting and submission service.
//!
//! Key: ApplicationService — trait exposing `draft` and `submit`
//! Key: ApplicationServiceImpl::draft — composes job + profile + CV into a tailored cover letter via AI, persists `application_drafts`
//! Key: ApplicationServiceImpl::submit — enforces per-URL `application_url_locks`, records `application_runs`, enqueues the `apply_job` task
//! Key: contact_fact_answers — builds deterministic form answers from `profile_facts` + variant `ContactInfo`
//! Key: map_answers — remaps a draft's `{question, answer}` pairs into the `{label, value}` shape the browser task expects

use std::path::PathBuf;

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::ai::prompt::{
    draft_prompt, draft_system, parse_draft, DraftInput, DRAFT_PROMPT_VERSION,
};
use crate::ai::{complete_cached, input_hash, select_provider_resolved};
use crate::cv::{self, DocKind};
use crate::domain::ai::CompletionRequest;
use crate::storage::settings::load_ai_providers;
use crate::util::now_iso;

#[allow(async_fn_in_trait)]
pub trait ApplicationService: Send + Sync {
    async fn draft(&self, job_match_id: &str) -> DomainResult<String>;
    async fn submit(&self, application_draft_id: &str) -> DomainResult<String>;
}

pub struct ApplicationServiceImpl {
    db: SqlitePool,
    cv_files_dir: PathBuf,
}

impl ApplicationServiceImpl {
    pub fn new(db: SqlitePool, cv_files_dir: PathBuf) -> Self {
        Self { db, cv_files_dir }
    }

    async fn cv_text(&self, cv_document_id: &str) -> DomainResult<(String, String)> {
        let (file_type, file_hash, stored_path): (String, String, String) = sqlx::query_as(
            "SELECT file_type, file_hash, stored_path FROM cv_documents WHERE id = ?1",
        )
        .bind(cv_document_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| {
            DomainError::InvalidInput(format!("unknown cv_document: {cv_document_id}"))
        })?;

        let kind = match file_type.as_str() {
            "pdf" => DocKind::Pdf,
            "docx" => DocKind::Docx,
            other => {
                return Err(DomainError::InvalidInput(format!(
                    "unsupported stored file type: {other}"
                )))
            }
        };
        let _ = &self.cv_files_dir;
        let bytes = std::fs::read(&stored_path)
            .map_err(|e| DomainError::InvalidInput(format!("read {stored_path}: {e}")))?;
        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse cv document: {e}")))?;
        Ok((parsed.text, file_hash))
    }
}

impl ApplicationService for ApplicationServiceImpl {
    async fn draft(&self, job_match_id: &str) -> DomainResult<String> {
        let (job_id, profile_id, cv_document_id, role_variant_id): (
            String,
            String,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT job_id, profile_id, cv_document_id, role_variant_id
             FROM job_matches WHERE id = ?1",
        )
        .bind(job_match_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("unknown job_match: {job_match_id}")))?;

        let (title, company, location, description, content_hash): (
            String,
            String,
            Option<String>,
            String,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT title, company, location, description, content_hash
             FROM job_posts WHERE id = ?1",
        )
        .bind(&job_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("unknown job_post: {job_id}")))?;

        let (display_name, profile_summary): (String, Option<String>) =
            sqlx::query_as("SELECT display_name, summary FROM profiles WHERE id = ?1")
                .bind(&profile_id)
                .fetch_optional(&self.db)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("unknown profile: {profile_id}"))
                })?;

        let variant: Option<(String, Option<String>, Option<String>)> =
            match &role_variant_id {
                Some(vid) => sqlx::query_as(
                    "SELECT target_title, headline, summary FROM profile_variants WHERE id = ?1",
                )
                .bind(vid)
                .fetch_optional(&self.db)
                .await?,
                None => None,
            };
        let variant_target: Option<String> = variant.as_ref().map(|(target, headline, _)| {
            headline
                .as_deref()
                .filter(|h| !h.trim().is_empty())
                .unwrap_or(target)
                .to_string()
        });
        let candidate_summary: Option<String> = variant
            .as_ref()
            .and_then(|(_, _, s)| s.clone())
            .or(profile_summary);

        let (cv_text, cv_hash): (Option<String>, Option<String>) = match &cv_document_id {
            Some(cid) => {
                let (text, hash) = self.cv_text(cid).await?;
                (Some(text), Some(hash))
            }
            None => (None, None),
        };

        let (hr_name_owned, hr_link_owned): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT hr_name, hr_link
             FROM automation_tasks
             WHERE task_type = 'apply_job'
               AND target_id  = ?1
               AND profile_id = ?2
               AND hr_name IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .bind(&job_id)
        .bind(&profile_id)
        .fetch_optional(&self.db)
        .await?
        .unwrap_or((None, None));

        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }

        let input = DraftInput {
            job_title: &title,
            company: &company,
            job_location: location.as_deref(),
            job_description: &description,
            candidate_name: &display_name,
            candidate_summary: candidate_summary.as_deref(),
            cv_text: cv_text.as_deref(),
            variant_target: variant_target.as_deref(),
            hr_name: hr_name_owned.as_deref(),
            hr_link: hr_link_owned.as_deref(),
        };

        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: draft_prompt(&input),
            system: Some(draft_system()),
            input_hash: input_hash(&[
                DRAFT_PROMPT_VERSION,
                &job_id,
                content_hash.as_deref().unwrap_or(""),
                cv_hash.as_deref().unwrap_or(""),
                role_variant_id.as_deref().unwrap_or(""),
            ]),
        };
        let resp = complete_cached(&self.db, &provider, req).await?;
        let content = parse_draft(&resp.text);

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let form_answers_json =
            serde_json::to_string(&content.form_answers).unwrap_or_else(|_| "[]".to_string());
        sqlx::query(
            "INSERT INTO application_drafts (
                id, job_id, profile_id, match_id, cv_document_id, role_variant_id,
                cover_letter, form_answers_json, generated_summary, optimization_notes,
                status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'draft', ?11, ?11)",
        )
        .bind(&id)
        .bind(&job_id)
        .bind(&profile_id)
        .bind(job_match_id)
        .bind(&cv_document_id)
        .bind(&role_variant_id)
        .bind(&content.cover_letter)
        .bind(&form_answers_json)
        .bind(&content.summary)
        .bind(&content.optimization_notes)
        .bind(&now)
        .execute(&self.db)
        .await?;

        Ok(id)
    }

    async fn submit(&self, application_draft_id: &str) -> DomainResult<String> {
        let mut tx = self.db.begin().await?;
        let (job_id, profile_id, cover_letter, form_answers_json, role_variant_id, cv_document_id): (
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT job_id, profile_id, cover_letter, form_answers_json, role_variant_id, cv_document_id
             FROM application_drafts WHERE id = ?1",
        )
        .bind(application_draft_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            DomainError::InvalidInput(format!("unknown application_draft: {application_draft_id}"))
        })?;

        if let Some(run_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM application_runs WHERE draft_id = ?1 ORDER BY started_at LIMIT 1",
        )
        .bind(application_draft_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            tx.commit().await?;
            return Ok(run_id);
        }

        let (platform, url, canonical_url): (String, String, Option<String>) =
            sqlx::query_as("SELECT platform, url, canonical_url FROM job_posts WHERE id = ?1")
                .bind(&job_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("draft references unknown job: {job_id}"))
                })?;
        let canonical = canonical_url.unwrap_or(url);

        let now = now_iso();

        let existing_lock: Option<String> = sqlx::query_scalar(
            "SELECT id FROM application_url_locks
             WHERE profile_id = ?1 AND platform = ?2 AND canonical_url = ?3",
        )
        .bind(&profile_id)
        .bind(&platform)
        .bind(&canonical)
        .fetch_optional(&mut *tx)
        .await?;

        if existing_lock.is_some() {
            let run_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO application_runs
                   (id, draft_id, job_id, profile_id, platform, mode, status, attempt,
                    started_at, finished_at, failure_reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'manual_assist', 'skipped_duplicate_url', 1,
                         ?6, ?6, 'duplicate application URL for this profile')",
            )
            .bind(&run_id)
            .bind(application_draft_id)
            .bind(&job_id)
            .bind(&profile_id)
            .bind(&platform)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE application_drafts SET status = 'skipped_duplicate_url', updated_at = ?1 WHERE id = ?2",
            )
            .bind(&now)
            .bind(application_draft_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE job_posts SET status = 'skipped_duplicate_url' WHERE id = ?1")
                .bind(&job_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(run_id);
        }

        let run_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO application_runs
               (id, draft_id, job_id, profile_id, platform, mode, status, attempt, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'manual_assist', 'started', 1, ?6)",
        )
        .bind(&run_id)
        .bind(application_draft_id)
        .bind(&job_id)
        .bind(&profile_id)
        .bind(&platform)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        let lock_result = sqlx::query(
            "INSERT INTO application_url_locks
               (id, profile_id, platform, canonical_url, first_job_id, first_application_run_id, locked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&profile_id)
        .bind(&platform)
        .bind(&canonical)
        .bind(&job_id)
        .bind(&run_id)
        .bind(&now)
        .execute(&mut *tx)
        .await;

        if let Err(e) = lock_result {
            if is_unique_violation(&e) {
                sqlx::query(
                    "UPDATE application_runs
                     SET status = 'skipped_duplicate_url', finished_at = ?1,
                         failure_reason = 'duplicate application URL for this profile'
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(&run_id)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "UPDATE application_drafts SET status = 'skipped_duplicate_url', updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(application_draft_id)
                .execute(&mut *tx)
                .await?;
                sqlx::query("UPDATE job_posts SET status = 'skipped_duplicate_url' WHERE id = ?1")
                    .bind(&job_id)
                    .execute(&mut *tx)
                    .await?;
                tx.commit().await?;
                return Ok(run_id);
            }
            return Err(DomainError::Storage(e));
        }

        let mut answers = contact_fact_answers(&mut tx, &profile_id, role_variant_id.as_deref())
            .await
            .unwrap_or_default();
        if let serde_json::Value::Array(ai) = map_answers(form_answers_json.as_deref()) {
            answers.extend(ai);
        }

        let cv_path: Option<String> = match &cv_document_id {
            Some(id) => {
                sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await
                    .ok()
                    .flatten()
            }
            None => None,
        };

        let payload = serde_json::json!({
            "url": canonical,
            "platform": platform,
            "cover_letter": cover_letter,
            "cv_path": cv_path,
            "answers": serde_json::Value::Array(answers),
        })
        .to_string();

        sqlx::query(
            "INSERT INTO automation_tasks
               (id, profile_id, task_type, target_id, status, payload_json, created_at, updated_at)
             VALUES (?1, ?2, 'apply_job', ?3, 'queued', ?4, ?5, ?5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&profile_id)
        .bind(&run_id)
        .bind(&payload)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE application_drafts SET status = 'submitting', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(application_draft_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE job_posts SET status = 'queued' WHERE id = ?1")
            .bind(&job_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(run_id)
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.is_unique_violation())
}

async fn contact_fact_answers(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    profile_id: &str,
    role_variant_id: Option<&str>,
) -> DomainResult<Vec<serde_json::Value>> {
    let facts: std::collections::HashMap<String, String> =
        sqlx::query_as::<_, (String, String)>(
            "SELECT fact_key, fact_value FROM profile_facts WHERE profile_id = ?1",
        )
        .bind(profile_id)
        .fetch_all(&mut **tx)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect();

    let contact = match role_variant_id {
        Some(vid) => sqlx::query_scalar::<_, Option<String>>(
            "SELECT contact_json FROM profile_variants WHERE id = ?1",
        )
        .bind(vid)
        .fetch_optional(&mut **tx)
        .await
        .ok()
        .flatten()
        .flatten()
        .and_then(|raw| {
            serde_json::from_str::<crate::domain::profile_variants::ContactInfo>(&raw).ok()
        })
        .unwrap_or_default(),
        None => crate::domain::profile_variants::ContactInfo::default(),
    };

    let clean = |s: &str| {
        let t = s.trim();
        (!t.is_empty()).then(|| t.to_string())
    };
    let fact = |k: &str| facts.get(k).and_then(|v| clean(v));

    let phone = fact("phone").or_else(|| contact.phone.as_deref().and_then(clean));
    let website = fact("portfolio").or_else(|| contact.website.as_deref().and_then(clean));
    let email = fact("email").or_else(|| contact.email.as_deref().and_then(clean));
    let specs: [(&[&str], Option<String>); 9] = [
        (&["phone", "telefone", "celular", "mobile phone"], phone),
        (
            &[
                "pretensão salarial",
                "pretensao salarial",
                "salary expectation",
                "expected salary",
                "salary",
                "remuneração",
            ],
            fact("salaryMin"),
        ),
        (&["linkedin"], fact("linkedin")),
        (&["github"], fact("github")),
        (&["portfolio", "website", "personal website", "site"], website),
        (&["email address", "e-mail"], email),
        (
            &["work authorization", "autorização de trabalho", "elegível para trabalhar"],
            fact("brazilWorkAuth"),
        ),
        (
            &["visa sponsorship", "patrocínio de visto", "sponsorship"],
            fact("visaSponsorship"),
        ),
        (
            &["english", "inglês", "english level", "nível de inglês"],
            fact("englishLevel"),
        ),
    ];

    let mut out = Vec::new();
    for (labels, value) in specs {
        if let Some(v) = value {
            for label in labels {
                out.push(serde_json::json!({ "label": label, "value": v }));
            }
        }
    }
    Ok(out)
}

fn map_answers(form_answers_json: Option<&str>) -> serde_json::Value {
    let Some(raw) = form_answers_json else {
        return serde_json::json!([]);
    };
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(raw) else {
        return serde_json::json!([]);
    };
    let mapped: Vec<serde_json::Value> = items
        .into_iter()
        .filter_map(|v| {
            let q = v.get("question").and_then(|x| x.as_str())?;
            let a = v.get("answer").and_then(|x| x.as_str()).unwrap_or("");
            Some(serde_json::json!({ "label": q, "value": a }))
        })
        .collect();
    serde_json::Value::Array(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::automation::EasyApplyInput;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn mem_pool() -> SqlitePool {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn insert_profile(pool: &SqlitePool, id: &str) {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES (?1, 'Test', ?2, ?2, 1)",
        )
        .bind(id)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_job(pool: &SqlitePool, id: &str, profile_id: &str, canonical: &str) {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, canonical_url, title, company, description, discovered_at)
             VALUES (?1, ?2, 'linkedin', ?3, ?3, 'Rust Engineer', 'ACME', 'desc', ?4)",
        )
        .bind(id)
        .bind(profile_id)
        .bind(canonical)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_draft(pool: &SqlitePool, id: &str, job_id: &str, profile_id: &str) {
        let now = now_iso();
        let form_answers = r#"[{"question":"Why us?","answer":"Because."}]"#;
        sqlx::query(
            "INSERT INTO application_drafts
               (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'Dear team', ?4, 'draft', ?5, ?5)",
        )
        .bind(id)
        .bind(job_id)
        .bind(profile_id)
        .bind(form_answers)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    fn service(pool: SqlitePool) -> ApplicationServiceImpl {
        ApplicationServiceImpl::new(pool, std::env::temp_dir())
    }

    #[tokio::test]
    async fn first_submit_creates_run_lock_and_task() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/1").await;
        insert_draft(&pool, "d1", "j1", "p1").await;

        let run_id = service(pool.clone()).submit("d1").await.unwrap();

        let (status, mode): (String, String) =
            sqlx::query_as("SELECT status, mode FROM application_runs WHERE id = ?1")
                .bind(&run_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "started");
        assert_eq!(mode, "manual_assist");

        let locks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM application_url_locks WHERE profile_id = 'p1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(locks, 1);

        let payload: String = sqlx::query_scalar(
            "SELECT payload_json FROM automation_tasks WHERE task_type = 'apply_job' AND target_id = ?1",
        )
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let input: EasyApplyInput = serde_json::from_str(&payload).unwrap();
        assert_eq!(input.url, "https://linkedin.com/jobs/view/1");
        assert_eq!(input.platform, "linkedin");
        assert_eq!(input.answers.len(), 1);
        assert_eq!(input.answers[0].label, "Why us?");
        assert_eq!(input.answers[0].value, "Because.");

        let draft_status: String =
            sqlx::query_scalar("SELECT status FROM application_drafts WHERE id = 'd1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(draft_status, "submitting");
        let job_status: String = sqlx::query_scalar("SELECT status FROM job_posts WHERE id = 'j1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(job_status, "queued");
    }

    #[tokio::test]
    async fn repeated_submit_of_same_draft_is_idempotent() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/2").await;
        insert_draft(&pool, "d1", "j1", "p1").await;

        let svc = service(pool.clone());
        let first = svc.submit("d1").await.unwrap();
        let second = svc.submit("d1").await.unwrap();

        assert_eq!(second, first);
        let runs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_runs")
            .fetch_one(&pool)
            .await
            .unwrap();
        let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM automation_tasks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(runs, 1);
        assert_eq!(tasks, 1);
    }

    #[tokio::test]
    async fn duplicate_url_is_skipped_never_double_applies() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/7").await;
        insert_job(&pool, "j2", "p1", "https://linkedin.com/jobs/view/7").await;
        insert_draft(&pool, "d1", "j1", "p1").await;
        insert_draft(&pool, "d2", "j2", "p1").await;

        let svc = service(pool.clone());
        let _run1 = svc.submit("d1").await.unwrap();
        let run2 = svc.submit("d2").await.unwrap();

        let status: String =
            sqlx::query_scalar("SELECT status FROM application_runs WHERE id = ?1")
                .bind(&run2)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "skipped_duplicate_url");

        let locks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_url_locks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(locks, 1);
        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM automation_tasks WHERE task_type = 'apply_job'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tasks, 1);

        let draft_status: String =
            sqlx::query_scalar("SELECT status FROM application_drafts WHERE id = 'd2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(draft_status, "skipped_duplicate_url");
    }

    #[tokio::test]
    async fn different_profiles_same_url_both_apply() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_profile(&pool, "p2").await;
        insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/9").await;
        insert_job(&pool, "j2", "p2", "https://linkedin.com/jobs/view/9").await;
        insert_draft(&pool, "d1", "j1", "p1").await;
        insert_draft(&pool, "d2", "j2", "p2").await;

        let svc = service(pool.clone());
        let run1 = svc.submit("d1").await.unwrap();
        let run2 = svc.submit("d2").await.unwrap();

        for run in [&run1, &run2] {
            let status: String =
                sqlx::query_scalar("SELECT status FROM application_runs WHERE id = ?1")
                    .bind(run)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(status, "started");
        }
        let locks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_url_locks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(locks, 2);
    }

    #[tokio::test]
    async fn unknown_draft_is_invalid_input() {
        let pool = mem_pool().await;
        let err = service(pool).submit("nope").await.unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
    }
}
