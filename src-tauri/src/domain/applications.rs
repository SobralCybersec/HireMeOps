//! Application drafting + submission service (Phase 4+).
//!
//! `draft` composes the job posting, the profile (and pinned role variant), and
//! the attached CV into a tailored cover letter + form answers via the cached
//! AI provider, persisting the result as an `application_drafts` row. `submit`
//! (browser automation + the per-URL `application_url_locks`) lands in Phase 6/7.

use std::path::PathBuf;

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::ai::prompt::{draft_prompt, draft_system, parse_draft, DraftInput, DRAFT_PROMPT_VERSION};
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
        .ok_or_else(|| DomainError::InvalidInput(format!("unknown cv_document: {cv_document_id}")))?;

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
                .ok_or_else(|| DomainError::InvalidInput(format!("unknown profile: {profile_id}")))?;

        // A pinned role variant overrides the target/summary the model tailors to.
        let variant: Option<(String, Option<String>, Option<String>)> = match &role_variant_id {
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

    async fn submit(&self, _application_draft_id: &str) -> DomainResult<String> {
        // Browser automation + the per-URL `application_url_locks` lands in Phase 6/7.
        Err(DomainError::NotImplemented("ApplicationService::submit"))
    }
}
