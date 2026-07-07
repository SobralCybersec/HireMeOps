//! Duplicate job URL detection. Jobs are KEPT as separate rows on duplicate —
//! this only surfaces a warning; callers set status = 'skipped_duplicate_url'.

use sqlx::SqlitePool;

#[derive(Debug, PartialEq)]
pub enum DedupeOutcome {
    Unique,
    Duplicate { existing_id: String },
}

/// Check whether a job with `canonical_url` already exists for this profile+platform.
pub async fn check(
    pool: &SqlitePool,
    profile_id: &str,
    platform: &str,
    canonical_url: &str,
) -> Result<DedupeOutcome, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM job_posts \
         WHERE profile_id = ?1 AND platform = ?2 AND canonical_url = ?3 \
         ORDER BY discovered_at ASC LIMIT 1",
    )
    .bind(profile_id)
    .bind(platform)
    .bind(canonical_url)
    .fetch_optional(pool)
    .await?;

    Ok(match row {
        None => DedupeOutcome::Unique,
        Some((id,)) => DedupeOutcome::Duplicate { existing_id: id },
    })
}

#[cfg(test)]
mod tests {
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
        let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1").await.unwrap();
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

        let out = check(&pool, "p1", "linkedin", "https://linkedin.com/jobs/1").await.unwrap();
        assert_eq!(out, DedupeOutcome::Duplicate { existing_id: "job-1".into() });
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

        let out = check(&pool, "p2", "linkedin", "https://linkedin.com/jobs/1").await.unwrap();
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

        let out = check(&pool, "p1", "indeed", "https://linkedin.com/jobs/1").await.unwrap();
        assert_eq!(out, DedupeOutcome::Unique);
    }
}
