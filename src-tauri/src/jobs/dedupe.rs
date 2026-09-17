//! Duplicate job URL detection. Jobs are KEPT as separate rows on duplicate —
//! this only surfaces a warning; callers set status = 'skipped_duplicate_url'.
//! Key: `DedupeOutcome` — Unique or Duplicate{existing_id}.
//! Key: `check()` — looks up an existing job by profile+platform+canonical_url, earliest wins.

use sqlx::SqlitePool;

#[derive(Debug, PartialEq)]
pub enum DedupeOutcome {
    Unique,
    Duplicate { existing_id: String },
}

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
#[path = "../tests/jobs_dedupe_tests.rs"]
mod tests;
