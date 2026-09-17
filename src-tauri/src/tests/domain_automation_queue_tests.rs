use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn database() -> SqlitePool {
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
    sqlx::query(
            "INSERT INTO automation_tasks
             (id, profile_id, task_type, status, payload_json, hr_name, hr_link, created_at, updated_at)
             VALUES ('t1', 'p1', 'apply_job', 'queued', ?1, 'Recruiter', 'https://jobs.test/hr', 'now', 'now')",
        )
        .bind(serde_json::json!({"url": "https://jobs.test/1", "platform": "linkedin"}).to_string())
        .execute(&db)
        .await
        .unwrap();
    db
}

#[test]
fn outcome_state_and_summary_counters_cover_all_terminal_outcomes() {
    assert_eq!(outcome_state(TaskOutcome::Completed), "Completed");
    assert_eq!(
        outcome_state(TaskOutcome::PausedForCaptcha),
        "PausedForCaptcha"
    );
    assert_eq!(outcome_state(TaskOutcome::PausedForReview), "NeedsReview");
    assert_eq!(outcome_state(TaskOutcome::Aborted), "Stopped");

    let mut summary = QueueRunSummary::default();
    for outcome in [
        TaskOutcome::Completed,
        TaskOutcome::PausedForCaptcha,
        TaskOutcome::PausedForReview,
        TaskOutcome::Aborted,
    ] {
        count_outcome(&mut summary, outcome);
    }
    assert_eq!(summary.ran, 4);
    assert_eq!(summary.completed, 1);
    assert_eq!(summary.paused, 2);
    assert_eq!(summary.aborted, 1);
}

#[tokio::test]
async fn queue_metadata_contact_and_rate_helpers_handle_present_and_missing_values() {
    let db = database().await;
    assert_eq!(
        task_metadata(&db, "t1").await.0.as_deref(),
        Some("https://jobs.test/1")
    );
    assert_eq!(
        task_metadata(&db, "t1").await.1.as_deref(),
        Some("linkedin")
    );
    assert_eq!(task_metadata(&db, "missing").await, (None, None));
    assert_eq!(
        review_contact(&db, "t1", TaskOutcome::Completed).await,
        (None, None)
    );
    assert_eq!(
        review_contact(&db, "t1", TaskOutcome::PausedForReview).await,
        (
            Some("Recruiter".into()),
            Some("https://jobs.test/hr".into())
        )
    );
    assert!(rate_limited(&db, None).await.is_none());
    assert!(rate_limited(&db, Some("linkedin")).await.is_none());
}
