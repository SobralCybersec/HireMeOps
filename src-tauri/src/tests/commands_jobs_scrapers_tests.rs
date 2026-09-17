use super::{card_remote_mode, validated_search_query};
use crate::domain::automation::JobCard;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn database() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    db
}

fn card(title: &str, location: &str, description: &str) -> JobCard {
    JobCard {
        job_id: Some("job-1".into()),
        title: Some(title.into()),
        company: Some("Acme".into()),
        location: Some(location.into()),
        apply_url: Some("https://jobs.test/1".into()),
        is_easy_apply: false,
        description: Some(description.into()),
    }
}

#[test]
fn card_remote_mode_uses_platform_fields_and_fallback() {
    assert_eq!(
        card_remote_mode(&card("Backend", "Remote", "Rust"), "indeed", false),
        Some("remote".into())
    );
    assert_eq!(
        card_remote_mode(
            &card("Backend", "São Paulo", "Remote role"),
            "linkedin",
            false
        ),
        Some("remote".into())
    );
    assert_eq!(
        card_remote_mode(&card("Backend", "São Paulo", "No details"), "other", true),
        Some("remote".into())
    );
    assert_eq!(
        card_remote_mode(&card("Backend", "São Paulo", "No details"), "other", false),
        None
    );
}

#[tokio::test]
async fn validated_search_query_requires_profile_and_keeps_only_existing_query() {
    let db = database().await;
    let missing = validated_search_query(&db, "missing", None).await;
    assert!(missing.unwrap_err().contains("unknown profile"));

    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1', 'Test', 'now', 'now', 1)",
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(validated_search_query(&db, "p1", None).await.unwrap(), None);
    assert_eq!(
        validated_search_query(&db, "p1", Some("missing-query".into()))
            .await
            .unwrap(),
        None
    );

    sqlx::query(
        "INSERT INTO search_queries
             (id, profile_id, platform, query, query_type, enabled, created_at)
             VALUES ('q1', 'p1', 'linkedin', 'rust', 'linkedin_search', 1, 'now')",
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        validated_search_query(&db, "p1", Some("q1".into()))
            .await
            .unwrap()
            .as_deref(),
        Some("q1")
    );
}
