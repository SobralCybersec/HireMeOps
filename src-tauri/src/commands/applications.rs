//! Application commands: draft a tailored application for a scored job match.
//! Thin IPC wrappers that delegate to the concrete `ApplicationService` and
//! flatten `DomainError` into a `String` for the frontend.
//! Key: `draft_application` — AI-tailored cover letter + form answers for a job match.
//! Key: `submit_application` — queue a reviewed draft for the manual-assist automation flow.

use tauri::{AppHandle, State};

use crate::domain::applications::{ApplicationService, ApplicationServiceImpl};
use crate::events::{AppEvent, AppEventType, EventEmitter};
use crate::AppState;

fn service(state: &AppState) -> ApplicationServiceImpl {
    ApplicationServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

/* Emit a coarse AI status milestone so the UI can show "ENI is generating…"
   live. Buffered delivery is unchanged — this only reports where we are. */
fn ai_progress(app: &AppHandle, phase: &str) {
    app.emit_app_event(AppEvent::new(
        AppEventType::AiProgress,
        serde_json::json!({ "phase": phase, "scope": "application_draft" }),
    ));
}

#[tauri::command]
pub async fn draft_application(
    app: AppHandle,
    state: State<'_, AppState>,
    job_match_id: String,
) -> Result<String, String> {
    ai_progress(&app, "generating");
    let result = service(&state).draft(&job_match_id).await;
    ai_progress(&app, if result.is_ok() { "ready" } else { "failed" });
    result.map_err(|e| e.to_string())
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
