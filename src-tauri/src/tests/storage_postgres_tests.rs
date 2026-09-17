use super::*;

#[test]
fn pool_defaults_are_modest_and_bounded() {
    assert_eq!(
        env_u32("HIREMEOPS_MISSING", DEFAULT_MAX_CONNECTIONS, 1, 32),
        5
    );
    assert_eq!(
        env_duration("HIREMEOPS_MISSING", 5, 1, 60),
        Duration::from_secs(5)
    );
}

#[test]
fn pool_environment_values_are_parsed_and_clamped() {
    let previous = std::env::var("HIREMEOPS_TEST_POOL_VALUE").ok();
    std::env::set_var("HIREMEOPS_TEST_POOL_VALUE", "999");
    assert_eq!(env_u32("HIREMEOPS_TEST_POOL_VALUE", 5, 1, 32), 32);
    std::env::set_var("HIREMEOPS_TEST_POOL_VALUE", "0");
    assert_eq!(env_u32("HIREMEOPS_TEST_POOL_VALUE", 5, 1, 32), 1);
    std::env::set_var("HIREMEOPS_TEST_POOL_VALUE", "bad");
    assert_eq!(
        env_duration("HIREMEOPS_TEST_POOL_VALUE", 5, 1, 60),
        Duration::from_secs(5)
    );
    match previous {
        Some(value) => std::env::set_var("HIREMEOPS_TEST_POOL_VALUE", value),
        None => std::env::remove_var("HIREMEOPS_TEST_POOL_VALUE"),
    }
}

#[tokio::test]
async fn connection_failure_is_reported_with_context() {
    let result = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect("postgres://invalid:invalid@127.0.0.1:1/invalid")
        .await;
    let error = result
        .expect_err("port 1 must not provide PostgreSQL")
        .to_string();
    assert!(!error.is_empty());
}

#[tokio::test]
async fn postgres_schema_smoke_runs_against_configured_empty_database() {
    let Ok(url) = env::var("HIREMEOPS_DATABASE_URL") else {
        return;
    };
    let pool = connect_url(&url)
        .await
        .expect("PostgreSQL migrations should run");
    assert_cloud_schema(&pool).await;
    exercise_browser_session_repository(&pool).await;

    sqlx::query("DELETE FROM shared_jobs WHERE id LIKE 'test-postgres-%'")
        .execute(&pool)
        .await
        .unwrap();

    for (id, title, embedding) in [
        ("test-postgres-backend", "Backend Java", "[1,0,0]"),
        ("test-postgres-design", "Product Design", "[0,1,0]"),
    ] {
        sqlx::query(
                "INSERT INTO shared_jobs
                 (id, platform, title, company, description, embedding, embedding_model, embedding_dimensions)
                 VALUES ($1, 'fixture', $2, 'Fixture Co', $3, $4::vector, 'fixture-model', 3)",
            )
            .bind(id)
            .bind(title)
            .bind(format!("{title} role"))
            .bind(embedding)
            .execute(&pool)
            .await
            .unwrap();
    }

    let hits = search_shared_jobs(
        &pool,
        SharedJobSearch {
            query: "backend",
            semantic_embedding: Some("[1,0,0]"),
            limit: 10,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        hits.first().map(|hit| hit.id.as_str()),
        Some("test-postgres-backend")
    );

    let duplicate = sqlx::query(
        "INSERT INTO job_discoveries (id, job_id, source, source_key)
             VALUES ('test-postgres-discovery-1', 'test-postgres-backend', 'fixture', 'same')",
    )
    .execute(&pool)
    .await;
    assert!(duplicate.is_ok());
    let duplicate_again = sqlx::query(
        "INSERT INTO job_discoveries (id, job_id, source, source_key)
             VALUES ('test-postgres-discovery-2', 'test-postgres-backend', 'fixture', 'same')",
    )
    .execute(&pool)
    .await;
    assert!(duplicate_again.is_err());

    sqlx::query("DELETE FROM shared_jobs WHERE id LIKE 'test-postgres-%'")
        .execute(&pool)
        .await
        .unwrap();
}

async fn assert_cloud_schema(pool: &PgPool) {
    let session_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'browser_sessions'",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    for column in [
        "encrypted_state",
        "encryption_version",
        "state_format_version",
        "revision",
        "status",
        "platform_status",
    ] {
        assert!(session_columns.iter().any(|value| value == column));
    }
    let shared_job_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shared_jobs'",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(shared_job_columns
        .iter()
        .any(|value| value == "search_run_id"));
}

async fn exercise_browser_session_repository(pool: &PgPool) {
    let fixture_profile = format!("test-postgres-session-{}", Uuid::new_v4());
    let first = upsert_browser_session(
        pool,
        BrowserSessionWrite {
            profile_id: &fixture_profile,
            encrypted_state: &[0x01, 0x02, 0x03],
            encryption_version: 1,
            state_format_version: 1,
            status: "valid",
            platform_status: &serde_json::json!({ "fixture": "valid" }),
            expected_revision: None,
        },
    )
    .await
    .unwrap()
    .expect("session insert should return metadata");
    assert_eq!(first.revision, 1);
    assert_eq!(first.encrypted_state_bytes, 3);
    let updated = update_browser_session_status(
        pool,
        &fixture_profile,
        "challenged",
        &serde_json::json!({ "fixture": "challenged" }),
        first.revision,
    )
    .await
    .unwrap()
    .expect("session status update should return metadata");
    assert_eq!(updated.status, "challenged");
    assert_eq!(updated.revision, first.revision + 1);
    assert!(upsert_browser_session(
        pool,
        BrowserSessionWrite {
            profile_id: &fixture_profile,
            encrypted_state: &[0x04],
            encryption_version: 1,
            state_format_version: 1,
            status: "valid",
            platform_status: &serde_json::json!({}),
            expected_revision: Some(first.revision),
        },
    )
    .await
    .unwrap()
    .is_none());
    let revoked = revoke_browser_session(pool, &fixture_profile)
        .await
        .unwrap()
        .expect("session revoke should return metadata");
    assert_eq!(revoked.status, "revoked");
    sqlx::query("DELETE FROM browser_sessions WHERE profile_id = $1")
        .bind(&fixture_profile)
        .execute(pool)
        .await
        .unwrap();
}
