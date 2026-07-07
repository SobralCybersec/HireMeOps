//! HireMeOps — local-first job-search automation cockpit (Tauri 2 backend).
//!
//! Phase 1 wires the foundation: path resolution (incl. portable mode),
//! SQLite pool + migrations, app-event bus, settings repo, Tauri command surface.
//! Phase 3 adds the jobs module: canonical URL, dedupe, search-query building,
//! and the full job-preference / job-post / job-match command surface.

mod ai;
mod commands;
mod cv;
mod domain;
mod events;
mod jobs;
mod matching;
mod storage;
mod util;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::Manager;

/// Shared application state, managed by Tauri and injected into commands.
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub paths: storage::paths::AppPaths,
    /// Canonical emergency-stop latch. `automation_stop` /
    /// `automation_emergency_stop` set it; `automation_start` clears it. Every
    /// `BrowserSupervisor` is constructed sharing this exact `Arc` (via
    /// `with_stop_flag`), so tripping it halts any in-flight browser task at its
    /// next checkpoint — the kill-switch is always live, even between tasks.
    pub emergency_stop: Arc<AtomicBool>,
}

async fn init_state(app: &tauri::AppHandle) -> anyhow::Result<AppState> {
    let paths = storage::paths::AppPaths::resolve(app)?;
    tracing::info!(portable = paths.portable, db = %paths.db_path.display(), "resolved storage paths");
    let db = storage::db::init_pool(&paths).await?;
    storage::db::run_migrations(&db).await?;
    storage::settings::ensure_defaults(&db).await?;
    Ok(AppState {
        db,
        paths,
        emergency_stop: Arc::new(AtomicBool::new(false)),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hiremeops=info,hiremeops_lib=info,sqlx=warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = tauri::async_runtime::block_on(init_state(&handle)).map_err(|e| {
                tracing::error!("startup failed: {e:#}");
                e.to_string()
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::profiles::list_profiles,
            // Phase 2 — CV
            commands::cv::import_cv_document,
            commands::cv::analyze_cv_document,
            // Phase 4 — applications
            commands::applications::draft_application,
            commands::automation::automation_start,
            commands::automation::automation_pause,
            commands::automation::automation_resume,
            commands::automation::automation_stop,
            commands::automation::automation_emergency_stop,
            commands::events::emit_test_event,
            // Phase 3 — jobs
            commands::jobs::list_job_preferences,
            commands::jobs::create_job_preference,
            commands::jobs::list_search_queries,
            commands::jobs::generate_search_queries,
            commands::jobs::ingest_job_post,
            commands::jobs::list_job_posts,
            commands::jobs::update_job_status,
            commands::jobs::run_search,
            commands::jobs::score_job_match,
            commands::jobs::list_job_matches,
            // Phase 6/7 — exports & backups
            commands::exports::export_profiles_json,
            commands::exports::export_jobs_csv,
            commands::exports::export_applications_csv,
            commands::exports::export_audit_csv,
            commands::exports::create_backup,
            commands::exports::list_backups,
            commands::exports::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
