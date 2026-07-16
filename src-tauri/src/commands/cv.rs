//! CV commands: import a PDF/DOCX into a profile's document store, and analyze.
//! Thin IPC wrappers that delegate to the concrete `CvService` and flatten
//! `DomainError` into a `String` for the frontend.

use tauri::State;

use crate::domain::cv::{
    CvAnalysisReport, CvDocumentSummary, CvRewriteReport, CvService, CvServiceImpl,
};
use crate::AppState;

fn service(state: &AppState) -> CvServiceImpl {
    CvServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

/// Import a CV file from an absolute path into `profile_id`'s document store.
/// Returns the (new or, on re-import, existing) `cv_documents.id`.
#[tauri::command]
pub async fn import_cv_document(
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
) -> Result<String, String> {
    service(&state)
        .import_document(&profile_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Run gap/quality analysis for a stored CV document (AI-backed, Phase 4).
#[tauri::command]
pub async fn analyze_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
) -> Result<String, String> {
    service(&state)
        .analyze(&cv_document_id)
        .await
        .map_err(|e| e.to_string())
}

/// Produce a REWRITTEN CV (not a critique) tailored to `target_title`, tailored
/// to the source document, persist it plus its derived PDF metadata, and return
/// the new `cv_rewrites.id`. Invoked as
/// `rewrite_cv_document({ cvDocumentId, targetTitle })`; Tauri maps the camelCase
/// args to `cv_document_id` / `target_title`.
#[tauri::command]
pub async fn rewrite_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
    target_title: Option<String>,
) -> Result<String, String> {
    service(&state)
        .rewrite(&cv_document_id, target_title.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Read the raw bytes of a stored CV document, for the frontend PDF viewer.
/// The frontend loader (`pdf.ts`) invokes this as `cv_read_bytes({ cvId })`;
/// Tauri maps `cvId` → `cv_id`.
#[tauri::command]
pub async fn cv_read_bytes(state: State<'_, AppState>, cv_id: String) -> Result<Vec<u8>, String> {
    service(&state)
        .read_bytes(&cv_id)
        .await
        .map_err(|e| e.to_string())
}

/// List a profile's CV documents, enriched for the CV Library page (active
/// flag, latest analysis score, assigned variants). Invoked from the frontend
/// as `list_cv_documents({ profileId })`; Tauri maps `profileId` → `profile_id`.
#[tauri::command]
pub async fn list_cv_documents(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvDocumentSummary>, String> {
    service(&state)
        .list_documents(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

/// List a profile's persisted CV analysis reports, newest first, for the CV
/// Analysis history panel. Invoked as `list_cv_analysis_reports({ profileId })`;
/// Tauri maps `profileId` → `profile_id`.
#[tauri::command]
pub async fn list_cv_analysis_reports(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvAnalysisReport>, String> {
    service(&state)
        .list_analysis_reports(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

/// List a profile's persisted CV rewrites, newest first, for the CV rewrite
/// history / display. Invoked as `list_cv_rewrites({ profileId })`; Tauri maps
/// `profileId` → `profile_id`.
#[tauri::command]
pub async fn list_cv_rewrites(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvRewriteReport>, String> {
    service(&state)
        .list_rewrites(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

/// Export a persisted CV rewrite as a PDF, returning the raw bytes for the
/// frontend to save/open. Invoked as `export_cv_rewrite({ rewriteId, mode })`;
/// Tauri maps `rewriteId` → `rewrite_id`.
///
/// `mode` is `"new"` (render a fresh PDF from the structured rewrite) or
/// `"modify"` (inject the derived PDF metadata into a copy of the *source*
/// document's existing PDF — the `ResumeService.addPDFMetadata` path). `"modify"`
/// gracefully falls back to `"new"` when the source is missing or isn't a PDF
/// (e.g. a DOCX import), so the caller always gets bytes.
///
/// Reads `cv_rewrites` / `cv_documents` directly here (rather than adding a
/// method to `CvServiceImpl`) to keep the shared `domain/cv.rs` untouched.
#[tauri::command]
pub async fn export_cv_rewrite(
    state: State<'_, AppState>,
    rewrite_id: String,
    mode: String,
) -> Result<Vec<u8>, String> {
    use crate::ai::prompt::{CvMetadata, CvRewrite};
    use crate::cv::export::{self, ExportMode};

    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT rewrite_json, metadata_json, cv_document_id FROM cv_rewrites WHERE id = ?1",
    )
    .bind(&rewrite_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let (rewrite_json, metadata_json, cv_document_id) =
        row.ok_or_else(|| format!("unknown cv_rewrite: {rewrite_id}"))?;

    let rewrite: CvRewrite =
        serde_json::from_str(&rewrite_json).map_err(|e| format!("decode rewrite: {e}"))?;
    // Recompute metadata from the rewrite if the stored column is malformed —
    // mirrors `list_rewrites`' self-healing so a drifted row still exports.
    let metadata: CvMetadata =
        serde_json::from_str(&metadata_json).unwrap_or_else(|_| rewrite.cv_metadata());

    if ExportMode::parse(&mode) == ExportMode::Modify {
        if let Some(doc_id) = cv_document_id {
            let stored: Option<String> =
                sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                    .bind(&doc_id)
                    .fetch_optional(&state.db)
                    .await
                    .map_err(|e| e.to_string())?;
            if let Some(path) = stored {
                if let Ok(bytes) = std::fs::read(&path) {
                    if bytes.starts_with(b"%PDF") {
                        return export::embed_metadata(&bytes, &metadata);
                    }
                }
            }
        }
        // Source unavailable / not a PDF — fall through to a fresh render.
    }

    export::build_pdf(&rewrite, &metadata)
}
