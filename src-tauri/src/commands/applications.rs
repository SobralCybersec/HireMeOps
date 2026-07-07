//! Application commands: draft a tailored application for a scored job match.
//! Thin IPC wrappers that delegate to the concrete `ApplicationService` and
//! flatten `DomainError` into a `String` for the frontend.

use tauri::State;

use crate::domain::applications::{ApplicationService, ApplicationServiceImpl};
use crate::AppState;

fn service(state: &AppState) -> ApplicationServiceImpl {
    ApplicationServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

/// Draft an application (cover letter + form answers) for `job_match_id`,
/// tailored via the cached AI provider. Returns the new `application_drafts.id`.
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
