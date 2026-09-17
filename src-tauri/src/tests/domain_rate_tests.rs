use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

#[test]
fn defaults_are_sane() {
    assert_eq!(default_caps("linkedin"), (30, 8));
    assert_eq!(default_caps("LinkedIn"), (30, 8)); // case-insensitive
    assert_eq!(default_caps("unknown"), (40, 12));
    // hour cap must be below the day cap on every board or the hour gate is dead.
    for p in [
        "linkedin", "indeed", "upwork", "gupy", "catho", "infojobs", "x",
    ] {
        let (d, h) = default_caps(p);
        assert!(h < d, "{p}: hour cap {h} should be < day cap {d}");
    }
}

#[test]
fn env_override_wins() {
    std::env::set_var("HIREMEOPS_RATE_TESTBOARD_DAY", "5");
    std::env::set_var("HIREMEOPS_RATE_TESTBOARD_HOUR", "2");
    assert_eq!(caps_for("testboard"), (5, 2));
    assert_eq!(caps_for("TestBoard"), (5, 2)); // env key uppercased
    std::env::remove_var("HIREMEOPS_RATE_TESTBOARD_DAY");
    std::env::remove_var("HIREMEOPS_RATE_TESTBOARD_HOUR");
    // Falls back to defaults when unset.
    assert_eq!(caps_for("indeed"), (40, 12));
}

#[tokio::test]
async fn rate_check_enforces_hourly_then_daily_caps() {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1', 'Test', 'now', 'now', 1)",
    )
    .execute(&db)
    .await
    .unwrap();
    for id in ["task-1", "task-2"] {
        sqlx::query(
                "INSERT INTO automation_tasks
                 (id, profile_id, task_type, status, finished_at, payload_json, created_at, updated_at)
                 VALUES (?1, 'p1', 'apply_job', 'completed', ?2, ?3, 'now', 'now')",
            )
            .bind(id)
            .bind(crate::util::now_iso())
            .bind(serde_json::json!({"platform": "QualityRate"}).to_string())
            .execute(&db)
            .await
            .unwrap();
    }
    let day_previous = std::env::var("HIREMEOPS_RATE_QUALITYRATE_DAY").ok();
    let hour_previous = std::env::var("HIREMEOPS_RATE_QUALITYRATE_HOUR").ok();
    std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_DAY", "2");
    std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_HOUR", "1");

    let daily = rate_check(&db, "qualityrate").await;
    assert!(!daily.allowed);
    assert!(daily.reason.as_deref().unwrap().contains("daily cap"));
    assert_eq!(daily.used_day, 2);
    assert_eq!(daily.used_hour, 2);

    sqlx::query("DELETE FROM automation_tasks WHERE id = 'task-2'")
        .execute(&db)
        .await
        .unwrap();
    let hourly = rate_check(&db, "qualityrate").await;
    assert!(!hourly.allowed);
    assert!(hourly.reason.as_deref().unwrap().contains("hourly cap"));
    assert_eq!(hourly.used_day, 1);
    assert_eq!(hourly.used_hour, 1);

    std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_DAY", "3");
    std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_HOUR", "3");
    let allowed = rate_check(&db, "qualityrate").await;
    assert!(allowed.allowed);
    assert!(allowed.reason.is_none());
    match day_previous {
        Some(value) => std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_DAY", value),
        None => std::env::remove_var("HIREMEOPS_RATE_QUALITYRATE_DAY"),
    }
    match hour_previous {
        Some(value) => std::env::set_var("HIREMEOPS_RATE_QUALITYRATE_HOUR", value),
        None => std::env::remove_var("HIREMEOPS_RATE_QUALITYRATE_HOUR"),
    }
}
