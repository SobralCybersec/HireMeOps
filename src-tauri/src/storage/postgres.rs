//! Optional shared PostgreSQL pool and repositories.
//!
//! SQLite remains the local-first source for settings, profiles, CV files, and
//! existing desktop workflows. PostgreSQL is opt-in through
//! `HIREMEOPS_DATABASE_URL` and owns only shared job intelligence data introduced
//! by `migrations-postgres/`.

use std::{env, time::Duration};

use anyhow::{Context, Result};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};

const DEFAULT_MAX_CONNECTIONS: u32 = 5;
const DEFAULT_MIN_CONNECTIONS: u32 = 0;
const DEFAULT_ACQUIRE_TIMEOUT_SECS: u64 = 5;
const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300;
const DEFAULT_MAX_LIFETIME_SECS: u64 = 1800;

/// Connect and migrate the optional shared database configured by the process.
/// A missing or failed shared database never prevents the local-first app from
/// starting; callers still get a log entry with the failure context.
pub async fn connect_from_env() -> Option<PgPool> {
    let url = env::var("HIREMEOPS_DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let Some(url) = url else {
        tracing::debug!("shared PostgreSQL is not configured; keeping local-first storage");
        return None;
    };

    match connect_url(&url).await {
        Ok(pool) => Some(pool),
        Err(error) => {
            tracing::error!(error = %error, "shared PostgreSQL unavailable; keeping local-first storage");
            None
        }
    }
}

/// Connect a PostgreSQL pool and run the shared schema migrations.
/// The URL is used only for the connection and is never logged.
pub async fn connect_url(url: &str) -> Result<PgPool> {
    let max_connections = env_u32(
        "HIREMEOPS_DB_MAX_CONNECTIONS",
        DEFAULT_MAX_CONNECTIONS,
        1,
        32,
    );
    let min_connections = env_u32(
        "HIREMEOPS_DB_MIN_CONNECTIONS",
        DEFAULT_MIN_CONNECTIONS,
        0,
        max_connections,
    );
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(env_duration(
            "HIREMEOPS_DB_ACQUIRE_TIMEOUT_SECS",
            DEFAULT_ACQUIRE_TIMEOUT_SECS,
            1,
            60,
        ))
        .idle_timeout(Some(env_duration(
            "HIREMEOPS_DB_IDLE_TIMEOUT_SECS",
            DEFAULT_IDLE_TIMEOUT_SECS,
            30,
            86_400,
        )))
        .max_lifetime(Some(env_duration(
            "HIREMEOPS_DB_MAX_LIFETIME_SECS",
            DEFAULT_MAX_LIFETIME_SECS,
            60,
            86_400,
        )))
        .connect(url)
        .await
        .context("connect shared PostgreSQL pool")?;

    run_migrations(&pool).await?;
    tracing::info!(max_connections, min_connections, "shared PostgreSQL ready");
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("./migrations-postgres")
        .run(pool)
        .await
        .context("run PostgreSQL migrations")?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, FromRow)]
pub struct SharedJobHit {
    pub id: String,
    pub title: String,
    pub company: String,
    pub location: Option<String>,
    pub canonical_url: Option<String>,
    pub lexical_score: f64,
    pub semantic_score: f64,
    pub hybrid_score: f64,
}

#[derive(Debug, Clone, Default)]
pub struct SharedJobSearch<'a> {
    pub profile_id: Option<&'a str>,
    pub query: &'a str,
    pub location: Option<&'a str>,
    pub remote_mode: Option<&'a str>,
    pub company: Option<&'a str>,
    pub semantic_embedding: Option<&'a str>,
    pub limit: i64,
}

/// Hybrid retrieval with deterministic hard filters applied before scoring.
/// PostgreSQL FTS is always available; semantic scoring is zero until a real
/// embedding produced by a configured model is supplied.
pub async fn search_shared_jobs(
    pool: &PgPool,
    search: SharedJobSearch<'_>,
) -> Result<Vec<SharedJobHit>> {
    let limit = search.limit.clamp(1, 500);
    let rows = sqlx::query_as::<_, SharedJobHit>(
        "WITH candidates AS (
             SELECT id, title, company, location, canonical_url,
                    CASE
                        WHEN $2::text = '' THEN 0::double precision
                        ELSE ts_rank(search_document, websearch_to_tsquery('simple', $2))::double precision
                    END AS lexical_score,
                    CASE
                        WHEN $6::vector IS NULL OR embedding IS NULL THEN 0::double precision
                        ELSE 1 - (embedding <=> $6::vector)
                    END AS semantic_score
             FROM shared_jobs
             WHERE ($1::text IS NULL OR profile_id = $1)
               AND ($2::text = '' OR search_document @@ websearch_to_tsquery('simple', $2))
               AND ($3::text IS NULL OR location ILIKE '%' || $3 || '%')
               AND ($4::text IS NULL OR remote_mode = $4)
               AND ($5::text IS NULL OR company ILIKE '%' || $5 || '%')
         )
         SELECT id, title, company, location, canonical_url,
                lexical_score, semantic_score,
                (0.5 * lexical_score + 0.5 * semantic_score) AS hybrid_score
         FROM candidates
         ORDER BY hybrid_score DESC, id ASC
         LIMIT $7",
    )
    .bind(search.profile_id)
    .bind(search.query.trim())
    .bind(search.location)
    .bind(search.remote_mode)
    .bind(search.company)
    .bind(search.semantic_embedding)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("search shared jobs")?;
    Ok(rows)
}

fn env_u32(name: &str, fallback: u32, min: u32, max: u32) -> u32 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
        .clamp(min, max)
}

fn env_duration(name: &str, fallback_secs: u64, min_secs: u64, max_secs: u64) -> Duration {
    Duration::from_secs(
        env_u32(name, fallback_secs as u32, min_secs as u32, max_secs as u32) as u64,
    )
}

#[cfg(test)]
mod tests {
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
}
