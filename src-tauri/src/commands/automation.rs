//! Automation control commands — the operator's cockpit over the browser automation supervisor.
//! Key: automation_start — clears the emergency-stop latch and spawns the queue-draining engine
//! Key: automation_confirm_submit / automation_reject_submit — resolve a parked Easy Apply form
//! Key: automation_start_indeed — drives the Indeed SmartApply flow, parks before final submit
//! Key: automation_confirm_indeed_submit / automation_reject_indeed_submit — resolve a parked SmartApply popup
//! Key: automation_pause / automation_resume / automation_stop / automation_emergency_stop — latch control

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::events::{AppEvent, AppEventType, EventEmitter};
use crate::AppState;

#[cfg(feature = "real-browser")]
use serde_json::{json, Value};

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

#[tauri::command]
pub fn automation_start(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(false, Ordering::SeqCst);
    tracing::info!("automation_start — emergency-stop latch cleared");

    emit_state(&app, "PreparingBrowser", None, None, None);

    let db = state.db.clone();
    let stop = state.emergency_stop.clone();
    let app_for_engine = app.clone();

    #[cfg(feature = "real-browser")]
    let driver = state.playwright.clone();
    #[cfg(feature = "real-browser")]
    let data_dir = state.paths.data_dir.clone();

    tauri::async_runtime::spawn(async move {
        #[cfg(feature = "real-browser")]
        run_engine(app_for_engine, db, stop, driver, data_dir).await;
        #[cfg(not(feature = "real-browser"))]
        run_engine_stub(app_for_engine, db).await;
    });
    Ok(())
}

#[cfg(feature = "real-browser")]
async fn run_engine(
    app: AppHandle,
    db: sqlx::SqlitePool,
    stop: Arc<std::sync::atomic::AtomicBool>,
    driver: Arc<crate::browser::playwright::PlaywrightDriver>,
    data_dir: std::path::PathBuf,
) {
    use crate::domain::automation::run_automation_queue;

    let emitter = app.clone();
    let result = run_automation_queue(
        &db,
        driver,
        stop,
        data_dir,
        move |s, task, url, hr_name, _hr_link| {
            emit_state(&emitter, s, task, hr_name, url);
        },
    )
    .await;

    if let Err(e) = result {
        tracing::error!("automation engine failed: {e}");
        emit_state(&app, "Failed", None, Some(&e.to_string()), None);
    }
}

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
            None,
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
            None,
        );
    }
}

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

        if let (Some(task_id), Some(session_id)) = (&meta.task_id, &meta.session_id) {
            let now = crate::util::now_iso();

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

            let _ = sqlx::query(
                "UPDATE browser_sessions
                 SET status = 'closed', ended_at = ?1, updated_at = ?1
                 WHERE id = ?2",
            )
            .bind(&now)
            .bind(session_id)
            .execute(&state.db)
            .await;

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

            emit_state(
                &app,
                "Completed",
                Some(task_id),
                Some("Application submitted"),
                None,
            );
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
        emit_state(
            &app,
            "Stopped",
            None,
            Some("Application dismissed by user"),
            None,
        );
        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
}

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

#[tauri::command]
pub fn automation_resume(state: State<'_, AppState>) -> Result<(), String> {
    state.emergency_stop.store(false, Ordering::SeqCst);
    tracing::info!("automation_resume — emergency-stop latch cleared");
    Ok(())
}

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

#[tauri::command]
pub async fn automation_start_indeed(
    app: AppHandle,
    state: State<'_, AppState>,
    job_url: String,
    profile_id: String,
    answers: Option<serde_json::Value>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        emit_state(
            &app,
            "PreparingBrowser",
            None,
            Some("Opening SmartApply form…"),
            None,
        );

        let user_data_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "job_apply", false)
                .await;
        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "indeed".into(),
                user_data_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let mut merged = build_indeed_answers(&state.db, &profile_id).await;
        if let Some(Value::Object(over)) = answers {
            for (k, v) in over {
                merged.insert(k, v);
            }
        }
        let answers = Value::Object(merged);

        let reply = state
            .playwright
            .fill_indeed_apply(&handle, &job_url, &answers)
            .await
            .map_err(|e| e.to_string())?;

        let unanswered = reply
            .get("unanswered")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut needs_human = reply
            .get("needsHuman")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0);

        if !unanswered.is_empty() {
            emit_state(
                &app,
                "GeneratingAnswers",
                None,
                Some("Drafting answers for screening questions…"),
                Some(&job_url),
            );
            match crate::domain::automation::generate_form_answers(&state.db, &profile_id, &unanswered).await {
                Ok((question_map, human)) => {
                    needs_human += human;
                    if !question_map.is_empty() {
                        let payload = json!({ "questions": Value::Object(question_map) });
                        let refill = state
                            .playwright
                            .answer_indeed_free_text(&handle, &payload)
                            .await
                            .map_err(|e| e.to_string())?;
                        needs_human += refill
                            .get("unanswered")
                            .and_then(Value::as_array)
                            .map(|a| a.len())
                            .unwrap_or(0);
                    } else {
                        needs_human += unanswered.len();
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Indeed answer generation failed; parking for review");
                    needs_human += unanswered.len();
                }
            }
        }

        let detail = if needs_human > 0 {
            format!("Review the SmartApply form — {needs_human} item(s) need you, then confirm or reject.")
        } else {
            "Review the SmartApply form, then confirm or reject.".to_string()
        };
        emit_state(&app, "PausedForReview", None, Some(&detail), Some(&job_url));
        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state, job_url, profile_id, answers);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(feature = "real-browser")]
async fn build_indeed_answers(
    db: &sqlx::SqlitePool,
    profile_id: &str,
) -> serde_json::Map<String, Value> {
    use crate::domain::profile_variants::{ProfileVariantService, ProfileVariantServiceImpl};

    let mut m = serde_json::Map::new();
    let svc = ProfileVariantServiceImpl::new(db.clone());
    if let Ok(Some(v)) = svc.list(profile_id).await.map(|vs| vs.into_iter().next()) {
        let c = &v.contact;
        let (first, last) = split_contact_name(&c.name);
        if !first.is_empty() {
            m.insert("firstName".into(), json!(first));
        }
        if let Some(last) = last.filter(|l| !l.is_empty()) {
            m.insert("lastName".into(), json!(last));
        }
        if let Some(e) = c.email.as_deref().filter(|s| !s.trim().is_empty()) {
            m.insert("email".into(), json!(e.trim()));
        }
        if let Some(p) = c.phone.as_deref().filter(|s| !s.trim().is_empty()) {
            m.insert("phone".into(), json!(p.trim()));
        }
        if let Some(w) = c.website.as_deref().filter(|s| !s.trim().is_empty()) {
            m.insert("linkedinUrl".into(), json!(w.trim()));
        }
    }

    if let Ok(Some((Some(min), currency))) = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
        "SELECT min_salary, salary_currency FROM job_preferences WHERE profile_id = ?1 LIMIT 1",
    )
    .bind(profile_id)
    .fetch_optional(db)
    .await
    {
        let salary = format_desired_salary(min, currency.as_deref().unwrap_or(""));
        m.insert("salary".into(), json!(salary));
    }
    m
}

#[cfg(feature = "real-browser")]
fn split_contact_name(name: &str) -> (String, Option<String>) {
    let name = name.trim();
    match name.split_once(' ') {
        Some((first, rest)) => (first.to_string(), Some(rest.trim().to_string())),
        None => (name.to_string(), None),
    }
}

#[cfg(feature = "real-browser")]
fn format_desired_salary(min: i64, currency: &str) -> String {
    let cur = currency.trim();
    if cur.is_empty() {
        min.to_string()
    } else {
        format!("{min} {cur}")
    }
}

#[cfg(all(test, feature = "real-browser"))]
mod indeed_answer_tests {
    use super::{format_desired_salary, split_contact_name};

    #[test]
    fn split_name_handles_single_double_and_multi() {
        assert_eq!(split_contact_name("Jane"), ("Jane".into(), None));
        assert_eq!(
            split_contact_name("Jane Doe"),
            ("Jane".into(), Some("Doe".into()))
        );
        assert_eq!(
            split_contact_name("  Ana Paula Souza  "),
            ("Ana".into(), Some("Paula Souza".into()))
        );
        assert_eq!(split_contact_name(""), (String::new(), None));
    }

    #[test]
    fn salary_appends_currency_only_when_present() {
        assert_eq!(format_desired_salary(8000, "BRL"), "8000 BRL");
        assert_eq!(format_desired_salary(8000, "  "), "8000");
        assert_eq!(format_desired_salary(12000, ""), "12000");
    }
}

#[tauri::command]
pub async fn indeed_login(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "indeed".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .navigate(&handle, "https://secure.indeed.com/auth")
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn automation_confirm_indeed_submit(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        let meta = state
            .playwright
            .confirm_indeed_submit_parked()
            .await
            .map_err(|e| e.to_string())?;

        if let Some(shot) = &meta.screenshot_path {
            tracing::info!(screenshot = %shot, "Indeed application submitted");
        }
        emit_state(
            &app,
            "Completed",
            None,
            Some("Indeed application submitted"),
            None,
        );
        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn automation_reject_indeed_submit(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        state
            .playwright
            .reject_indeed_submit_parked()
            .await
            .map_err(|e| e.to_string())?;
        emit_state(
            &app,
            "Stopped",
            None,
            Some("Indeed application dismissed"),
            None,
        );
        return Ok(());
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
}
