//! Automation control commands — the operator's cockpit over the browser
//! automation supervisor (see `domain::automation`).
//!
//! These commands drive the *canonical* emergency-stop latch held in
//! [`AppState::emergency_stop`]. Every `BrowserSupervisor` is constructed
//! sharing that same `Arc<AtomicBool>`, so flipping it here halts any in-flight
//! browser task at its next checkpoint. The latch is authoritative even when no
//! supervisor is running: a later task that starts while the latch is set
//! aborts before opening a browser.
//!
//! Semantics:
//!   - `start` / `resume` → **clear** the latch (work may run again).
//!   - `pause` / `stop`   → **set** the latch (halt between/within tasks).
//!   - `emergency_stop`   → **set** the latch immediately; the global
//!     kill-switch (button + Ctrl/Cmd+Shift hotkey). Synchronous & infallible —
//!     an atomic store that can never block or fail.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use crate::events::{AppEvent, AppEventType, EventEmitter};
use crate::AppState;

/// Begin/allow automation: clear the emergency-stop latch so queued browser
/// tasks may run. (A deliberate start also clears any prior latch inside the
/// supervisor itself.)
#[tauri::command]
pub fn automation_start(state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(false, Ordering::SeqCst);
    tracing::info!("automation_start — emergency-stop latch cleared");
    Ok(())
}

/// Pause automation: set the latch so no new browser work begins and any
/// in-flight task aborts at its next checkpoint.
#[tauri::command]
pub fn automation_pause(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(true, Ordering::SeqCst);
    tracing::info!("automation_pause — emergency-stop latch set");
    app.emit_app_event(AppEvent::new(
        AppEventType::AutomationStopped,
        serde_json::json!({ "reason": "user_pause" }),
    ));
    Ok(())
}

/// Resume automation after a pause: clear the latch.
#[tauri::command]
pub fn automation_resume(state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(false, Ordering::SeqCst);
    tracing::info!("automation_resume — emergency-stop latch cleared");
    Ok(())
}

/// Stop automation: set the latch and broadcast so the UI reflects the halt.
#[tauri::command]
pub fn automation_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(true, Ordering::SeqCst);
    tracing::info!("automation_stop — emergency-stop latch set");
    app.emit_app_event(AppEvent::new(
        AppEventType::AutomationStopped,
        serde_json::json!({ "reason": "user_stop" }),
    ));
    Ok(())
}

/// Global kill-switch — always available (button + Ctrl/Cmd+Shift hotkey).
///
/// Flips the shared latch with a single atomic store (immediate, never blocks,
/// never fails) and broadcasts on the event bus so the whole UI reflects it.
#[tauri::command]
pub fn automation_emergency_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(true, Ordering::SeqCst);
    tracing::warn!("EMERGENCY STOP invoked by user — emergency-stop latch set");
    app.emit_app_event(AppEvent::new(
        AppEventType::AutomationStopped,
        serde_json::json!({ "reason": "user_emergency_stop" }),
    ));
    Ok(())
}
