use super::*;
use crate::util::new_id;
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn restore_env(name: &str, previous: Option<String>) {
    match previous {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

#[test]
fn tuning_values_use_defaults_and_clamps() {
    let _guard = ENV_LOCK.lock().unwrap();
    let max_previous = std::env::var("HIREMEOPS_DB_MAX_CONNECTIONS").ok();
    let cache_previous = std::env::var("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY").ok();

    std::env::remove_var("HIREMEOPS_DB_MAX_CONNECTIONS");
    std::env::remove_var("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY");
    assert_eq!(max_connections(), 5);
    assert_eq!(statement_cache_capacity(), 256);

    std::env::set_var("HIREMEOPS_DB_MAX_CONNECTIONS", "0");
    std::env::set_var("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY", "1");
    assert_eq!(max_connections(), 1);
    assert_eq!(statement_cache_capacity(), 32);

    std::env::set_var("HIREMEOPS_DB_MAX_CONNECTIONS", "99");
    std::env::set_var("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY", "9999");
    assert_eq!(max_connections(), 8);
    assert_eq!(statement_cache_capacity(), 1024);

    restore_env("HIREMEOPS_DB_MAX_CONNECTIONS", max_previous);
    restore_env("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY", cache_previous);
}

#[tokio::test]
async fn init_migrate_observe_and_maintain_work_with_file_database() {
    let root = std::env::temp_dir().join(format!("hiremeops-db-{}", new_id()));
    std::fs::create_dir_all(&root).unwrap();
    let paths = AppPaths {
        data_dir: root.clone(),
        db_path: root.join("app.sqlite3"),
        evidence_dir: root.join("evidence"),
        export_dir: root.join("exports"),
        cv_files_dir: root.join("cv_files"),
        portable: false,
    };
    let previous = std::env::var("HIREMEOPS_DB_CACHE_SIZE").ok();
    std::env::set_var("HIREMEOPS_DB_CACHE_SIZE", "-2000");

    let pool = init_pool(&paths).await.unwrap();
    run_migrations(&pool).await.unwrap();
    observe_wal(&pool, &paths.db_path).await.unwrap();
    maintain(&pool, &paths.db_path).await.unwrap();
    let settings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(settings, 1);

    pool.close().await;
    restore_env("HIREMEOPS_DB_CACHE_SIZE", previous);
    std::fs::remove_dir_all(root).unwrap();
}
