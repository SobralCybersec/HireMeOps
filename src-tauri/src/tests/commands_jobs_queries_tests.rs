use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tauri::Manager;

async fn mem_pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1', 'Test', 'now', 'now', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

async fn insert_job(pool: &sqlx::SqlitePool, id: &str, discovered_at: &str, status: &str) {
    sqlx::query(
        "INSERT INTO job_posts
             (id, profile_id, platform, url, title, company, location, description,
              status, discovered_at)
             VALUES (?1, 'p1', 'linkedin', ?2, 'Backend Engineer', 'Example Co',
                     'Remote', 'Rust backend role', ?3, ?4)",
    )
    .bind(id)
    .bind(format!("https://jobs.test/{id}"))
    .bind(status)
    .bind(discovered_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn search_and_recent_queries_cover_filters_cursor_and_offset() {
    let pool = mem_pool().await;
    insert_job(&pool, "job-1", "2026-01-03", "discovered").await;
    insert_job(&pool, "job-2", "2026-01-02", "saved").await;
    insert_job(&pool, "job-3", "2026-01-01", "discovered").await;

    assert!(search_job_posts(&pool, "p1", None, "", 10)
        .await
        .unwrap()
        .is_empty());
    let found = search_job_posts(&pool, "p1", None, "backend", 10)
        .await
        .unwrap();
    assert_eq!(found.len(), 3);
    let saved = search_job_posts(&pool, "p1", Some("saved"), "backend", 10)
        .await
        .unwrap();
    assert_eq!(saved.len(), 1);
    assert!(search_job_posts(&pool, "other", None, "backend", 10)
        .await
        .unwrap()
        .is_empty());

    let recent = list_recent_job_posts(
        &pool,
        RecentJobPosts {
            profile_id: "p1",
            status_filter: None,
            limit: 10,
            offset: 0,
            cursor_discovered_at: None,
            cursor_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        recent.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
        ["job-1", "job-2", "job-3"]
    );

    let paged = list_recent_job_posts(
        &pool,
        RecentJobPosts {
            profile_id: "p1",
            status_filter: Some("discovered"),
            limit: 1,
            offset: 1,
            cursor_discovered_at: None,
            cursor_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(paged[0].id, "job-3");

    let cursor = list_recent_job_posts(
        &pool,
        RecentJobPosts {
            profile_id: "p1",
            status_filter: None,
            limit: 10,
            offset: 0,
            cursor_discovered_at: Some("2026-01-02"),
            cursor_id: Some("job-2"),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        cursor.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
        ["job-3"]
    );
}

#[tokio::test]
async fn insert_job_post_persists_all_ingest_fields() {
    let pool = mem_pool().await;
    sqlx::query(
        "INSERT INTO search_queries
             (id, profile_id, platform, query, query_type, enabled, created_at)
             VALUES ('query', 'p1', 'indeed', 'rust', 'manual', 1, 'now')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let input = IngestJobPostInput {
        profile_id: "p1".into(),
        platform: "indeed".into(),
        url: "https://jobs.test/42".into(),
        title: "Rust Engineer".into(),
        company: "Example".into(),
        description: "Build services".into(),
        external_id: Some("ext-42".into()),
        location: Some("Remote".into()),
        remote_mode: Some("remote".into()),
        summary: Some("Summary".into()),
        salary_min: Some(100),
        salary_max: Some(200),
        currency: Some("USD".into()),
        seniority: Some("senior".into()),
        employment_type: Some("full-time".into()),
        posted_at: Some("2026-01-01".into()),
        search_query_id: Some("query".into()),
        discovery_source: Some("test".into()),
    };
    insert_job_post(
        &pool,
        JobPostInsert {
            id: "job-42",
            input: &input,
            canonical: "https://jobs.test/42",
            remote_mode: &input.remote_mode,
            now: "2026-01-01T00:00:00Z",
            status: "discovered",
        },
    )
    .await
    .unwrap();
    let row: (String, i64, i64, Option<String>) = sqlx::query_as(
        "SELECT title, salary_min, salary_max, discovery_source
             FROM job_posts WHERE id = 'job-42'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "Rust Engineer");
    assert_eq!(row.1, 100);
    assert_eq!(row.2, 200);
    assert_eq!(row.3.as_deref(), Some("test"));
}

fn preference_input() -> CreateJobPreferenceInput {
    CreateJobPreferenceInput {
        profile_id: "p1".into(),
        name: "Backend roles".into(),
        target_roles_json: r#"["backend engineer"]"#.into(),
        seniority_json: Some(r#"["senior"]"#.into()),
        locations_json: Some(r#"["Remote"]"#.into()),
        remote_modes_json: Some(r#"["remote"]"#.into()),
        min_salary: Some(5000),
        salary_currency: Some("BRL".into()),
        required_skills_json: Some(r#"["Rust"]"#.into()),
        preferred_skills_json: None,
        excluded_keywords_json: None,
        blocked_companies_json: None,
        auto_apply_enabled: Some(true),
        auto_submit_enabled: Some(false),
        auto_submit_min_score: Some(80),
        needs_review_confidence_threshold: Some(70),
        retry_failed_enabled: Some(false),
        retry_limit: Some(2),
        daily_application_limit: Some(3),
        daily_connection_limit: Some(4),
    }
}

#[tokio::test]
async fn query_commands_cover_preference_search_and_job_crud() {
    let pool = mem_pool().await;
    let app = crate::test_support::app_with_db(pool);
    let state = app.state::<crate::AppState>();

    let preference_id = create_job_preference(state.clone(), preference_input())
        .await
        .unwrap();
    let preferences = list_job_preferences(state.clone(), "p1".into())
        .await
        .unwrap();
    assert_eq!(preferences.len(), 1);
    assert!(!preferences[0].auto_submit_enabled);
    assert!(!preferences[0].retry_failed_enabled);

    let ids = generate_search_queries(
        state.clone(),
        SearchQueryInput {
            profile_id: "p1".into(),
            preference_id: Some(preference_id.clone()),
            titles: vec!["Backend Engineer".into()],
            required_skills: vec!["Rust".into()],
            location: Some("Remote".into()),
            remote_mode: Some("remote".into()),
            seniority: vec!["senior".into()],
        },
    )
    .await
    .unwrap();
    assert!(!ids.is_empty());
    assert_eq!(
        list_search_queries(state.clone(), "p1".into(), None)
            .await
            .unwrap()
            .len(),
        ids.len()
    );
    assert_eq!(
        list_search_queries(state.clone(), "p1".into(), Some(preference_id))
            .await
            .unwrap()
            .len(),
        ids.len()
    );
    delete_search_query(state.clone(), ids[0].clone())
        .await
        .unwrap();

    let input = IngestJobPostInput {
        profile_id: "p1".into(),
        platform: "linkedin".into(),
        url: "https://jobs.test/backend?utm_source=fixture".into(),
        title: "Backend Engineer".into(),
        company: "Fixture Co".into(),
        description: "Remote Rust role".into(),
        external_id: None,
        location: Some("Remote".into()),
        remote_mode: None,
        summary: None,
        salary_min: None,
        salary_max: None,
        currency: None,
        seniority: None,
        employment_type: None,
        posted_at: None,
        search_query_id: None,
        discovery_source: Some("fixture".into()),
    };
    let first = ingest_job_post(state.clone(), input.clone()).await.unwrap();
    let duplicate = ingest_job_post(state.clone(), input).await.unwrap();
    assert!(!first.is_duplicate);
    assert!(duplicate.is_duplicate);
    assert_eq!(duplicate.duplicate_of.as_deref(), Some(first.id.as_str()));

    let listed = list_job_posts(
        state.clone(),
        ListJobPostsInput {
            profile_id: "p1".into(),
            status_filter: Some("discovered".into()),
            limit: Some(0),
            offset: Some(-1),
            cursor_discovered_at: None,
            cursor_id: None,
            search: Some("backend".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].description.as_deref(), Some("Remote Rust role"));
    assert_eq!(
        get_job_post(state.clone(), "p1".into(), first.id.clone())
            .await
            .unwrap()
            .id,
        first.id
    );
    update_job_status(state.clone(), first.id.clone(), "saved".into())
        .await
        .unwrap();
    assert!(update_job_status(state.clone(), first.id, "invalid".into())
        .await
        .is_err());
    assert!(
        list_job_matches(state.clone(), "p1".into(), Some(0), Some(-1))
            .await
            .unwrap()
            .is_empty()
    );
    optimize_job_search_index(state.clone()).await.unwrap();
    assert_eq!(delete_old_scans(state, "p1".into(), 0).await.unwrap(), 2);
}
