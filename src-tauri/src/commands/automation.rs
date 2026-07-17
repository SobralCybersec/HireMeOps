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
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::events::{AppEvent, AppEventType, EventEmitter};
use crate::AppState;

/// Emit an authoritative automation lifecycle state to the cockpit. The
/// frontend maps these `automation.state` events onto `useAutomationStore`, so
/// the UI reflects what the backend engine is *actually* doing rather than
/// guessing optimistically.
fn emit_state(
    app: &AppHandle,
    state: &str,
    task_id: Option<&str>,
    detail: Option<&str>,
    watch_url: Option<&str>,
) {
    let mut payload = serde_json::json!({ "state": state });
    if let Some(t) = task_id {
        payload["taskId"] = serde_json::Value::String(t.to_string());
    }
    if let Some(d) = detail {
        payload["detail"] = serde_json::Value::String(d.to_string());
    }
    if let Some(u) = watch_url {
        payload["watchUrl"] = serde_json::Value::String(u.to_string());
    }
    app.emit_app_event(AppEvent::new(AppEventType::AutomationStateChanged, payload));
}

/// Begin automation: clear the emergency-stop latch, then spawn the engine that
/// drains queued `apply_job` tasks through the browser supervisor, streaming
/// authoritative state back to the cockpit.
///
/// Previously this only flipped a latch and returned, so the frontend's
/// optimistic "Preparing Browser" never advanced — clicking Start appeared to
/// do nothing. Now the backend drives the state to a terminal outcome and
/// **never leaves the cockpit hanging**, even when there is nothing to run or
/// no browser engine is compiled in.
#[tauri::command]
pub fn automation_start(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(false, Ordering::SeqCst);
    tracing::info!("automation_start — emergency-stop latch cleared");

    // Immediate ack so the cockpit leaves "Queued" the instant Start is
    // accepted; the spawned engine then drives the authoritative state.
    emit_state(&app, "PreparingBrowser", None, None, None);

    let db    = state.db.clone();
    let stop  = state.emergency_stop.clone();
    let app_for_engine = app.clone();

    #[cfg(feature = "real-browser")]
    let driver = state.playwright.clone();

    tauri::async_runtime::spawn(async move {
        #[cfg(feature = "real-browser")]
        run_engine(app_for_engine, db, stop, driver).await;
        #[cfg(not(feature = "real-browser"))]
        run_engine_stub(app_for_engine, db).await;
    });
    Ok(())
}

/// Drive the queued automation tasks to completion using the Playwright worker.
/// Feature-gated: only compiled when `real-browser` is enabled.
#[cfg(feature = "real-browser")]
async fn run_engine(
    app: AppHandle,
    db: sqlx::SqlitePool,
    stop: Arc<std::sync::atomic::AtomicBool>,
    driver: Arc<crate::browser::playwright::PlaywrightDriver>,
) {
    use crate::domain::automation::run_automation_queue;

    let emitter = app.clone();
    let result = run_automation_queue(&db, driver, stop, move |s, task, url, hr_name, _hr_link| {
        emit_state(&emitter, s, task, hr_name, url);
    })
    .await;

    if let Err(e) = result {
        tracing::error!("automation engine failed: {e}");
        emit_state(&app, "Failed", None, Some(&e.to_string()), None);
    }
}

/// Feature-off stub: report honestly instead of hanging on "Preparing Browser".
#[cfg(not(feature = "real-browser"))]
async fn run_engine_stub(app: AppHandle, db: sqlx::SqlitePool) {
    let queued: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM automation_tasks WHERE task_type = 'apply_job' AND status = 'queued'",
    )
    .fetch_one(&db)
    .await
    .unwrap_or(0);

    if queued == 0 {
        emit_state(
            &app,
            "Completed",
            None,
            Some("No applications are queued. Draft an application first, then start automation."),
        );
    } else {
        emit_state(
            &app,
            "Failed",
            None,
            Some(&format!(
                "{queued} application(s) queued, but the real browser engine is not enabled in \
                 this build. Rebuild with `--features real-browser` to run automation."
            )),
        );
    }
}

// ---------------------------------------------------------------------------
// Human-in-the-loop confirm / reject
// ---------------------------------------------------------------------------

/// Confirm the currently-parked Easy Apply form submission.
///
/// Called from the cockpit after the user has reviewed the filled form in the
/// visible Chromium window and decided to proceed.  The Playwright worker
/// clicks the Submit button on the user's behalf.
///
/// Returns an error string if no session is currently parked.
#[tauri::command]
pub async fn automation_confirm_submit(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        let meta = state
            .playwright
            .confirm_submit_parked()
            .await
            .map_err(|e| e.to_string())?;

        // Persist evidence + update DB rows when context ids are available.
        if let (Some(task_id), Some(session_id)) = (&meta.task_id, &meta.session_id) {
            let now = crate::util::now_iso();

            // Screenshot taken right after Submit.
            if let Some(shot) = &meta.screenshot_path {
                let _ = sqlx::query(
                    "INSERT INTO automation_evidence
                       (id, task_id, evidence_type, file_path, created_at)
                     VALUES (?1, ?2, 'screenshot', ?3, ?4)",
                )
                .bind(crate::util::new_id())
                .bind(task_id)
                .bind(shot)
                .bind(&now)
                .execute(&state.db)
                .await;
            }

            // Mark the browser session closed.
            let _ = sqlx::query(
                "UPDATE browser_sessions
                 SET status = 'closed', ended_at = ?1, updated_at = ?1
                 WHERE id = ?2",
            )
            .bind(&now)
            .bind(session_id)
            .execute(&state.db)
            .await;

            // Mark the automation task completed.
            let _ = sqlx::query(
                "UPDATE automation_tasks
                 SET status = 'completed', finished_at = ?1,
                     result_json = '{\"outcome\":\"submitted\"}', updated_at = ?1
                 WHERE id = ?2",
            )
            .bind(&now)
            .bind(task_id)
            .execute(&state.db)
            .await;

            // Mark the application run + job_post submitted.
            let _ = sqlx::query(
                "UPDATE application_runs SET status = 'submitted', browser_session_id = ?1
                 WHERE id = (SELECT target_id FROM automation_tasks WHERE id = ?2)",
            )
            .bind(session_id)
            .bind(task_id)
            .execute(&state.db)
            .await;

            let _ = sqlx::query(
                "UPDATE job_posts SET status = 'applied'
                 WHERE id = (
                   SELECT job_id FROM application_runs
                   WHERE id = (SELECT target_id FROM automation_tasks WHERE id = ?1)
                 )",
            )
            .bind(task_id)
            .execute(&state.db)
            .await;

            emit_state(&app, "Completed", Some(task_id), Some("Application submitted"), None);
        } else {
            emit_state(&app, "Completed", None, Some("Application submitted"), None);
        }

        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
}

/// Reject (dismiss) the currently-parked Easy Apply form without submitting.
///
/// Called when the user decides not to apply after reviewing the filled form.
/// The Playwright worker closes the modal; the task is marked `needs_review`
/// so it can be re-queued or manually handled later.
#[tauri::command]
pub async fn automation_reject_submit(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        state
            .playwright
            .reject_submit_parked()
            .await
            .map_err(|e| e.to_string())?;
        emit_state(&app, "Stopped", None, Some("Application dismissed by user"), None);
        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
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
