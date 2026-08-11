//! HireMeOps Tauri backend entry point: app state, setup, and command registry.
//! Key: `AppState` — shared db pool, resolved paths, emergency-stop flag, Playwright driver.
//! Key: `run()` — builds the Tauri app, wires plugins, calls `init_state`, spawns startup tasks.
//! Key: `invoke_handler` registry in `run()` — every `#[tauri::command]` exposed to the frontend.
//! Key: `util::spawn_self_mem_logger()` call in `run()`'s `setup` — starts the RSS/mem logger.

mod ai;
mod auth;
#[cfg(feature = "real-browser")]
mod browser;
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

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub paths: storage::paths::AppPaths,
    pub emergency_stop: Arc<AtomicBool>,
    #[cfg(feature = "real-browser")]
    pub playwright: Arc<browser::playwright::PlaywrightDriver>,
}

async fn init_state(app: &tauri::AppHandle) -> anyhow::Result<AppState> {
    let paths = storage::paths::AppPaths::resolve(app)?;
    tracing::info!(portable = paths.portable, db = %paths.db_path.display(), "resolved storage paths");
    let db = storage::db::init_pool(&paths).await?;
    storage::db::run_migrations(&db).await?;
    storage::settings::ensure_defaults(&db).await?;
    // Restore the persisted Docker-worker opt-in into the process env that the
    // spawn gate (`browser::playwright::docker_worker_enabled`) reads.
    if storage::settings::docker_worker_opt_in(&db)
        .await
        .unwrap_or(false)
    {
        std::env::set_var("HIREMEOPS_USE_DOCKER", "1");
    }
    Ok(AppState {
        db,
        #[cfg(feature = "real-browser")]
        playwright: Arc::new(browser::playwright::PlaywrightDriver::new(&paths.data_dir)),
        paths,
        emergency_stop: Arc::new(AtomicBool::new(false)),
    })
}

/// Keep a native Wayland session healthy. WebKitGTK's DMABUF renderer trips
/// `Gdk-Message: Error 71 (Protocol error)` on many Wayland compositors — the
/// window maps then the Wayland connection is torn down and the app "opens and
/// closes" instantly. Disabling that renderer avoids the crash without forcing
/// XWayland. Must run before the Tauri builder touches GTK/WebKit.
#[cfg(target_os = "linux")]
fn configure_linux_display() {
    use std::env;

    // Respect an explicit X11 choice — native-Wayland tuning is then irrelevant.
    if env::var_os("GDK_BACKEND")
        .map(|v| v.to_string_lossy().to_ascii_lowercase().contains("x11"))
        .unwrap_or(false)
    {
        return;
    }

    let is_wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE")
            .map(|v| v.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false);

    // Only set it on Wayland and only if the user hasn't already chosen — so an
    // explicit `WEBKIT_DISABLE_DMABUF_RENDERER=0` still wins.
    if is_wayland && env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_display() {}

/// Open the dedicated Settings webview window (its own React entry, `settings.html`).
/// Mirrors the terax-ai pattern: reuse the window if it already exists (show + focus,
/// re-emit the tab), otherwise build it hidden and let the JS entry `show()` it after
/// mount so there's no unstyled flash. `tab` optionally deep-links a section.
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={t}"),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            let _ = window.emit("hiremeops:settings-tab", t);
        }
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false);

    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    let _ = window.set_decorations(false);
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_display();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hiremeops=info,hiremeops_lib=info,sqlx=warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = tauri::async_runtime::block_on(init_state(&handle)).map_err(|e| {
                tracing::error!("startup failed: {e:#}");
                e.to_string()
            })?;
            let data_dir = state.paths.data_dir.clone();
            #[cfg(feature = "real-browser")]
            let playwright = state.playwright.clone();
            app.manage(state);
            util::spawn_self_mem_logger();
            #[cfg(feature = "real-browser")]
            tauri::async_runtime::spawn(async move {
                playwright.prewarm().await;
            });
            tauri::async_runtime::spawn(async move {
                let bridge_dir = data_dir.join("chatgpt-bridge");
                let _ = std::fs::create_dir_all(&bridge_dir);
                std::env::set_var("HIREMEOPS_CHATGPT_PROFILE_DIR", &bridge_dir);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::setup::install_dependencies,
            commands::setup::install_latex,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::docker::docker_status,
            commands::docker::set_docker_worker,
            open_settings_window,
            commands::profiles::list_profiles,
            commands::profiles::create_profile,
            commands::profiles::rename_profile,
            commands::profiles::get_profile_facts,
            commands::profiles::save_profile_facts,
            commands::cv::import_cv_document,
            commands::cv::analyze_cv_document,
            commands::cv::rewrite_cv_document,
            commands::cv::create_first_time_cv_rewrite,
            commands::cv::create_variant_from_document,
            commands::cv::delete_cv_document,
            commands::cv::cv_read_bytes,
            commands::cv::list_cv_documents,
            commands::cv::list_cv_analysis_reports,
            commands::cv::list_cv_rewrites,
            commands::cv::export_cv_rewrite,
            commands::cv::save_cv_rewrite_pdf,
            commands::cv::set_cv_rewrite_appearance,
            commands::profile_variants::create_profile_variant,
            commands::profile_variants::list_profile_variants,
            commands::profile_variants::get_profile_variant,
            commands::profile_variants::delete_profile_variant,
            commands::profile_variants::build_profile_sync_plan,
            commands::profile_variants::update_profile_variant,
            commands::profile_variants::push_variant_to_linkedin,
            commands::profile_variants::catho_login,
            commands::profile_variants::push_variant_to_catho,
            commands::profile_variants::gupy_login,
            commands::profile_variants::push_variant_to_gupy,
            commands::profile_variants::infojobs_login,
            commands::profile_variants::push_variant_to_infojobs,
            commands::profile_variants::open_all_logins,
            commands::profile_variants::check_all_logins,
            commands::profile_variants::open_gmail,
            commands::profile_variants::auto_connect_linkedin,
            commands::applications::draft_application,
            commands::applications::submit_application,
            commands::automation::automation_start,
            commands::automation::automation_pause,
            commands::automation::automation_resume,
            commands::automation::automation_stop,
            commands::automation::automation_confirm_submit,
            commands::automation::automation_reject_submit,
            commands::automation::indeed_login,
            commands::automation::automation_start_indeed,
            commands::automation::automation_confirm_indeed_submit,
            commands::automation::automation_reject_indeed_submit,
            commands::events::emit_test_event,
            commands::jobs::list_job_preferences,
            commands::jobs::create_job_preference,
            commands::jobs::list_search_queries,
            commands::jobs::generate_search_queries,
            commands::jobs::delete_search_query,
            commands::jobs::ingest_job_post,
            commands::jobs::list_job_posts,
            commands::jobs::update_job_status,
            commands::jobs::run_search,
            commands::jobs::score_job_match,
            commands::jobs::list_job_matches,
            commands::jobs::run_linkedin_search,
            commands::jobs::run_google_search,
            commands::jobs::run_linkedin_posts_search,
            commands::jobs::gmail_send_application,
            commands::jobs::linkedin_job_login,
            commands::jobs::linkedin_job_login_status,
            commands::jobs::run_indeed_search,
            commands::jobs::run_catho_search,
            commands::jobs::run_upwork_search,
            commands::jobs::run_freelas99_search,
            commands::jobs::run_programathor_search,
            commands::jobs::run_geekhunter_search,
            commands::jobs::run_infojobs_search,
            commands::jobs::run_gupy_search,
            commands::jobs::catho_apply,
            commands::jobs::infojobs_apply,
            commands::jobs::delete_old_scans,
            commands::exports::export_profiles_json,
            commands::exports::export_jobs_csv,
            commands::exports::export_applications_csv,
            commands::exports::export_audit_csv,
            commands::exports::create_backup,
            commands::exports::list_backups,
            commands::exports::restore_backup,
            commands::preview::preview_open,
            commands::preview::preview_close,
            commands::preview::preview_open_live,
            commands::preview::preview_close_live,
            commands::preview::preview_navigate,
            commands::preview::preview_input,
            commands::preview::preview_resize,
            commands::browser_view::preview_webview_create,
            commands::browser_view::preview_webview_navigate,
            commands::browser_view::preview_webview_reload,
            commands::browser_view::preview_webview_go_back,
            commands::browser_view::preview_webview_go_forward,
            commands::browser_view::preview_webview_set_bounds,
            commands::browser_view::preview_webview_show,
            commands::browser_view::preview_webview_hide,
            commands::browser_view::preview_webview_close,
            commands::ai::test_provider,
            commands::ai::list_models,
            commands::ai::set_api_key,
            commands::ai::clear_api_key,
            commands::ai::has_api_key,
            commands::auth::oauth_supported,
            commands::auth::oauth_begin,
            commands::auth::oauth_complete,
            commands::auth::oauth_await_callback,
            commands::auth::oauth_status,
            commands::auth::oauth_refresh,
            commands::auth::oauth_logout,
            commands::browser_provider::browser_provider_login,
            commands::browser_provider::browser_provider_status,
            commands::browser_provider::browser_provider_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
