use super::{
    close_submission_session, format_desired_salary, mark_submission_complete,
    record_submission_evidence, split_contact_name,
};

#[test]
fn split_name_handles_single_double_and_multi() {
    assert_eq!(split_contact_name("Jane"), ("Jane".into(), None));
    assert_eq!(
        split_contact_name("Jane Doe"),
        ("Jane".into(), Some("Doe".into()))
    );
    assert_eq!(
        split_contact_name("  Ana Paula Souza  "),
        ("Ana".into(), Some("Paula Souza".into()))
    );
    assert_eq!(split_contact_name(""), (String::new(), None));
}

#[test]
fn salary_appends_currency_only_when_present() {
    assert_eq!(format_desired_salary(8000, "BRL"), "8000 BRL");
    assert_eq!(format_desired_salary(8000, "  "), "8000");
    assert_eq!(format_desired_salary(12000, ""), "12000");
}

#[tokio::test]
async fn submission_helpers_persist_evidence_and_terminal_state() {
    let db = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES ('p1', 'Candidate', 'now', 'now', 1)",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO job_posts
         (id, profile_id, platform, url, title, company, description, discovered_at, status)
         VALUES ('job1', 'p1', 'indeed', 'https://jobs.test/1', 'Backend', 'Fixture', 'Role', 'now', 'queued')",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO application_drafts
         (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
         VALUES ('draft1', 'job1', 'p1', '', '{}', 'draft', 'now', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO application_runs
         (id, draft_id, job_id, profile_id, platform, mode, status, started_at)
         VALUES ('run1', 'draft1', 'job1', 'p1', 'indeed', 'manual_assist', 'started', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO automation_tasks
         (id, profile_id, task_type, target_id, status, created_at, updated_at)
         VALUES ('task1', 'p1', 'apply_job', 'run1', 'running', 'now', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO browser_sessions
         (id, profile_id, platform, engine, user_data_dir, status, started_at, created_at, updated_at)
         VALUES ('session1', 'p1', 'indeed', 'playwright_chromium', '/tmp/profile', 'active', 'now', 'now', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();

    record_submission_evidence(&db, "task1", &Some("/tmp/fixture.png".into()), "now").await;
    close_submission_session(&db, "session1", "later").await;
    mark_submission_complete(&db, "task1", "session1", "later").await;

    let evidence: String =
        sqlx::query_scalar("SELECT file_path FROM automation_evidence WHERE task_id = 'task1'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(evidence, "/tmp/fixture.png");
    let session_status: String =
        sqlx::query_scalar("SELECT status FROM browser_sessions WHERE id = 'session1'")
            .fetch_one(&db)
            .await
            .unwrap();
    let task_status: String =
        sqlx::query_scalar("SELECT status FROM automation_tasks WHERE id = 'task1'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(session_status, "closed");
    assert_eq!(task_status, "completed");
}
