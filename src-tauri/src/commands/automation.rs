//! Automation control commands. Phase 1 ships safe stubs; the real supervisor
//! (see `domain::automation`) lands in Phase 4. The emergency stop already
//! broadcasts on the event bus so the UI and future supervisor stay in sync.

use tauri::AppHandle;

use crate::events::{AppEvent, AppEventType, EventEmitter};

#[tauri::command]
pub fn automation_start() -> Result<(), String> {
    tracing::info!("automation_start (Phase 1 stub)");
    Ok(())
}

#[tauri::command]
pub fn automation_pause() -> Result<(), String> {
    tracing::info!("automation_pause (Phase 1 stub)");
    Ok(())
}

#[tauri::command]
pub fn automation_resume() -> Result<(), String> {
    tracing::info!("automation_resume (Phase 1 stub)");
    Ok(())
}

#[tauri::command]
pub fn automation_stop(app: AppHandle) -> Result<(), String> {
    app.emit_app_event(AppEvent::new(
        AppEventType::AutomationStopped,
        serde_json::json!({ "reason": "user_stop" }),
    ));
    Ok(())
}

/// Global kill-switch — always available (button + Ctrl/Cmd+Shift hotkey).
#[tauri::command]
pub fn automation_emergency_stop(app: AppHandle) -> Result<(), String> {
    tracing::warn!("EMERGENCY STOP invoked by user");
    app.emit_app_event(AppEvent::new(
        AppEventType::AutomationStopped,
        serde_json::json!({ "reason": "user_emergency_stop" }),
    ));
    Ok(())
}
