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
    cv_analysis_prompt, cv_analysis_system, cv_rewrite_prompt, cv_rewrite_system,
    parse_cv_analysis, parse_cv_rewrite, CvAnalysis, CvMetadata, CvRewrite, Language,
    CV_ANALYSIS_PROMPT_VERSION, CV_REWRITE_PROMPT_VERSION,
};
use crate::ai::{complete_cached, input_hash, select_provider_resolved};
use crate::cv::{self, DocKind};
use crate::domain::ai::{AiProvider, CompletionRequest};
use crate::storage::settings::load_ai_providers;
use crate::util::now_iso;

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
    async fn list_rewrites(&self, profile_id: &str) -> DomainResult<Vec<CvRewriteReport>>;
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

        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }

        let source_text =
            "First-time CV request. Use the candidate context as the source of truth.";
        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_rewrite_prompt(
                source_text,
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
        /* (id, file_name, file_type, file_hash, size_bytes, page_count, created_at) */
        type CvDocRow = (
            String,
            String,
            String,
            String,
            Option<i64>,
            Option<i64>,
            String,
        );
        let rows: Vec<CvDocRow> = sqlx::query_as(
            "SELECT id, file_name, file_type, file_hash, size_bytes, page_count, created_at
                 FROM cv_documents WHERE profile_id = ?1 ORDER BY created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;

        let active_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT cv_document_id FROM profile_active_cvs WHERE profile_id = ?1",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let active: HashSet<String> = active_rows.into_iter().map(|(id,)| id).collect();

        let variant_rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT pac.cv_document_id, pv.id, pv.name
             FROM profile_active_cvs pac
             JOIN profile_variants pv ON pv.id = pac.role_variant_id
             WHERE pac.profile_id = ?1
             ORDER BY pac.priority ASC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let mut variants: HashMap<String, Vec<CvVariantRef>> = HashMap::new();
        for (doc_id, vid, vname) in variant_rows {
            variants.entry(doc_id).or_default().push(CvVariantRef {
                id: vid,
                name: vname,
            });
        }

        let score_rows: Vec<(Option<String>, Option<i64>)> = sqlx::query_as(
            "SELECT cv_document_id, score FROM cv_analysis_reports
             WHERE profile_id = ?1 AND cv_document_id IS NOT NULL
             ORDER BY created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        let mut scores: HashMap<String, i64> = HashMap::new();
        for (doc_id, score) in score_rows {
            if let (Some(doc_id), Some(score)) = (doc_id, score) {
                scores.entry(doc_id).or_insert(score);
            }
        }

        let summaries = rows
            .into_iter()
            .map(
                |(id, file_name, file_type, file_hash, size_bytes, page_count, created_at)| {
                    let assigned_variants = variants.remove(&id).unwrap_or_default();
                    let is_active = active.contains(&id);
                    let last_analysis_score = scores.get(&id).copied();
                    CvDocumentSummary {
                        assigned_variants,
                        is_active,
                        last_analysis_score,
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
                },
            )
            .collect();

        Ok(summaries)
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
        let src = std::path::Path::new(path);
        let file_name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| DomainError::InvalidInput(format!("bad file path: {path}")))?
            .to_string();

        let kind = cv::detect_kind(&file_name).ok_or_else(|| {
            DomainError::InvalidInput(format!("unsupported file type: {file_name}"))
        })?;
        let file_type = match kind {
            DocKind::Pdf => "pdf",
            DocKind::Docx => "docx",
        };

        let bytes = std::fs::read(src)
            .map_err(|e| DomainError::InvalidInput(format!("read {path}: {e}")))?;
        let file_hash = cv::hash_bytes(&bytes);

        if let Some(existing) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM cv_documents WHERE profile_id = ?1 AND file_hash = ?2",
        )
        .bind(profile_id)
        .bind(&file_hash)
        .fetch_optional(&self.db)
        .await?
        {
            return Ok(existing);
        }

        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse {file_name}: {e}")))?;
        tracing::debug!(
            profile_id,
            file_name = %file_name,
            chars = parsed.text.len(),
            sections = parsed.sections.len(),
            page_count = ?parsed.page_count,
            "parsed CV document"
        );

        let profile_dir = self.cv_files_dir.join(profile_id);
        std::fs::create_dir_all(&profile_dir)
            .map_err(|e| DomainError::Message(format!("create {}: {e}", profile_dir.display())))?;
        let stored = profile_dir.join(format!("{file_hash}.{file_type}"));
        std::fs::write(&stored, &bytes)
            .map_err(|e| DomainError::Message(format!("write {}: {e}", stored.display())))?;
        let stored_path = stored.to_string_lossy().into_owned();

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let size_bytes = bytes.len() as i64;
        let page_count = parsed.page_count.map(|p| p as i64);

        sqlx::query(
            "INSERT INTO cv_documents (
                id, profile_id, file_name, file_type, file_hash, stored_path,
                preview_path, parser_version, last_parsed_at,
                size_bytes, page_count, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(&file_name)
        .bind(file_type)
        .bind(&file_hash)
        .bind(&stored_path)
        .bind(Option::<String>::None)
        .bind(cv::PARSER_VERSION)
        .bind(&now)
        .bind(size_bytes)
        .bind(page_count)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await?;

        Ok(id)
    }

    async fn analyze(&self, cv_document_id: &str, language: Language) -> DomainResult<String> {
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

        let kind = match file_type.as_str() {
            "pdf" => DocKind::Pdf,
            "docx" => DocKind::Docx,
            other => {
                return Err(DomainError::InvalidInput(format!(
                    "unsupported stored file type: {other}"
                )))
            }
        };
        let bytes = std::fs::read(&stored_path)
            .map_err(|e| DomainError::InvalidInput(format!("read {stored_path}: {e}")))?;
        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse cv document: {e}")))?;

        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }

        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_analysis_prompt(&parsed.text, None, language),
            system: Some(cv_analysis_system(language)),
            input_hash: input_hash(&[CV_ANALYSIS_PROMPT_VERSION, &file_hash, language.code()]),
        };
        let resp = complete_cached(&self.db, &provider, req).await?;
        let analysis = parse_cv_analysis(&resp.text);

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let model_provider = provider.id();
        let model_name = provider.default_model();
        sqlx::query(
            "INSERT INTO cv_analysis_reports (
                id, profile_id, cv_document_id, role_variant_id,
                model_provider, model_name, score, summary, optimization_needed,
                missing_keywords_json, strengths_json, weaknesses_json,
                recommendations_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )
        .bind(&id)
        .bind(&profile_id)
        .bind(cv_document_id)
        .bind(Option::<String>::None)
        .bind(model_provider)
        .bind(model_name)
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

    async fn rewrite(
        &self,
        cv_document_id: &str,
        target_title: Option<&str>,
        language: Language,
        extra_context: Option<&str>,
    ) -> DomainResult<String> {
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

        let kind = match file_type.as_str() {
            "pdf" => DocKind::Pdf,
            "docx" => DocKind::Docx,
            other => {
                return Err(DomainError::InvalidInput(format!(
                    "unsupported stored file type: {other}"
                )))
            }
        };
        let bytes = std::fs::read(&stored_path)
            .map_err(|e| DomainError::InvalidInput(format!("read {stored_path}: {e}")))?;
        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse cv document: {e}")))?;

        let (providers, default_index) = load_ai_providers(&self.db).await?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            ));
        }

        let analysis = self.latest_analysis(cv_document_id).await?;

        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: cv_rewrite_prompt(
                &parsed.text,
                target_title,
                analysis.as_ref(),
                language,
                extra_context,
            ),
            system: Some(cv_rewrite_system(language)),
            input_hash: input_hash(&[
                CV_REWRITE_PROMPT_VERSION,
                &file_hash,
                target_title.unwrap_or(""),
                language.code(),
                &analysis_fingerprint(analysis.as_ref()),
                extra_context.unwrap_or(""),
            ]),
        };
        let resp = complete_cached(&self.db, &provider, req).await?;
        let mut rewrite = parse_cv_rewrite(&resp.text);
        rewrite.language = language;
        backfill_contact(&parsed.text, &mut rewrite.contact);
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
        .bind(&profile_id)
        .bind(cv_document_id)
        .bind(Option::<String>::None)
        .bind(provider.id())
        .bind(provider.default_model())
        .bind(&rewrite_json)
        .bind(&metadata_json)
        .bind(&parsed.text)
        .bind(&now)
        .execute(&self.db)
        .await?;

        Ok(id)
    }

    async fn list_rewrites(&self, profile_id: &str) -> DomainResult<Vec<CvRewriteReport>> {
        type Row = (
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
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
                    r.model_provider, r.model_name, r.rewrite_json, r.metadata_json,
                    r.source_text, r.created_at
             FROM cv_rewrites r
             LEFT JOIN cv_documents d ON d.id = r.cv_document_id
             LEFT JOIN profile_variants v ON v.id = r.role_variant_id
             WHERE r.profile_id = ?1
             ORDER BY r.created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;

        let reports = rows
            .into_iter()
            .map(|r| {
                let rewrite = serde_json::from_str::<CvRewrite>(&r.7).unwrap_or_default();
                let metadata = serde_json::from_str::<CvMetadata>(&r.8)
                    .unwrap_or_else(|_| rewrite.cv_metadata());
                CvRewriteReport {
                    id: r.0,
                    cv_document_id: r.1,
                    cv_file_name: r.2.unwrap_or_else(|| "First-time CV".to_string()),
                    role_variant_id: r.3,
                    variant_name: r.4,
                    model_provider: r.5.unwrap_or_default(),
                    model_name: r.6.unwrap_or_default(),
                    rewrite,
                    metadata,
                    source_text: r.9,
                    created_at: r.10,
                }
            })
            .collect();

        Ok(reports)
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

/// Deterministic safety net for contact extraction: the model is told to copy
/// every contact field, but when it leaves one empty (or the JSON shape was
/// missing a channel, e.g. gitlab on old prompts) we recover it straight from
/// the source text. Fills ONLY empty fields; never invents anything not
/// literally present in `src`.
fn backfill_contact(src: &str, contact: &mut crate::ai::prompt::CvContact) {
    let take = |s: &str, start: usize, end: usize| {
        let token = s[start..end]
            .trim()
            .trim_end_matches(['/', '.', ',', ';', ')', '?', '>']);
        if token.contains(char::is_whitespace) {
            String::new()
        } else {
            token.to_string()
        }
    };

    if contact.email.is_empty() {
        for (at, _) in src.match_indices('@') {
            let domain_start = at + 1;
            let mut domain_end = src.len();
            for (offset, c) in src[domain_start..].char_indices() {
                if c.is_whitespace() || matches!(c, ',' | ';' | '<' | '>' | '"' | '(' | ')') {
                    domain_end = domain_start + offset;
                    break;
                }
            }

            let domain = take(src, domain_start, domain_end);
            if domain.len() <= 2 || !domain.contains('.') || domain.ends_with('.') {
                continue;
            }

            let mut local_start = at;
            for (idx, c) in src[..at].char_indices().rev() {
                if c.is_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-') {
                    local_start = idx;
                } else {
                    break;
                }
            }

            if local_start < at {
                contact.email = format!("{}@{}", &src[local_start..at], domain);
                break;
            }
        }
    }

    for (needle, slot) in [
        ("github.com/", &mut contact.github),
        ("gitlab.com/", &mut contact.gitlab),
        ("linkedin.com/in/", &mut contact.linkedin),
    ] {
        if !slot.is_empty() {
            continue;
        }

        for (start, _) in src.match_indices(needle) {
            let value_start = start + needle.len();
            let mut value_end = src.len();
            for (offset, c) in src[value_start..].char_indices() {
                if c.is_whitespace() || matches!(c, '/' | '\\' | '?' | '#' | ',' | ';' | ')' | '"')
                {
                    value_end = value_start + offset;
                    break;
                }
            }

            let token = take(src, value_start, value_end);
            if !token.is_empty() {
                *slot = token;
                break;
            }
        }
    }

    if contact.phone.is_empty() {
        let mut scratch: Vec<char> = Vec::new();
        let mut digit_count = 0;
        for c in src.chars().chain(std::iter::once('\0')) {
            let keep = c.is_ascii_digit() || matches!(c, '+' | '(' | ')' | '.' | '-' | ' ');
            if keep {
                scratch.push(c);
                if c.is_ascii_digit() {
                    digit_count += 1;
                }
            } else {
                if digit_count >= 10 && scratch.len() <= 24 {
                    contact.phone = scratch.iter().collect::<String>().trim().to_string();
                    break;
                }
                scratch.clear();
                digit_count = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompt::CvContact;
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

    #[test]
    fn backfill_fills_only_empty_fields_from_source_text() {
        let mut contact = CvContact::default();
        backfill_contact(
            "João Silva\njoao.silva@email.com\n+55 11 91234-5678\n\
             https://github.com/joaosilva  gitlab.com/joao-dev\n\
             https://linkedin.com/in/joao-silva",
            &mut contact,
        );
        assert_eq!(contact.email, "joao.silva@email.com");
        assert_eq!(contact.phone, "+55 11 91234-5678");
        assert_eq!(contact.github, "joaosilva");
        assert_eq!(contact.gitlab, "joao-dev");
        assert_eq!(contact.linkedin, "joao-silva");
        assert!(contact.website.is_empty(), "website must stay empty");

        let mut prefilled = CvContact {
            email: "kept@mail.com".to_string(),
            ..Default::default()
        };
        backfill_contact("other@mail.com", &mut prefilled);
        assert_eq!(prefilled.email, "kept@mail.com");
    }

    #[test]
    fn backfill_handles_utf8_before_contact_links_without_panicking() {
        let mut contact = CvContact::default();
        backfill_contact(
            "Óscar João — óscar.joao@example.com — https://github.com/oscarjoao",
            &mut contact,
        );

        assert_eq!(contact.email, "óscar.joao@example.com");
        assert_eq!(contact.github, "oscarjoao");
    }

    fn unique_tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hiremeops-cv-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fixture(name: &str) -> String {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[tokio::test]
    async fn read_bytes_returns_stored_content_and_errors_on_unknown_id() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());
        let pdf = fixture("sample.pdf");

        let id = svc.import_document("p1", &pdf).await.unwrap();

        let got = svc.read_bytes(&id).await.unwrap();
        let expected = std::fs::read(&pdf).unwrap();
        assert_eq!(got, expected);
        assert!(!got.is_empty());

        let err = svc.read_bytes("does-not-exist").await.unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn imports_pdf_persists_metadata_and_is_idempotent() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());
        let pdf = fixture("sample.pdf");

        let id1 = svc.import_document("p1", &pdf).await.unwrap();

        let (ft, pages, size, ver): (String, Option<i64>, Option<i64>, Option<String>) =
            sqlx::query_as(
                "SELECT file_type, page_count, size_bytes, parser_version
                 FROM cv_documents WHERE id = ?1",
            )
            .bind(&id1)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(ft, "pdf");
        assert_eq!(pages, Some(2));
        assert!(size.unwrap() > 0);
        assert_eq!(ver.as_deref(), Some(cv::PARSER_VERSION));

        assert!(tmp.join("p1").read_dir().unwrap().next().is_some());

        let id2 = svc.import_document("p1", &pdf).await.unwrap();
        assert_eq!(id1, id2);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn imports_docx_with_no_page_count() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

        let id = svc
            .import_document("p1", &fixture("sample.docx"))
            .await
            .unwrap();
        let (ft, pages): (String, Option<i64>) =
            sqlx::query_as("SELECT file_type, page_count FROM cv_documents WHERE id = ?1")
                .bind(&id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(ft, "docx");
        assert_eq!(pages, None);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn rejects_unsupported_extension_without_persisting() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

        let err = svc
            .import_document("p1", "/nonexistent/whatever.txt")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);

        std::fs::remove_dir_all(&tmp).ok();
    }
}
