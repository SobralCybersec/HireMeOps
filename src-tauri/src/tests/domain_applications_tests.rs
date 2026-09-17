use super::*;
use crate::domain::automation::EasyApplyInput;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn mem_pool() -> SqlitePool {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn insert_profile(pool: &SqlitePool, id: &str) {
    let now = now_iso();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES (?1, 'Test', ?2, ?2, 1)",
    )
    .bind(id)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_job(pool: &SqlitePool, id: &str, profile_id: &str, canonical: &str) {
    let now = now_iso();
    sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, canonical_url, title, company, description, discovered_at)
             VALUES (?1, ?2, 'linkedin', ?3, ?3, 'Rust Engineer', 'ACME', 'desc', ?4)",
        )
        .bind(id)
        .bind(profile_id)
        .bind(canonical)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_draft(pool: &SqlitePool, id: &str, job_id: &str, profile_id: &str) {
    let now = now_iso();
    let form_answers = r#"[{"question":"Why us?","answer":"Because."}]"#;
    sqlx::query(
            "INSERT INTO application_drafts
               (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'Dear team', ?4, 'draft', ?5, ?5)",
        )
        .bind(id)
        .bind(job_id)
        .bind(profile_id)
        .bind(form_answers)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
}

fn service(pool: SqlitePool) -> ApplicationServiceImpl {
    ApplicationServiceImpl::new(pool, std::env::temp_dir())
}

#[tokio::test]
async fn first_submit_creates_run_lock_and_task() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/1").await;
    insert_draft(&pool, "d1", "j1", "p1").await;

    let run_id = service(pool.clone()).submit("d1").await.unwrap();

    let (status, mode): (String, String) =
        sqlx::query_as("SELECT status, mode FROM application_runs WHERE id = ?1")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "started");
    assert_eq!(mode, "manual_assist");

    let locks: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM application_url_locks WHERE profile_id = 'p1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(locks, 1);

    let payload: String = sqlx::query_scalar(
            "SELECT payload_json FROM automation_tasks WHERE task_type = 'apply_job' AND target_id = ?1",
        )
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let input: EasyApplyInput = serde_json::from_str(&payload).unwrap();
    assert_eq!(input.url, "https://linkedin.com/jobs/view/1");
    assert_eq!(input.platform, "linkedin");
    assert_eq!(input.answers.len(), 1);
    assert_eq!(input.answers[0].label, "Why us?");
    assert_eq!(input.answers[0].value, "Because.");

    let draft_status: String =
        sqlx::query_scalar("SELECT status FROM application_drafts WHERE id = 'd1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(draft_status, "submitting");
    let job_status: String = sqlx::query_scalar("SELECT status FROM job_posts WHERE id = 'j1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(job_status, "queued");
}

#[tokio::test]
async fn repeated_submit_of_same_draft_is_idempotent() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/2").await;
    insert_draft(&pool, "d1", "j1", "p1").await;

    let svc = service(pool.clone());
    let first = svc.submit("d1").await.unwrap();
    let second = svc.submit("d1").await.unwrap();

    assert_eq!(second, first);
    let runs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM automation_tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(runs, 1);
    assert_eq!(tasks, 1);
}

#[tokio::test]
async fn duplicate_url_is_skipped_never_double_applies() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/7").await;
    insert_job(&pool, "j2", "p1", "https://linkedin.com/jobs/view/7").await;
    insert_draft(&pool, "d1", "j1", "p1").await;
    insert_draft(&pool, "d2", "j2", "p1").await;

    let svc = service(pool.clone());
    let _run1 = svc.submit("d1").await.unwrap();
    let run2 = svc.submit("d2").await.unwrap();

    let status: String = sqlx::query_scalar("SELECT status FROM application_runs WHERE id = ?1")
        .bind(&run2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "skipped_duplicate_url");

    let locks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_url_locks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(locks, 1);
    let tasks: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM automation_tasks WHERE task_type = 'apply_job'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(tasks, 1);

    let draft_status: String =
        sqlx::query_scalar("SELECT status FROM application_drafts WHERE id = 'd2'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(draft_status, "skipped_duplicate_url");
}

#[tokio::test]
async fn different_profiles_same_url_both_apply() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_profile(&pool, "p2").await;
    insert_job(&pool, "j1", "p1", "https://linkedin.com/jobs/view/9").await;
    insert_job(&pool, "j2", "p2", "https://linkedin.com/jobs/view/9").await;
    insert_draft(&pool, "d1", "j1", "p1").await;
    insert_draft(&pool, "d2", "j2", "p2").await;

    let svc = service(pool.clone());
    let run1 = svc.submit("d1").await.unwrap();
    let run2 = svc.submit("d2").await.unwrap();

    for run in [&run1, &run2] {
        let status: String =
            sqlx::query_scalar("SELECT status FROM application_runs WHERE id = ?1")
                .bind(run)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "started");
    }
    let locks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_url_locks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(locks, 2);
}

#[tokio::test]
async fn unknown_draft_is_invalid_input() {
    let pool = mem_pool().await;
    let err = service(pool).submit("nope").await.unwrap_err();
    assert!(matches!(err, DomainError::InvalidInput(_)));
}
