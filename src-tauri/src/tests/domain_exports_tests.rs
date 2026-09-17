use super::*;
use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;

async fn mem_pool() -> SqlitePool {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn seed_profile(pool: &SqlitePool) -> String {
    let id = new_id();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, target_title, seniority, \
             is_active, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
    )
    .bind(&id)
    .bind("Ada, \"the\" Engineer")
    .bind("Staff Rust Engineer")
    .bind("staff")
    .bind(now_iso())
    .execute(pool)
    .await
    .unwrap();
    id
}

#[test]
fn csv_field_escapes_specials() {
    assert_eq!(csv_field("plain"), "plain");
    assert_eq!(csv_field("a,b"), "\"a,b\"");
    assert_eq!(csv_field("she said \"hi\""), "\"she said \"\"hi\"\"\"");
    assert_eq!(csv_field("line1\nline2"), "\"line1\nline2\"");
}

#[tokio::test]
async fn profiles_json_includes_seeded_profile_and_is_valid() {
    let pool = mem_pool().await;
    seed_profile(&pool).await;
    let json = export_profiles_json(&pool).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed["profile_count"], 2);
    let ada = parsed["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["display_name"] == "Ada, \"the\" Engineer")
        .expect("seeded Ada profile present in export");
    assert!(ada["cv_documents"].is_array());
}

#[tokio::test]
async fn jobs_csv_has_header_even_when_empty() {
    let pool = mem_pool().await;
    let csv = export_jobs_csv(&pool).await.unwrap();
    assert!(csv.starts_with("Title,Company,Location"));
    assert!(csv.ends_with("\r\n"));
}

#[tokio::test]
async fn applications_and_audit_csv_export() {
    let pool = mem_pool().await;
    let apps = export_applications_csv(&pool).await.unwrap();
    assert!(apps.starts_with("Run ID,Job Title,Company"));
    let audit = export_audit_csv(&pool).await.unwrap();
    assert!(audit.starts_with("Timestamp,Entity Type,Entity ID"));
}

#[tokio::test]
async fn backup_create_list_and_restore_roundtrip() {
    let dir = std::env::temp_dir().join(format!("hiremeops-bk-{}", new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src_path = dir.join("source.sqlite3");
    let opts = SqliteConnectOptions::new()
        .filename(&src_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    seed_profile(&pool).await;

    let info = create_backup(&pool, &dir).await.unwrap();
    assert!(info.size_bytes > 0);
    assert!(std::path::Path::new(&info.path).exists());
    let listed = list_backups(&dir).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].file_name, info.file_name);

    let target = dir.join("restored.sqlite3");
    let backup_path = std::path::PathBuf::from(&info.path);
    restore_backup(&backup_path, &target).await.unwrap();
    let ropts = SqliteConnectOptions::new()
        .filename(&target)
        .read_only(true);
    let rpool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(ropts)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
        .fetch_one(&rpool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    rpool.close().await;

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn restore_rejects_missing_file() {
    let bogus = std::env::temp_dir().join(format!("nope-{}.sqlite3", new_id()));
    let target = std::env::temp_dir().join(format!("t-{}.sqlite3", new_id()));
    let err = restore_backup(&bogus, &target).await;
    assert!(err.is_err());
}
