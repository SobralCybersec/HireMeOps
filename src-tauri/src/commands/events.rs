//! Event diagnostics command.

use tauri::AppHandle;

use crate::events::{AppEvent, AppEventType, EventEmitter};

#[tauri::command]
pub fn emit_test_event(app: AppHandle) -> Result<(), String> {
    app.emit_app_event(AppEvent::new(
        AppEventType::Log,
        serde_json::json!({ "level": "info", "message": "test event from backend" }),
    ));
    Ok(())
}
