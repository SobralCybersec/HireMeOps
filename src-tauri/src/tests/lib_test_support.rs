use super::*;
use std::sync::atomic::AtomicBool;

pub(crate) fn app_with_db(db: sqlx::SqlitePool) -> tauri::App<tauri::test::MockRuntime> {
    let data_dir =
        std::env::temp_dir().join(format!("hiremeops-rust-tests-{}", uuid::Uuid::new_v4()));
    #[cfg(feature = "real-browser")]
    return app_with_driver(
        db,
        std::sync::Arc::new(browser::playwright::PlaywrightDriver::new(&data_dir)),
        data_dir,
    );
    #[cfg(not(feature = "real-browser"))]
    app_with_driver(db, data_dir)
}

#[cfg(feature = "real-browser")]
pub(crate) fn app_with_driver(
    db: sqlx::SqlitePool,
    driver: std::sync::Arc<browser::playwright::PlaywrightDriver>,
    data_dir: std::path::PathBuf,
) -> tauri::App<tauri::test::MockRuntime> {
    use tauri::Manager;

    let app = tauri::test::mock_app();
    app.manage(AppState {
        db,
        shared_db: None,
        paths: storage::paths::AppPaths {
            data_dir: data_dir.clone(),
            db_path: data_dir.join("hiremeops.sqlite3"),
            evidence_dir: data_dir.join("evidence"),
            export_dir: data_dir.join("exports"),
            cv_files_dir: data_dir.join("cv_files"),
            portable: false,
        },
        emergency_stop: Arc::new(AtomicBool::new(false)),
        playwright: driver,
    });
    app
}

#[cfg(not(feature = "real-browser"))]
fn app_with_driver(
    db: sqlx::SqlitePool,
    data_dir: std::path::PathBuf,
) -> tauri::App<tauri::test::MockRuntime> {
    use tauri::Manager;

    let app = tauri::test::mock_app();
    app.manage(AppState {
        db,
        shared_db: None,
        paths: storage::paths::AppPaths {
            data_dir: data_dir.clone(),
            db_path: data_dir.join("hiremeops.sqlite3"),
            evidence_dir: data_dir.join("evidence"),
            export_dir: data_dir.join("exports"),
            cv_files_dir: data_dir.join("cv_files"),
            portable: false,
        },
        emergency_stop: Arc::new(AtomicBool::new(false)),
    });
    app
}
