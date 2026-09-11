//! CV import, parsing, analysis, and rewrite service.
//!
//! Key: CvService — trait exposing import_document, analyze, rewrite, list_rewrites, read_bytes, list_documents, list_analysis_reports, delete_document
//! Key: CvServiceImpl::import_document — idempotent per (profile_id, file_hash); parses and stores the CV file
//! Key: CvServiceImpl::analyze — runs AI gap/quality analysis, persists cv_analysis_reports
//! Key: CvServiceImpl::rewrite — produces a tailored rewritten CV, persists cv_rewrites
//! Key: CvAnalysisReport / CvRewriteReport — joined view-models for the CV Library/Analysis pages

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::ai::prompt::{
    cover_letter_prompt, cover_letter_system, cv_analysis_prompt, cv_analysis_system,
    cv_rewrite_prompt, cv_rewrite_system, has_explicit_certificates, parse_cover_letter,
    parse_cv_analysis, parse_cv_rewrite, CvAnalysis, CvMetadata, CvRewrite, Language,
    COVER_LETTER_PROMPT_VERSION, CV_ANALYSIS_PROMPT_VERSION, CV_REWRITE_PROMPT_VERSION,
};
use crate::ai::{complete_cached, complete_fresh, input_hash, select_provider_resolved, Provider};
use crate::cv::{self, DocKind};
use crate::domain::ai::{AiProvider, CompletionRequest};
use crate::storage::settings::load_ai_providers;
use crate::util::now_iso;

#[path = "cv_contact.rs"]
mod cv_contact;
use cv_contact::{backfill_contact, backfill_project_links};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CvVariantRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CvDocumentSummary {
    pub id: String,
    pub profile_id: String,
    pub file_name: String,
    pub file_type: String,
    pub is_active: bool,
    pub last_analysis_score: Option<i64>,
    pub size_bytes: i64,
    pub page_count: i64,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub file_hash: String,
    pub assigned_variants: Vec<CvVariantRef>,
    pub sections: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CvAnalysisReport {
    pub id: String,
    pub cv_document_id: Option<String>,
    pub cv_file_name: String,
    pub role_variant_id: Option<String>,
    pub variant_name: Option<String>,
    pub model_provider: String,
    pub model_name: String,
    pub score: Option<i64>,
    pub summary: String,
    pub optimization_needed: bool,
    pub missing_keywords: Vec<String>,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub recommendations: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CvRewriteReport {
    pub id: String,
    pub cv_document_id: Option<String>,
    pub cv_file_name: String,
    pub role_variant_id: Option<String>,
    pub variant_name: Option<String>,
    pub model_provider: String,
    pub model_name: String,
    pub rewrite: CvRewrite,
    pub metadata: CvMetadata,
    pub source_text: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CvRewriteSummary {
    pub id: String,
    pub cv_document_id: Option<String>,
    pub cv_file_name: String,
    pub role_variant_id: Option<String>,
    pub variant_name: Option<String>,
    pub model_provider: String,
    pub model_name: String,
    pub language: Option<String>,
    pub created_at: String,
}

type RewriteDetailRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    String,
    Option<String>,
    String,
);

type CvDocRow = (
    String,
    String,
    String,
    String,
    Option<i64>,
    Option<i64>,
    String,
);

struct DocumentLookups {
    active: HashSet<String>,
    variants: HashMap<String, Vec<CvVariantRef>>,
    scores: HashMap<String, i64>,
}

struct StoredDocument {
    profile_id: String,
    file_hash: String,
    parsed: cv::ParsedDocument,
}

struct ImportSource {
    file_name: String,
    kind: DocKind,
    file_type: &'static str,
    bytes: Vec<u8>,
    file_hash: String,
}

struct RewriteOptions<'a> {
    target_title: Option<&'a str>,
    language: Language,
    extra_context: Option<&'a str>,
}

struct ImportRecord<'a> {
    profile_id: &'a str,
    source: &'a ImportSource,
    parsed: &'a cv::ParsedDocument,
    stored_path: &'a str,
    id: &'a str,
    now: &'a str,
}

fn rewrite_report(row: RewriteDetailRow) -> CvRewriteReport {
    let rewrite = serde_json::from_str::<CvRewrite>(&row.7)
        .map(CvRewrite::cleaned)
        .unwrap_or_default();
    let metadata = rewrite.cv_metadata();
    CvRewriteReport {
        id: row.0,
        cv_document_id: row.1,
        cv_file_name: row.2.unwrap_or_else(|| "First-time CV".to_string()),
        role_variant_id: row.3,
        variant_name: row.4,
        model_provider: row.5.unwrap_or_default(),
        model_name: row.6.unwrap_or_default(),
        rewrite,
        metadata,
        source_text: row.9,
        created_at: row.10,
    }
}

#[allow(async_fn_in_trait)]
pub trait CvService: Send + Sync {
    async fn import_document(&self, profile_id: &str, path: &str) -> DomainResult<String>;
    async fn analyze(&self, cv_document_id: &str, language: Language) -> DomainResult<String>;
    async fn rewrite(
        &self,
        cv_document_id: &str,
        target_title: Option<&str>,
        language: Language,
        extra_context: Option<&str>,
    ) -> DomainResult<String>;
    async fn list_rewrite_summaries(&self, profile_id: &str)
        -> DomainResult<Vec<CvRewriteSummary>>;
    async fn get_rewrite(
        &self,
        profile_id: &str,
        rewrite_id: &str,
    ) -> DomainResult<CvRewriteReport>;
    async fn read_bytes(&self, cv_document_id: &str) -> DomainResult<Vec<u8>>;
    async fn list_documents(&self, profile_id: &str) -> DomainResult<Vec<CvDocumentSummary>>;
    async fn list_analysis_reports(&self, profile_id: &str) -> DomainResult<Vec<CvAnalysisReport>>;
    async fn delete_document(&self, cv_document_id: &str) -> DomainResult<()>;
}

pub struct CvServiceImpl {
    db: SqlitePool,
    cv_files_dir: PathBuf,
}

impl CvServiceImpl {
    pub fn new(db: SqlitePool, cv_files_dir: PathBuf) -> Self {
        Self { db, cv_files_dir }
    }

    async fn load_provider(&self) -> DomainResult<Provider> {
        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }
        Ok(provider)
    }

    async fn load_stored_document(&self, cv_document_id: &str) -> DomainResult<StoredDocument> {
        let (profile_id, file_type, file_hash, stored_path): (String, String, String, String) =
            sqlx::query_as(
                "SELECT profile_id, file_type, file_hash, stored_path
                 FROM cv_documents WHERE id = ?1",
            )
            .bind(cv_document_id)
            .fetch_optional(&self.db)
            .await?
            .ok_or_else(|| {
                DomainError::InvalidInput(format!("unknown cv_document: {cv_document_id}"))
            })?;

        let kind = stored_kind(&file_type)?;
        let bytes = std::fs::read(&stored_path)
            .map_err(|e| DomainError::InvalidInput(format!("read {stored_path}: {e}")))?;
        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse cv document: {e}")))?;
        Ok(StoredDocument {
            profile_id,
            file_hash,
            parsed,
        })
    }

    async fn load_document_rows(&self, profile_id: &str) -> DomainResult<Vec<CvDocRow>> {
        Ok(sqlx::query_as(
            "SELECT id, file_name, file_type, file_hash, size_bytes, page_count, created_at
             FROM cv_documents WHERE profile_id = ?1 ORDER BY created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?)
    }

    async fn load_document_lookups(&self, profile_id: &str) -> DomainResult<DocumentLookups> {
        let active_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT cv_document_id FROM profile_active_cvs WHERE profile_id = ?1",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let active = active_rows.into_iter().map(|(id,)| id).collect();
        let variants = self.load_document_variants(profile_id).await?;
        let scores = self.load_document_scores(profile_id).await?;
        Ok(DocumentLookups {
            active,
            variants,
            scores,
        })
    }

    async fn load_document_variants(
        &self,
        profile_id: &str,
    ) -> DomainResult<HashMap<String, Vec<CvVariantRef>>> {
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT pac.cv_document_id, pv.id, pv.name
             FROM profile_active_cvs pac
             JOIN profile_variants pv ON pv.id = pac.role_variant_id
             WHERE pac.profile_id = ?1
             ORDER BY pac.priority ASC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let mut variants = HashMap::new();
        for (doc_id, id, name) in rows {
            variants
                .entry(doc_id)
                .or_insert_with(Vec::new)
                .push(CvVariantRef { id, name });
        }
        Ok(variants)
    }

    async fn load_document_scores(&self, profile_id: &str) -> DomainResult<HashMap<String, i64>> {
        let rows: Vec<(Option<String>, Option<i64>)> = sqlx::query_as(
            "SELECT cv_document_id, score FROM cv_analysis_reports
             WHERE profile_id = ?1 AND cv_document_id IS NOT NULL
             ORDER BY created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let mut scores = HashMap::new();
        for (doc_id, score) in rows {
            if let (Some(doc_id), Some(score)) = (doc_id, score) {
                scores.entry(doc_id).or_insert(score);
            }
        }
        Ok(scores)
    }

    async fn find_existing_document(
        &self,
        profile_id: &str,
        file_hash: &str,
    ) -> DomainResult<Option<String>> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT id FROM cv_documents WHERE profile_id = ?1 AND file_hash = ?2",
        )
        .bind(profile_id)
        .bind(file_hash)
        .fetch_optional(&self.db)
        .await?)
    }

    async fn store_imported_document(
        &self,
        profile_id: &str,
        source: ImportSource,
        parsed: cv::ParsedDocument,
    ) -> DomainResult<String> {
        tracing::debug!(
            profile_id,
            file_name = %source.file_name,
            chars = parsed.text.len(),
            sections = parsed.sections.len(),
            page_count = ?parsed.page_count,
            "parsed CV document"
        );
        let profile_dir = self.cv_files_dir.join(profile_id);
        std::fs::create_dir_all(&profile_dir)
            .map_err(|e| DomainError::Message(format!("create {}: {e}", profile_dir.display())))?;
        let stored = profile_dir.join(format!("{}{}", source.file_hash, source.file_type));
        std::fs::write(&stored, &source.bytes)
            .map_err(|e| DomainError::Message(format!("write {}: {e}", stored.display())))?;
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let stored_path = stored.to_string_lossy();
        insert_imported_document(
            &self.db,
            ImportRecord {
                profile_id,
                source: &source,
                parsed: &parsed,
                stored_path: &stored_path,
                id: &id,
                now: &now,
            },
        )
        .await?;
        Ok(id)
    }

    async fn store_analysis(
        &self,
        cv_document_id: &str,
        profile_id: &str,
        provider: &Provider,
        analysis: &CvAnalysis,
    ) -> DomainResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        sqlx::query(
            "INSERT INTO cv_analysis_reports (
                id, profile_id, cv_document_id, role_variant_id,
                model_provider, model_name, score, summary, optimization_needed,
                missing_keywords_json, strengths_json, weaknesses_json,
                recommendations_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(cv_document_id)
        .bind(Option::<String>::None)
        .bind(provider.id())
        .bind(provider.default_model())
        .bind(analysis.score)
        .bind(&analysis.summary)
        .bind(analysis.optimization_needed as i64)
        .bind(json_array(&analysis.missing_keywords))
        .bind(json_array(&analysis.strengths))
        .bind(json_array(&analysis.weaknesses))
        .bind(json_array(&analysis.recommendations))
        .bind(&now)
        .execute(&self.db)
        .await?;
        Ok(id)
    }

    async fn latest_analysis(&self, cv_document_id: &str) -> DomainResult<Option<CvAnalysis>> {
        type Row = (
            Option<i64>,
            Option<String>,
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let row: Option<Row> = sqlx::query_as(
            "SELECT score, summary, optimization_needed, missing_keywords_json,
                    strengths_json, weaknesses_json, recommendations_json
             FROM cv_analysis_reports
             WHERE cv_document_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(cv_document_id)
        .fetch_optional(&self.db)
        .await?;

        let decode = |s: Option<String>| -> Vec<String> {
            s.and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .unwrap_or_default()
        };
        Ok(row.map(|r| CvAnalysis {
            score: r.0,
            summary: r.1.unwrap_or_default(),
            optimization_needed: r.2 != 0,
            missing_keywords: decode(r.3),
            strengths: decode(r.4),
            weaknesses: decode(r.5),
            recommendations: decode(r.6),
        }))
    }

    pub async fn create_first_time_rewrite(
        &self,
        profile_id: &str,
        target_title: Option<&str>,
        language: Language,
        candidate_context: &str,
    ) -> DomainResult<String> {
        let candidate_context = candidate_context.trim();
        if candidate_context.is_empty() {
            return Err(DomainError::InvalidInput(
                "candidate context is required to create a first CV".into(),
            ));
        }

        let provider = self.load_provider().await?;
        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_rewrite_prompt(
                "First-time CV request. Use the candidate context as the source of truth.",
                target_title,
                None,
                language,
                Some(candidate_context),
            ),
            system: Some(cv_rewrite_system(language)),
            input_hash: input_hash(&[
                CV_REWRITE_PROMPT_VERSION,
                "first-time-cv",
                profile_id,
                target_title.unwrap_or(""),
                language.code(),
                candidate_context,
            ]),
        };
        let resp = complete_cached(&self.db, &provider, req).await?;
        let mut rewrite = parse_cv_rewrite(&resp.text);
        rewrite.language = language;
        backfill_contact(candidate_context, &mut rewrite.contact);
        backfill_project_links(candidate_context, &mut rewrite.experience);
        rewrite.cover_letter.clear();
        if !has_explicit_certificates(candidate_context, None) {
            rewrite.certificates.clear();
        }
        rewrite.cover_letter =
            generate_cover_letter(&self.db, &provider, &rewrite, target_title, language).await?;
        let metadata = rewrite.cv_metadata();

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let rewrite_json = serde_json::to_string(&rewrite).unwrap_or_else(|_| "{}".to_string());
        let metadata_json = serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string());
        sqlx::query(
            "INSERT INTO cv_rewrites (
                id, profile_id, cv_document_id, role_variant_id,
                model_provider, model_name, rewrite_json, metadata_json,
                source_text, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(provider.id())
        .bind(provider.default_model())
        .bind(&rewrite_json)
        .bind(&metadata_json)
        .bind(candidate_context)
        .bind(&now)
        .execute(&self.db)
        .await?;

        Ok(id)
    }
}

impl CvService for CvServiceImpl {
    async fn read_bytes(&self, cv_document_id: &str) -> DomainResult<Vec<u8>> {
        let stored_path: String =
            sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                .bind(cv_document_id)
                .fetch_optional(&self.db)
                .await
                .map_err(DomainError::Storage)?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("unknown cv_document: {cv_document_id}"))
                })?;

        std::fs::read(&stored_path)
            .map_err(|e| DomainError::InvalidInput(format!("read {stored_path}: {e}")))
    }

    async fn list_documents(&self, profile_id: &str) -> DomainResult<Vec<CvDocumentSummary>> {
        let rows = self.load_document_rows(profile_id).await?;
        let mut lookups = self.load_document_lookups(profile_id).await?;
        Ok(rows
            .into_iter()
            .map(|row| document_summary(profile_id, row, &mut lookups))
            .collect())
    }

    async fn list_analysis_reports(&self, profile_id: &str) -> DomainResult<Vec<CvAnalysisReport>> {
        type Row = (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
                    r.model_provider, r.model_name, r.score, r.summary,
                    r.optimization_needed, r.missing_keywords_json, r.strengths_json,
                    r.weaknesses_json, r.recommendations_json, r.created_at
             FROM cv_analysis_reports r
             LEFT JOIN cv_documents d ON d.id = r.cv_document_id
             LEFT JOIN profile_variants v ON v.id = r.role_variant_id
             WHERE r.profile_id = ?1
             ORDER BY r.created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;

        let decode = |s: Option<String>| -> Vec<String> {
            s.and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .unwrap_or_default()
        };

        let reports = rows
            .into_iter()
            .map(|r| CvAnalysisReport {
                id: r.0,
                cv_document_id: r.1,
                cv_file_name: r.2.unwrap_or_default(),
                role_variant_id: r.3,
                variant_name: r.4,
                model_provider: r.5.unwrap_or_default(),
                model_name: r.6.unwrap_or_default(),
                score: r.7,
                summary: r.8.unwrap_or_default(),
                optimization_needed: r.9 != 0,
                missing_keywords: decode(r.10),
                strengths: decode(r.11),
                weaknesses: decode(r.12),
                recommendations: decode(r.13),
                created_at: r.14,
            })
            .collect();

        Ok(reports)
    }

    async fn import_document(&self, profile_id: &str, path: &str) -> DomainResult<String> {
        let source = read_import_source(path)?;
        if let Some(existing) = self
            .find_existing_document(profile_id, &source.file_hash)
            .await?
        {
            return Ok(existing);
        }
        let parsed = parse_import_source(&source)?;
        self.store_imported_document(profile_id, source, parsed)
            .await
    }

    async fn analyze(&self, cv_document_id: &str, language: Language) -> DomainResult<String> {
        let document = self.load_stored_document(cv_document_id).await?;
        let provider = self.load_provider().await?;

        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_analysis_prompt(&document.parsed.text, None, language),
            system: Some(cv_analysis_system(language)),
            input_hash: input_hash(&[
                CV_ANALYSIS_PROMPT_VERSION,
                &document.file_hash,
                language.code(),
            ]),
        };
        let resp = complete_fresh(&self.db, &provider, req).await?;
        let analysis = parse_cv_analysis(&resp.text);
        self.store_analysis(cv_document_id, &document.profile_id, &provider, &analysis)
            .await
    }

    async fn rewrite(
        &self,
        cv_document_id: &str,
        target_title: Option<&str>,
        language: Language,
        extra_context: Option<&str>,
    ) -> DomainResult<String> {
        let document = self.load_stored_document(cv_document_id).await?;
        let provider = self.load_provider().await?;
        let options = RewriteOptions {
            target_title,
            language,
            extra_context,
        };
        let rewrite = self
            .generate_rewrite(cv_document_id, &document, &provider, options)
            .await?;
        self.store_rewrite(cv_document_id, &document, &provider, &rewrite)
            .await
    }
    async fn list_rewrite_summaries(
        &self,
        profile_id: &str,
    ) -> DomainResult<Vec<CvRewriteSummary>> {
        type Row = (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
                    r.model_provider, r.model_name, json_extract(r.rewrite_json, '$.language'),
                    r.created_at
             FROM cv_rewrites r
             LEFT JOIN cv_documents d ON d.id = r.cv_document_id
             LEFT JOIN profile_variants v ON v.id = r.role_variant_id
             WHERE r.profile_id = ?1
             ORDER BY r.created_at DESC
             LIMIT 200",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| CvRewriteSummary {
                id: r.0,
                cv_document_id: r.1,
                cv_file_name: r.2.unwrap_or_else(|| "First-time CV".to_string()),
                role_variant_id: r.3,
                variant_name: r.4,
                model_provider: r.5.unwrap_or_default(),
                model_name: r.6.unwrap_or_default(),
                language: r.7,
                created_at: r.8,
            })
            .collect())
    }

    async fn get_rewrite(
        &self,
        profile_id: &str,
        rewrite_id: &str,
    ) -> DomainResult<CvRewriteReport> {
        let row: Option<RewriteDetailRow> = sqlx::query_as(
            "SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
                    r.model_provider, r.model_name, r.rewrite_json, r.metadata_json,
                    r.source_text, r.created_at
             FROM cv_rewrites r
             LEFT JOIN cv_documents d ON d.id = r.cv_document_id
             LEFT JOIN profile_variants v ON v.id = r.role_variant_id
             WHERE r.id = ?1 AND r.profile_id = ?2",
        )
        .bind(rewrite_id)
        .bind(profile_id)
        .fetch_optional(&self.db)
        .await?;
        row.map(rewrite_report)
            .ok_or_else(|| DomainError::InvalidInput(format!("cv_rewrite {rewrite_id} not found")))
    }

    async fn delete_document(&self, cv_document_id: &str) -> DomainResult<()> {
        let id = cv_document_id.trim();
        if id.is_empty() {
            return Err(DomainError::InvalidInput(
                "cv_document_id is empty".to_string(),
            ));
        }
        let stored_path: Option<String> =
            sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                .bind(id)
                .fetch_optional(&self.db)
                .await?;

        sqlx::query("DELETE FROM cv_documents WHERE id = ?1")
            .bind(id)
            .execute(&self.db)
            .await?;

        if let Some(path) = stored_path {
            std::fs::remove_file(&path).ok();
        }

        Ok(())
    }
}

impl CvServiceImpl {
    async fn generate_rewrite(
        &self,
        cv_document_id: &str,
        document: &StoredDocument,
        provider: &Provider,
        options: RewriteOptions<'_>,
    ) -> DomainResult<CvRewrite> {
        let analysis = self.latest_analysis(cv_document_id).await?;
        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_rewrite_prompt(
                &document.parsed.text,
                options.target_title,
                analysis.as_ref(),
                options.language,
                options.extra_context,
            ),
            system: Some(cv_rewrite_system(options.language)),
            input_hash: input_hash(&[
                CV_REWRITE_PROMPT_VERSION,
                &document.file_hash,
                options.target_title.unwrap_or(""),
                options.language.code(),
                &analysis_fingerprint(analysis.as_ref()),
                options.extra_context.unwrap_or(""),
            ]),
        };
        let resp = complete_cached(&self.db, provider, req).await?;
        let mut rewrite = parse_cv_rewrite(&resp.text);
        rewrite.language = options.language;
        backfill_contact(&document.parsed.text, &mut rewrite.contact);
        backfill_project_links(&document.parsed.text, &mut rewrite.experience);
        rewrite.cover_letter.clear();
        if !has_explicit_certificates(&document.parsed.text, options.extra_context) {
            rewrite.certificates.clear();
        }
        rewrite.cover_letter = generate_cover_letter(
            &self.db,
            provider,
            &rewrite,
            options.target_title,
            options.language,
        )
        .await?;
        Ok(rewrite)
    }

    async fn store_rewrite(
        &self,
        cv_document_id: &str,
        document: &StoredDocument,
        provider: &Provider,
        rewrite: &CvRewrite,
    ) -> DomainResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let rewrite_json = serde_json::to_string(rewrite).unwrap_or_else(|_| "{}".to_string());
        let metadata_json =
            serde_json::to_string(&rewrite.cv_metadata()).unwrap_or_else(|_| "{}".to_string());
        sqlx::query(
            "INSERT INTO cv_rewrites (
                id, profile_id, cv_document_id, role_variant_id,
                model_provider, model_name, rewrite_json, metadata_json,
                source_text, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&id)
        .bind(&document.profile_id)
        .bind(cv_document_id)
        .bind(Option::<String>::None)
        .bind(provider.id())
        .bind(provider.default_model())
        .bind(&rewrite_json)
        .bind(&metadata_json)
        .bind(&document.parsed.text)
        .bind(&now)
        .execute(&self.db)
        .await?;
        Ok(id)
    }
}

fn stored_kind(file_type: &str) -> DomainResult<DocKind> {
    match file_type {
        "pdf" => Ok(DocKind::Pdf),
        "docx" => Ok(DocKind::Docx),
        other => Err(DomainError::InvalidInput(format!(
            "unsupported stored file type: {other}"
        ))),
    }
}

fn read_import_source(path: &str) -> DomainResult<ImportSource> {
    let src = std::path::Path::new(path);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| DomainError::InvalidInput(format!("bad file path: {path}")))?
        .to_string();
    let kind = cv::detect_kind(&file_name)
        .ok_or_else(|| DomainError::InvalidInput(format!("unsupported file type: {file_name}")))?;
    let file_type = match kind {
        DocKind::Pdf => ".pdf",
        DocKind::Docx => ".docx",
    };
    let bytes =
        std::fs::read(src).map_err(|e| DomainError::InvalidInput(format!("read {path}: {e}")))?;
    let file_hash = cv::hash_bytes(&bytes);
    Ok(ImportSource {
        file_name,
        kind,
        file_type,
        bytes,
        file_hash,
    })
}

fn parse_import_source(source: &ImportSource) -> DomainResult<cv::ParsedDocument> {
    cv::parse(source.kind, &source.bytes)
        .map_err(|e| DomainError::InvalidInput(format!("parse {}: {e}", source.file_name)))
}

fn document_summary(
    profile_id: &str,
    row: CvDocRow,
    lookups: &mut DocumentLookups,
) -> CvDocumentSummary {
    let (id, file_name, file_type, file_hash, size_bytes, page_count, created_at) = row;
    CvDocumentSummary {
        assigned_variants: lookups.variants.remove(&id).unwrap_or_default(),
        is_active: lookups.active.contains(&id),
        last_analysis_score: lookups.scores.get(&id).copied(),
        size_bytes: size_bytes.unwrap_or(0),
        page_count: page_count.unwrap_or(0),
        created_at,
        last_used_at: None,
        file_hash,
        file_name,
        file_type,
        profile_id: profile_id.to_string(),
        sections: Vec::new(),
        id,
    }
}

async fn insert_imported_document(db: &SqlitePool, record: ImportRecord<'_>) -> DomainResult<()> {
    sqlx::query(
        "INSERT INTO cv_documents (
            id, profile_id, file_name, file_type, file_hash, stored_path,
            preview_path, parser_version, last_parsed_at,
            size_bytes, page_count, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(record.id)
    .bind(record.profile_id)
    .bind(&record.source.file_name)
    .bind(record.source.file_type.trim_start_matches('.'))
    .bind(&record.source.file_hash)
    .bind(record.stored_path)
    .bind(Option::<String>::None)
    .bind(cv::PARSER_VERSION)
    .bind(record.now)
    .bind(record.source.bytes.len() as i64)
    .bind(record.parsed.page_count.map(|p| p as i64))
    .bind(record.now)
    .bind(record.now)
    .execute(db)
    .await?;
    Ok(())
}

async fn generate_cover_letter(
    db: &SqlitePool,
    provider: &Provider,
    rewrite: &CvRewrite,
    target_title: Option<&str>,
    language: Language,
) -> DomainResult<String> {
    let cv_json = serde_json::to_string(rewrite).unwrap_or_else(|_| "{}".to_string());
    let req = CompletionRequest {
        model: provider.default_model().to_string(),
        prompt: cover_letter_prompt(rewrite, target_title, language),
        system: Some(cover_letter_system(language)),
        input_hash: input_hash(&[
            COVER_LETTER_PROMPT_VERSION,
            language.code(),
            target_title.unwrap_or(""),
            &cv_json,
        ]),
    };
    let resp = complete_cached(db, provider, req).await?;
    let letter = parse_cover_letter(&resp.text);
    if letter.is_empty() {
        return Err(DomainError::InvalidInput(
            "AI returned an empty cover letter".to_string(),
        ));
    }
    Ok(letter)
}

fn json_array(items: &[String]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}

fn analysis_fingerprint(analysis: Option<&CvAnalysis>) -> String {
    match analysis {
        None => "no-analysis".to_string(),
        Some(a) => format!(
            "{}|{}|{}|{}|{}|{}|{}",
            a.score.map(|s| s.to_string()).unwrap_or_default(),
            a.summary,
            a.optimization_needed,
            json_array(&a.missing_keywords),
            json_array(&a.strengths),
            json_array(&a.weaknesses),
            json_array(&a.recommendations),
        ),
    }
}

#[cfg(test)]
#[path = "cv_tests.rs"]
mod tests;
