use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tauri::Manager;

#[tokio::test]
async fn docker_commands_report_runtime_and_persist_opt_in() {
    let status = docker_status().await.unwrap();
    assert!(!status.summary.is_empty());
    assert_eq!(status.daemon_running, status.server_version.is_some());

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .unwrap()
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let app = crate::test_support::app_with_db(pool);
    let state = app.state::<crate::AppState>();
    set_docker_worker(state.clone(), true).await.unwrap();
    assert_eq!(std::env::var("HIREMEOPS_USE_DOCKER").as_deref(), Ok("1"));
    set_docker_worker(state, false).await.unwrap();
    assert!(std::env::var("HIREMEOPS_USE_DOCKER").is_err());
}
