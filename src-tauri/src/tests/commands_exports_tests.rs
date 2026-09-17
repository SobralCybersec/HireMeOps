use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::Manager;
use uuid::Uuid;

#[tokio::test]
async fn export_commands_and_backup_lifecycle_use_managed_state() {
    let source_path =
        std::env::temp_dir().join(format!("hiremeops-export-{}.sqlite3", Uuid::new_v4()));
    let options = SqliteConnectOptions::new()
        .filename(&source_path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES ('p1', 'Primary', 'now', 'now', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = crate::test_support::app_with_db(pool);
    let state = app.state::<crate::AppState>();
    assert!(export_profiles_json(state.clone())
        .await
        .unwrap()
        .contains("Primary"));
    assert!(export_jobs_csv(state.clone())
        .await
        .unwrap()
        .starts_with("Title,Company"));
    assert!(export_applications_csv(state.clone())
        .await
        .unwrap()
        .starts_with("Run ID"));
    assert!(export_audit_csv(state.clone())
        .await
        .unwrap()
        .starts_with("Timestamp"));

    let backup = create_backup(state.clone()).await.unwrap();
    assert!(backup.size_bytes > 0);
    assert_eq!(list_backups(state.clone()).await.unwrap().len(), 1);
    let restored = restore_backup(state, backup.path).await.unwrap();
    assert!(restored.size_bytes > 0);
}
