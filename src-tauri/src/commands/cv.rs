//! CV commands: import a PDF/DOCX into a profile's document store, and analyze.
//! Thin IPC wrappers that delegate to the concrete `CvService` and flatten
//! `DomainError` into a `String` for the frontend.

use tauri::State;

use crate::domain::cv::{CvAnalysisReport, CvDocumentSummary, CvService, CvServiceImpl};
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
