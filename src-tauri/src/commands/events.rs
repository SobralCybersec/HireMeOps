//! Event diagnostics command.

use tauri::AppHandle;

use crate::events::{AppEvent, AppEventType, EventEmitter};

/// Emit a synthetic `log` event — used by the UI to verify the event bridge.
#[tauri::command]
pub fn emit_test_event(app: AppHandle) -> Result<(), String> {
    app.emit_app_event(AppEvent::new(
        AppEventType::Log,
        serde_json::json!({ "level": "info", "message": "test event from backend" }),
    ));
    Ok(())
}
