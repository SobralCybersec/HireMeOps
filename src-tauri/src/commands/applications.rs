//! Application commands: draft a tailored application for a scored job match.
//! Thin IPC wrappers that delegate to the concrete `ApplicationService` and
//! flatten `DomainError` into a `String` for the frontend.
//! Key: `draft_application` — AI-tailored cover letter + form answers for a job match.
//! Key: `submit_application` — queue a reviewed draft for the manual-assist automation flow.

use tauri::State;

use crate::domain::applications::{ApplicationService, ApplicationServiceImpl};
use crate::AppState;

fn service(state: &AppState) -> ApplicationServiceImpl {
    ApplicationServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

#[tauri::command]
pub async fn draft_application(
    state: State<'_, AppState>,
    job_match_id: String,
) -> Result<String, String> {
    service(&state)
        .draft(&job_match_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn submit_application(
    state: State<'_, AppState>,
    application_draft_id: String,
) -> Result<String, String> {
    service(&state)
        .submit(&application_draft_id)
        .await
        .map_err(|e| e.to_string())
}
