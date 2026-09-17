use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn mem_pool() -> SqlitePool {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
    let pool = SqlitePoolOptions::new().connect_with(opts).await.unwrap();
    sqlx::query(
        "CREATE TABLE job_posts (
                id TEXT PRIMARY KEY,
                profile_id TEXT,
                platform TEXT NOT NULL,
                url TEXT NOT NULL,
                canonical_url TEXT,
                title TEXT NOT NULL DEFAULT '',
                company TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                discovered_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
                status TEXT NOT NULL DEFAULT 'discovered'
            )",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn unique_when_empty() {
    let pool = mem_pool().await;
    let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(out, DedupeOutcome::Unique);
}

#[tokio::test]
async fn detects_duplicate() {
    let pool = mem_pool().await;
    sqlx::query(
            "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url) \
             VALUES ('job-1', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', 'https://linkedin.com/jobs/1')",
        )
        .execute(&pool)
        .await
        .unwrap();

    let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(
        out,
        DedupeOutcome::Duplicate {
            existing_id: "job-1".into()
        }
    );
}

#[tokio::test]
async fn different_profile_is_unique() {
    let pool = mem_pool().await;
    sqlx::query(
            "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url) \
             VALUES ('job-1', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', 'https://linkedin.com/jobs/1')",
        )
        .execute(&pool)
        .await
        .unwrap();

    let out = check(&pool, "p2", "linkedin", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(out, DedupeOutcome::Unique);
}

#[tokio::test]
async fn different_platform_is_unique() {
    let pool = mem_pool().await;
    sqlx::query(
            "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url) \
             VALUES ('job-1', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', 'https://linkedin.com/jobs/1')",
        )
        .execute(&pool)
        .await
        .unwrap();

    let out = check(&pool, "p1", "indeed", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(out, DedupeOutcome::Unique);
}

#[tokio::test]
async fn returns_earliest_when_multiple_exist() {
    let pool = mem_pool().await;
    sqlx::query(
        "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url, discovered_at) \
             VALUES ('job-late', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', \
                     'https://linkedin.com/jobs/1', '2024-06-02T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url, discovered_at) \
             VALUES ('job-early', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', \
                     'https://linkedin.com/jobs/1', '2024-06-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(
        out,
        DedupeOutcome::Duplicate {
            existing_id: "job-early".into()
        }
    );
}

#[tokio::test]
async fn null_canonical_url_does_not_match_non_null() {
    let pool = mem_pool().await;
    sqlx::query(
        "INSERT INTO job_posts (id, profile_id, platform, url, canonical_url) \
             VALUES ('job-null', 'p1', 'linkedin', 'https://linkedin.com/jobs/1', NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1")
        .await
        .unwrap();
    assert_eq!(out, DedupeOutcome::Unique);
}
