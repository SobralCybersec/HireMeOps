use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tauri::Manager;

#[tokio::test]
async fn settings_commands_roundtrip_through_managed_app_state() {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    crate::storage::settings::ensure_defaults(&pool)
        .await
        .unwrap();

    let app = crate::test_support::app_with_db(pool);
    let state = app.state::<crate::AppState>();
    let mut settings = get_settings(state.clone()).await.unwrap();
    assert_eq!(settings.app_language, "en");
    settings.app_language = "pt".into();
    update_settings(state.clone(), settings).await.unwrap();
    assert_eq!(get_settings(state).await.unwrap().app_language, "pt");
}
