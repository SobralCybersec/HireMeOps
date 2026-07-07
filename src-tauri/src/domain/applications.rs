//! Application drafting + submission service (Phase 4+, Phase 6/7).
//!
//! `draft` composes the job posting, the profile (and pinned role variant), and
//! the attached CV into a tailored cover letter + form answers via the cached
//! AI provider, persisting the result as an `application_drafts` row. `submit`
//! enforces the per-URL `application_url_locks` (one application per profile +
//! platform + canonical URL — never double-apply), records an `application_runs`
//! row, and enqueues the `apply_job` browser task the AutomationSupervisor drives.

use std::path::PathBuf;

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::ai::prompt::{
    draft_prompt, draft_system, parse_draft, DraftInput, DRAFT_PROMPT_VERSION,
};
use crate::ai::{api_key_from_env, complete_cached, input_hash, select_provider};
use crate::cv::{self, DocKind};
use crate::domain::ai::CompletionRequest;
use crate::storage::settings::load_ai_providers;
use crate::util::now_iso;

/// Builds `application_drafts`, renders `application_artifacts`, and records
/// `application_runs`. The per-URL lock (`application_url_locks`) prevents
/// double-applying to the same posting.
#[allow(async_fn_in_trait)]
pub trait ApplicationService: Send + Sync {
    async fn draft(&self, job_match_id: &str) -> DomainResult<String>;
    async fn submit(&self, application_draft_id: &str) -> DomainResult<String>;
}

/// Placeholder implementation (kept for reference / early Phase-1 wiring).
pub struct ApplicationServiceStub;

impl ApplicationService for ApplicationServiceStub {
    async fn draft(&self, _job_match_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("ApplicationService::draft"))
    }
    async fn submit(&self, _application_draft_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("ApplicationService::submit"))
    }
}

/// Concrete `ApplicationService` backed by the SQLite pool and the on-disk CV
/// file store (needed to re-extract CV text for the draft prompt).
pub struct ApplicationServiceImpl {
    db: SqlitePool,
    cv_files_dir: PathBuf,
}

impl ApplicationServiceImpl {
    pub fn new(db: SqlitePool, cv_files_dir: PathBuf) -> Self {
        Self { db, cv_files_dir }
    }

    /// Re-extract text from a stored CV document. Returns `(text, file_hash)`.
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
        // `cv_files_dir` anchors the store; `stored_path` is the absolute file.
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
        // Load the match: it ties together the job, profile, and the CV / role
        // variant that scoring selected for this posting.
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

        // The posting supplies the job facts and the cache-stabilising content hash.
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

        // The profile supplies the candidate identity + baseline summary.
        let (display_name, profile_summary): (String, Option<String>) =
            sqlx::query_as("SELECT display_name, summary FROM profiles WHERE id = ?1")
                .bind(&profile_id)
                .fetch_optional(&self.db)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("unknown profile: {profile_id}"))
                })?;

        // A pinned role variant overrides the target/summary the model tailors to.
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

        // Attach CV text when the match pinned a document; keep its hash for the key.
        let (cv_text, cv_hash): (Option<String>, Option<String>) = match &cv_document_id {
            Some(cid) => {
                let (text, hash) = self.cv_text(cid).await?;
                (Some(text), Some(hash))
            }
            None => (None, None),
        };

        // Select the configured provider; the API key is env-resolved (not stored
        // unencrypted). A disabled/empty provider surfaces a clear error on call.
        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider(&providers, default_index, api_key_from_env());
        // Fail fast before building the prompt / touching the cache: a disabled
        // provider can never complete, so surface the clear error here.
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
        };

        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: draft_prompt(&input),
            system: Some(draft_system()),
            // Fold the prompt version, the job content hash, the CV hash, and the
            // pinned variant into the key so any of them changing re-runs the draft.
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

        // Persist the draft.
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
        // Load the draft we're submitting.
        let (job_id, profile_id, cover_letter, form_answers_json): (
            String,
            String,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT job_id, profile_id, cover_letter, form_answers_json
             FROM application_drafts WHERE id = ?1",
        )
        .bind(application_draft_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| {
            DomainError::InvalidInput(format!("unknown application_draft: {application_draft_id}"))
        })?;

        // Resolve the job's platform + canonical URL (fall back to the raw url).
        let (platform, url, canonical_url): (String, String, Option<String>) =
            sqlx::query_as("SELECT platform, url, canonical_url FROM job_posts WHERE id = ?1")
                .bind(&job_id)
                .fetch_optional(&self.db)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("draft references unknown job: {job_id}"))
                })?;
        let canonical = canonical_url.unwrap_or(url);

        let now = now_iso();

        // SHARED-FILE URL LOCKOUT — one application per (profile, platform,
        // canonical URL). If a lock already exists we NEVER apply twice: record a
        // skipped run and stop. This is the core duplicate-application guard.
        let existing_lock: Option<String> = sqlx::query_scalar(
            "SELECT id FROM application_url_locks
             WHERE profile_id = ?1 AND platform = ?2 AND canonical_url = ?3",
        )
        .bind(&profile_id)
        .bind(&platform)
        .bind(&canonical)
        .fetch_optional(&self.db)
        .await?;

        if existing_lock.is_some() {
            let run_id = Uuid::new_v4().to_string();
            self.record_skipped_run(
                &run_id,
                application_draft_id,
                &job_id,
                &profile_id,
                &platform,
            )
            .await?;
            return Ok(run_id);
        }

        // First application to this URL: create the run, take the lock, and
        // enqueue the browser task. The AutomationSupervisor drives it and pauses
        // for review — the application is never auto-submitted.
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
        .execute(&self.db)
        .await?;

        // Acquire the lock. The UNIQUE(profile_id, platform, canonical_url) index
        // is the real enforcement point against a race between two submits.
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
        .execute(&self.db)
        .await;

        if let Err(e) = lock_result {
            // Lost the race: someone locked this URL first. Roll our run to
            // skipped_duplicate_url and stop — never double-apply.
            if is_unique_violation(&e) {
                sqlx::query(
                    "UPDATE application_runs
                     SET status = 'skipped_duplicate_url', finished_at = ?1,
                         failure_reason = 'duplicate application URL for this profile'
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(&run_id)
                .execute(&self.db)
                .await?;
                return Ok(run_id);
            }
            return Err(DomainError::Storage(e));
        }

        // Build the `apply_job` payload the AutomationSupervisor consumes.
        let payload = serde_json::json!({
            "url": canonical,
            "platform": platform,
            "cover_letter": cover_letter,
            "answers": map_answers(form_answers_json.as_deref()),
        })
        .to_string();

        sqlx::query(
            "INSERT INTO automation_tasks
               (id, profile_id, task_type, target_id, status, payload_json, created_at, updated_at)
             VALUES (?1, ?2, 'apply_job', ?3, 'queued', ?4, ?5, ?5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&profile_id)
        .bind(&run_id) // target_id -> the run this task fulfills
        .bind(&payload)
        .bind(&now)
        .execute(&self.db)
        .await?;

        // Move the draft + job into the in-flight state.
        sqlx::query(
            "UPDATE application_drafts SET status = 'submitting', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(application_draft_id)
        .execute(&self.db)
        .await?;
        sqlx::query("UPDATE job_posts SET status = 'queued' WHERE id = ?1")
            .bind(&job_id)
            .execute(&self.db)
            .await?;

        Ok(run_id)
    }
}

impl ApplicationServiceImpl {
    /// Record a run that was skipped because the URL is already locked for this
    /// profile, and reflect the skip on the draft + job. Never applies.
    async fn record_skipped_run(
        &self,
        run_id: &str,
        draft_id: &str,
        job_id: &str,
        profile_id: &str,
        platform: &str,
    ) -> DomainResult<()> {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO application_runs
               (id, draft_id, job_id, profile_id, platform, mode, status, attempt,
                started_at, finished_at, failure_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, 'manual_assist', 'skipped_duplicate_url', 1,
                     ?6, ?6, 'duplicate application URL for this profile')",
        )
        .bind(run_id)
        .bind(draft_id)
        .bind(job_id)
        .bind(profile_id)
        .bind(platform)
        .bind(&now)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "UPDATE application_drafts SET status = 'skipped_duplicate_url', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(draft_id)
        .execute(&self.db)
        .await?;
        sqlx::query("UPDATE job_posts SET status = 'skipped_duplicate_url' WHERE id = ?1")
            .bind(job_id)
            .execute(&self.db)
            .await?;
        Ok(())
    }
}

/// True if a sqlx error is a SQLite UNIQUE constraint violation.
fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.is_unique_violation())
}

/// Remap the draft's stored `{question, answer}` form answers into the
/// `{label, value}` shape the browser task payload expects. Best-effort: any
/// malformed input degrades to an empty answer list.
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

        // The enqueued payload must be a valid EasyApplyInput (cross-module contract).
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
    async fn duplicate_url_is_skipped_never_double_applies() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        // Same canonical URL discovered as two separate job rows.
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

        // Exactly one lock and one apply task — the second submit applied nothing.
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

        // The lockout is per-profile: both applications proceed.
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
