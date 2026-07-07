//! CV commands: import a PDF/DOCX into a profile's document store, and analyze.
//! Thin IPC wrappers that delegate to the concrete `CvService` and flatten
//! `DomainError` into a `String` for the frontend.

use tauri::State;

use crate::domain::cv::{CvService, CvServiceImpl};
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
