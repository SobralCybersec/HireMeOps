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

use self::applications_answers::{contact_fact_answers, map_answers};
use super::{DomainError, DomainResult};

#[path = "applications_answers.rs"]
mod applications_answers;
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

    async fn draft_context(&self, job_match_id: &str) -> DomainResult<DraftContext> {
        let (job_id, profile_id, cv_document_id, role_variant_id) =
            load_draft_match(&self.db, job_match_id).await?;
        let (title, company, location, description, content_hash) =
            load_draft_job(&self.db, &job_id).await?;
        let (display_name, profile_summary) = load_draft_profile(&self.db, &profile_id).await?;
        let (variant_target, candidate_summary) =
            load_draft_variant(&self.db, &role_variant_id, profile_summary).await?;
        let (cv_text, cv_hash) = match &cv_document_id {
            Some(document_id) => {
                let (text, hash) = self.cv_text(document_id).await?;
                (Some(text), Some(hash))
            }
            None => (None, None),
        };
        let (hr_name, hr_link) = load_draft_hr(&self.db, &job_id, &profile_id).await?;
        Ok(DraftContext {
            job_id,
            profile_id,
            cv_document_id,
            role_variant_id,
            title,
            company,
            location,
            description,
            content_hash,
            display_name,
            variant_target,
            candidate_summary,
            cv_text,
            cv_hash,
            hr_name,
            hr_link,
        })
    }
}

struct DraftContext {
    job_id: String,
    profile_id: String,
    cv_document_id: Option<String>,
    role_variant_id: Option<String>,
    title: String,
    company: String,
    location: Option<String>,
    description: String,
    content_hash: Option<String>,
    display_name: String,
    variant_target: Option<String>,
    candidate_summary: Option<String>,
    cv_text: Option<String>,
    cv_hash: Option<String>,
    hr_name: Option<String>,
    hr_link: Option<String>,
}

async fn load_draft_match(
    db: &SqlitePool,
    job_match_id: &str,
) -> DomainResult<(String, String, Option<String>, Option<String>)> {
    sqlx::query_as(
        "SELECT job_id, profile_id, cv_document_id, role_variant_id
         FROM job_matches WHERE id = ?1",
    )
    .bind(job_match_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| DomainError::InvalidInput(format!("unknown job_match: {job_match_id}")))
}

async fn load_draft_job(
    db: &SqlitePool,
    job_id: &str,
) -> DomainResult<(String, String, Option<String>, String, Option<String>)> {
    sqlx::query_as(
        "SELECT title, company, location, description, content_hash
         FROM job_posts WHERE id = ?1",
    )
    .bind(job_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| DomainError::InvalidInput(format!("unknown job_post: {job_id}")))
}

async fn load_draft_profile(
    db: &SqlitePool,
    profile_id: &str,
) -> DomainResult<(String, Option<String>)> {
    sqlx::query_as("SELECT display_name, summary FROM profiles WHERE id = ?1")
        .bind(profile_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("unknown profile: {profile_id}")))
}

async fn load_draft_variant(
    db: &SqlitePool,
    role_variant_id: &Option<String>,
    profile_summary: Option<String>,
) -> DomainResult<(Option<String>, Option<String>)> {
    let variant: Option<(String, Option<String>, Option<String>)> = match role_variant_id {
        Some(variant_id) => {
            sqlx::query_as(
                "SELECT target_title, headline, summary FROM profile_variants WHERE id = ?1",
            )
            .bind(variant_id)
            .fetch_optional(db)
            .await?
        }
        None => None,
    };
    let variant_target = variant.as_ref().map(|(target, headline, _)| {
        headline
            .as_deref()
            .filter(|headline| !headline.trim().is_empty())
            .unwrap_or(target)
            .to_string()
    });
    let candidate_summary = variant
        .as_ref()
        .and_then(|(_, _, summary)| summary.clone())
        .or(profile_summary);
    Ok((variant_target, candidate_summary))
}

async fn load_draft_hr(
    db: &SqlitePool,
    job_id: &str,
    profile_id: &str,
) -> DomainResult<(Option<String>, Option<String>)> {
    Ok(sqlx::query_as(
        "SELECT hr_name, hr_link
         FROM automation_tasks
         WHERE task_type = 'apply_job'
           AND target_id = ?1
           AND profile_id = ?2
           AND hr_name IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 1",
    )
    .bind(job_id)
    .bind(profile_id)
    .fetch_optional(db)
    .await?
    .unwrap_or((None, None)))
}

struct DraftRecord<'a> {
    id: &'a str,
    job_id: &'a str,
    profile_id: &'a str,
    match_id: &'a str,
    cv_document_id: &'a Option<String>,
    role_variant_id: &'a Option<String>,
    cover_letter: &'a str,
    form_answers_json: &'a str,
    summary: &'a str,
    optimization_notes: &'a str,
    now: &'a str,
}

async fn persist_draft(db: &SqlitePool, record: DraftRecord<'_>) -> DomainResult<()> {
    sqlx::query(
        "INSERT INTO application_drafts (
            id, job_id, profile_id, match_id, cv_document_id, role_variant_id,
            cover_letter, form_answers_json, generated_summary, optimization_notes,
            status, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'draft', ?11, ?11)",
    )
    .bind(record.id)
    .bind(record.job_id)
    .bind(record.profile_id)
    .bind(record.match_id)
    .bind(record.cv_document_id)
    .bind(record.role_variant_id)
    .bind(record.cover_letter)
    .bind(record.form_answers_json)
    .bind(record.summary)
    .bind(record.optimization_notes)
    .bind(record.now)
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Clone)]
struct SubmissionDraft {
    job_id: String,
    profile_id: String,
    cover_letter: Option<String>,
    form_answers_json: Option<String>,
    role_variant_id: Option<String>,
    cv_document_id: Option<String>,
}

#[derive(Clone)]
struct SubmissionJob {
    platform: String,
    canonical_url: String,
}

async fn load_submission_draft(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
) -> DomainResult<SubmissionDraft> {
    let row: (String, String, Option<String>, Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
        "SELECT job_id, profile_id, cover_letter, form_answers_json, role_variant_id, cv_document_id
         FROM application_drafts WHERE id = ?1",
        )
        .bind(draft_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("unknown application_draft: {draft_id}")))?;
    Ok(SubmissionDraft {
        job_id: row.0,
        profile_id: row.1,
        cover_letter: row.2,
        form_answers_json: row.3,
        role_variant_id: row.4,
        cv_document_id: row.5,
    })
}

async fn existing_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
) -> DomainResult<Option<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT id FROM application_runs WHERE draft_id = ?1 ORDER BY started_at LIMIT 1",
    )
    .bind(draft_id)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn load_submission_job(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    job_id: &str,
) -> DomainResult<SubmissionJob> {
    let row: (String, String, Option<String>) =
        sqlx::query_as("SELECT platform, url, canonical_url FROM job_posts WHERE id = ?1")
            .bind(job_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| {
                DomainError::InvalidInput(format!("draft references unknown job: {job_id}"))
            })?;
    Ok(SubmissionJob {
        platform: row.0,
        canonical_url: row.2.unwrap_or(row.1),
    })
}

async fn existing_url_lock(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
) -> DomainResult<bool> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT id FROM application_url_locks
         WHERE profile_id = ?1 AND platform = ?2 AND canonical_url = ?3",
    )
    .bind(&draft.profile_id)
    .bind(&job.platform)
    .bind(&job.canonical_url)
    .fetch_optional(&mut **tx)
    .await?
    .is_some())
}

async fn record_duplicate_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
    now: &str,
) -> DomainResult<String> {
    let run_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO application_runs
           (id, draft_id, job_id, profile_id, platform, mode, status, attempt,
            started_at, finished_at, failure_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, 'manual_assist', 'skipped_duplicate_url', 1,
                 ?6, ?6, 'duplicate application URL for this profile')",
    )
    .bind(&run_id)
    .bind(draft_id)
    .bind(&draft.job_id)
    .bind(&draft.profile_id)
    .bind(&job.platform)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE application_drafts SET status = 'skipped_duplicate_url', updated_at = ?1 WHERE id = ?2",
    )
    .bind(now)
    .bind(draft_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE job_posts SET status = 'skipped_duplicate_url' WHERE id = ?1")
        .bind(&draft.job_id)
        .execute(&mut **tx)
        .await?;
    Ok(run_id)
}

async fn start_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
    now: &str,
) -> DomainResult<String> {
    let run_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO application_runs
           (id, draft_id, job_id, profile_id, platform, mode, status, attempt, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'manual_assist', 'started', 1, ?6)",
    )
    .bind(&run_id)
    .bind(draft_id)
    .bind(&draft.job_id)
    .bind(&draft.profile_id)
    .bind(&job.platform)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    Ok(run_id)
}

async fn acquire_submission_lock(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
    run_id: &str,
    now: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO application_url_locks
           (id, profile_id, platform, canonical_url, first_job_id, first_application_run_id, locked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&draft.profile_id)
    .bind(&job.platform)
    .bind(&job.canonical_url)
    .bind(&draft.job_id)
    .bind(run_id)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

async fn mark_lock_conflict(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
    job_id: &str,
    run_id: &str,
    now: &str,
) -> DomainResult<()> {
    sqlx::query(
        "UPDATE application_runs
         SET status = 'skipped_duplicate_url', finished_at = ?1,
             failure_reason = 'duplicate application URL for this profile'
         WHERE id = ?2",
    )
    .bind(now)
    .bind(run_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE application_drafts SET status = 'skipped_duplicate_url', updated_at = ?1 WHERE id = ?2",
    )
    .bind(now)
    .bind(draft_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE job_posts SET status = 'skipped_duplicate_url' WHERE id = ?1")
        .bind(job_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn submission_payload(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
) -> String {
    let mut answers = contact_fact_answers(tx, &draft.profile_id, draft.role_variant_id.as_deref())
        .await
        .unwrap_or_default();
    if let serde_json::Value::Array(ai) = map_answers(draft.form_answers_json.as_deref()) {
        answers.extend(ai);
    }
    let cv_path = match draft.cv_document_id.as_deref() {
        Some(document_id) => {
            sqlx::query_scalar::<_, String>("SELECT stored_path FROM cv_documents WHERE id = ?1")
                .bind(document_id)
                .fetch_optional(&mut **tx)
                .await
                .ok()
                .flatten()
        }
        None => None,
    };
    serde_json::json!({
        "url": job.canonical_url,
        "platform": job.platform,
        "cover_letter": draft.cover_letter,
        "cv_path": cv_path,
        "answers": serde_json::Value::Array(answers),
    })
    .to_string()
}

async fn enqueue_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft: &SubmissionDraft,
    run_id: &str,
    payload: &str,
    now: &str,
) -> DomainResult<()> {
    sqlx::query(
        "INSERT INTO automation_tasks
           (id, profile_id, task_type, target_id, status, payload_json, created_at, updated_at)
         VALUES (?1, ?2, 'apply_job', ?3, 'queued', ?4, ?5, ?5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&draft.profile_id)
    .bind(run_id)
    .bind(payload)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn mark_submission_queued(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
    job_id: &str,
    now: &str,
) -> DomainResult<()> {
    sqlx::query(
        "UPDATE application_drafts SET status = 'submitting', updated_at = ?1 WHERE id = ?2",
    )
    .bind(now)
    .bind(draft_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE job_posts SET status = 'queued' WHERE id = ?1")
        .bind(job_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn prepare_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
    draft: &SubmissionDraft,
    job: &SubmissionJob,
    now: &str,
) -> DomainResult<PreparedSubmission> {
    if existing_url_lock(tx, draft, job).await? {
        let run_id = record_duplicate_submission(tx, draft_id, draft, job, now).await?;
        return Ok(PreparedSubmission::Existing(run_id));
    }
    let run_id = start_submission(tx, draft_id, draft, job, now).await?;
    if !(lock_or_mark_duplicate(
        tx,
        LockContext {
            draft_id,
            draft,
            job,
            run_id: &run_id,
            now,
        },
    )
    .await?)
    {
        return Ok(PreparedSubmission::Existing(run_id));
    }
    Ok(PreparedSubmission::New {
        draft: draft.clone(),
        job: job.clone(),
        now: now.to_string(),
        run_id,
    })
}

struct LockContext<'a> {
    draft_id: &'a str,
    draft: &'a SubmissionDraft,
    job: &'a SubmissionJob,
    run_id: &'a str,
    now: &'a str,
}

async fn lock_or_mark_duplicate(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: LockContext<'_>,
) -> DomainResult<bool> {
    match acquire_submission_lock(tx, context.draft, context.job, context.run_id, context.now).await
    {
        Ok(()) => Ok(true),
        Err(error) if is_unique_violation(&error) => {
            mark_lock_conflict(
                tx,
                context.draft_id,
                &context.draft.job_id,
                context.run_id,
                context.now,
            )
            .await?;
            Ok(false)
        }
        Err(error) => Err(DomainError::Storage(error)),
    }
}

enum PreparedSubmission {
    Existing(String),
    New {
        draft: SubmissionDraft,
        job: SubmissionJob,
        now: String,
        run_id: String,
    },
}

async fn prepare_submission_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    draft_id: &str,
) -> DomainResult<PreparedSubmission> {
    let draft = load_submission_draft(tx, draft_id).await?;
    if let Some(run_id) = existing_submission(tx, draft_id).await? {
        return Ok(PreparedSubmission::Existing(run_id));
    }
    let job = load_submission_job(tx, &draft.job_id).await?;
    let now = now_iso();
    prepare_submission(tx, draft_id, &draft, &job, &now).await
}

impl ApplicationService for ApplicationServiceImpl {
    async fn draft(&self, job_match_id: &str) -> DomainResult<String> {
        let context = self.draft_context(job_match_id).await?;
        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }
        let input = DraftInput {
            job_title: &context.title,
            company: &context.company,
            job_location: context.location.as_deref(),
            job_description: &context.description,
            candidate_name: &context.display_name,
            candidate_summary: context.candidate_summary.as_deref(),
            cv_text: context.cv_text.as_deref(),
            variant_target: context.variant_target.as_deref(),
            hr_name: context.hr_name.as_deref(),
            hr_link: context.hr_link.as_deref(),
        };
        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: draft_prompt(&input),
            system: Some(draft_system()),
            input_hash: input_hash(&[
                DRAFT_PROMPT_VERSION,
                &context.job_id,
                context.content_hash.as_deref().unwrap_or(""),
                context.cv_hash.as_deref().unwrap_or(""),
                context.role_variant_id.as_deref().unwrap_or(""),
            ]),
        };
        let content = parse_draft(&complete_cached(&self.db, &provider, req).await?.text);
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let form_answers_json =
            serde_json::to_string(&content.form_answers).unwrap_or_else(|_| "[]".to_string());
        persist_draft(
            &self.db,
            DraftRecord {
                id: &id,
                job_id: &context.job_id,
                profile_id: &context.profile_id,
                match_id: job_match_id,
                cv_document_id: &context.cv_document_id,
                role_variant_id: &context.role_variant_id,
                cover_letter: &content.cover_letter,
                form_answers_json: &form_answers_json,
                summary: &content.summary,
                optimization_notes: &content.optimization_notes,
                now: &now,
            },
        )
        .await?;
        Ok(id)
    }

    async fn submit(&self, application_draft_id: &str) -> DomainResult<String> {
        let mut tx = self.db.begin().await?;
        match prepare_submission_transaction(&mut tx, application_draft_id).await? {
            PreparedSubmission::Existing(run_id) => {
                tx.commit().await?;
                Ok(run_id)
            }
            PreparedSubmission::New {
                draft,
                job,
                now,
                run_id,
            } => {
                let payload = submission_payload(&mut tx, &draft, &job).await;
                enqueue_submission(&mut tx, &draft, &run_id, &payload, &now).await?;
                mark_submission_queued(&mut tx, application_draft_id, &draft.job_id, &now).await?;
                tx.commit().await?;
                Ok(run_id)
            }
        }
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.is_unique_violation())
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
