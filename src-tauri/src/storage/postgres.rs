//! Optional shared PostgreSQL pool and repositories.
//!
//! SQLite remains the local-first source for settings, profiles, CV files, and
//! existing desktop workflows. PostgreSQL is opt-in through
//! `HIREMEOPS_DATABASE_URL` and owns only shared job intelligence data introduced
//! by `migrations-postgres/`.

use std::{env, time::Duration};

use anyhow::{Context, Result};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};

#[cfg(test)]
use uuid::Uuid;

pub use super::postgres_browser_sessions::{
    get_browser_session_metadata, revoke_browser_session, try_lock_profile, BrowserSessionMetadata,
};
#[cfg(any(test, feature = "real-browser"))]
pub use super::postgres_browser_sessions::{
    update_browser_session_status, upsert_browser_session, BrowserSessionWrite,
};

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
#[path = "../tests/storage_postgres_tests.rs"]
mod tests;
