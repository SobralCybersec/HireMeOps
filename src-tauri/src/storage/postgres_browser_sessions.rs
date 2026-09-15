//! PostgreSQL repository for encrypted browser snapshots and profile locks.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use sqlx::{postgres::PgConnection, Connection, FromRow, PgPool};
#[cfg(any(test, feature = "real-browser"))]
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionMetadata {
    pub id: String,
    pub profile_id: String,
    pub encryption_version: i32,
    pub state_format_version: i32,
    pub revision: i64,
    pub status: String,
    pub platform_status: Value,
    pub created_at: String,
    pub updated_at: String,
    pub last_validated_at: Option<String>,
}

#[derive(Debug, FromRow)]
struct BrowserSessionRow {
    id: String,
    profile_id: String,
    encryption_version: i32,
    state_format_version: i32,
    revision: i64,
    status: String,
    platform_status: sqlx::types::Json<Value>,
    created_at: String,
    updated_at: String,
    last_validated_at: Option<String>,
}

impl From<BrowserSessionRow> for BrowserSessionMetadata {
    fn from(row: BrowserSessionRow) -> Self {
        Self {
            id: row.id,
            profile_id: row.profile_id,
            encryption_version: row.encryption_version,
            state_format_version: row.state_format_version,
            revision: row.revision,
            status: row.status,
            platform_status: row.platform_status.0,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_validated_at: row.last_validated_at,
        }
    }
}

const SESSION_METADATA_COLUMNS: &str = "
    id, profile_id, encryption_version, state_format_version, revision, status,
    platform_status, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at,
    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS updated_at,
    CASE WHEN last_validated_at IS NULL THEN NULL ELSE to_char(last_validated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS last_validated_at";

pub async fn get_browser_session_metadata(
    pool: &PgPool,
    profile_id: &str,
) -> Result<Option<BrowserSessionMetadata>> {
    let query =
        format!("SELECT {SESSION_METADATA_COLUMNS} FROM browser_sessions WHERE profile_id = $1");
    let row = sqlx::query_as::<_, BrowserSessionRow>(sqlx::AssertSqlSafe(query))
        .bind(profile_id)
        .fetch_optional(pool)
        .await
        .context("read browser session metadata")?;
    Ok(row.map(Into::into))
}

#[cfg(any(test, feature = "real-browser"))]
pub struct BrowserSessionWrite<'a> {
    pub profile_id: &'a str,
    pub encrypted_state: &'a [u8],
    pub encryption_version: i32,
    pub state_format_version: i32,
    pub status: &'a str,
    pub platform_status: &'a Value,
    pub expected_revision: Option<i64>,
}

#[cfg(any(test, feature = "real-browser"))]
pub async fn upsert_browser_session(
    pool: &PgPool,
    write: BrowserSessionWrite<'_>,
) -> Result<Option<BrowserSessionMetadata>> {
    if !matches!(
        write.status,
        "valid" | "expired" | "login_required" | "challenged" | "unknown" | "revoked"
    ) {
        bail!("invalid browser session status")
    }
    let query = format!(
        "INSERT INTO browser_sessions
          (id, profile_id, encrypted_state, encryption_version, state_format_version, revision,
           status, platform_status, created_at, updated_at, last_validated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, now(), now(), now())
         ON CONFLICT (profile_id) DO UPDATE SET
           encrypted_state = EXCLUDED.encrypted_state,
           encryption_version = EXCLUDED.encryption_version,
           state_format_version = EXCLUDED.state_format_version,
           revision = browser_sessions.revision + 1,
           status = EXCLUDED.status,
           platform_status = EXCLUDED.platform_status,
           updated_at = now(),
           last_validated_at = now()
         WHERE ($8::bigint IS NULL OR browser_sessions.revision = $8)
         RETURNING {SESSION_METADATA_COLUMNS}",
    );
    let row = sqlx::query_as::<_, BrowserSessionRow>(sqlx::AssertSqlSafe(query))
        .bind(Uuid::new_v4().to_string())
        .bind(write.profile_id)
        .bind(write.encrypted_state)
        .bind(write.encryption_version)
        .bind(write.state_format_version)
        .bind(write.status)
        .bind(sqlx::types::Json(write.platform_status.clone()))
        .bind(write.expected_revision)
        .fetch_optional(pool)
        .await
        .context("save browser session")?;
    Ok(row.map(Into::into))
}

#[cfg(any(test, feature = "real-browser"))]
pub async fn update_browser_session_status(
    pool: &PgPool,
    profile_id: &str,
    status: &str,
    platform_status: &Value,
    expected_revision: i64,
) -> Result<Option<BrowserSessionMetadata>> {
    let query = format!(
        "UPDATE browser_sessions
         SET status = $2, platform_status = $3, revision = revision + 1,
             updated_at = now(), last_validated_at = now()
         WHERE profile_id = $1 AND revision = $4
         RETURNING {SESSION_METADATA_COLUMNS}"
    );
    let row = sqlx::query_as::<_, BrowserSessionRow>(sqlx::AssertSqlSafe(query))
        .bind(profile_id)
        .bind(status)
        .bind(sqlx::types::Json(platform_status.clone()))
        .bind(expected_revision)
        .fetch_optional(pool)
        .await
        .context("update browser session status")?;
    Ok(row.map(Into::into))
}

pub async fn revoke_browser_session(
    pool: &PgPool,
    profile_id: &str,
) -> Result<Option<BrowserSessionMetadata>> {
    let query = format!(
        "UPDATE browser_sessions
         SET status = 'revoked', platform_status = '{{}}'::jsonb,
             revision = CASE WHEN status = 'revoked' THEN revision ELSE revision + 1 END,
             updated_at = now()
         WHERE profile_id = $1
         RETURNING {SESSION_METADATA_COLUMNS}"
    );
    let row = sqlx::query_as::<_, BrowserSessionRow>(sqlx::AssertSqlSafe(query))
        .bind(profile_id)
        .fetch_optional(pool)
        .await
        .context("revoke browser session")?;
    Ok(row.map(Into::into))
}

pub struct ProfileSessionLock {
    connection: Option<PgConnection>,
    profile_id: String,
}

pub async fn try_lock_profile(
    pool: &PgPool,
    profile_id: &str,
) -> Result<Option<ProfileSessionLock>> {
    let mut connection = pool.acquire().await?.detach();
    let acquired: bool =
        match sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1, 0))")
            .bind(profile_id)
            .fetch_one(&mut connection)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                let _ = connection.close().await;
                return Err(error).context("acquire browser session lock");
            }
        };
    if !acquired {
        let _ = connection.close().await;
        return Ok(None);
    }
    Ok(Some(ProfileSessionLock {
        connection: Some(connection),
        profile_id: profile_id.to_owned(),
    }))
}

impl ProfileSessionLock {
    pub async fn release(mut self) -> Result<()> {
        let Some(mut connection) = self.connection.take() else {
            return Ok(());
        };
        let unlocked: bool =
            sqlx::query_scalar("SELECT pg_advisory_unlock(hashtextextended($1, 0))")
                .bind(&self.profile_id)
                .fetch_one(&mut connection)
                .await
                .unwrap_or(false);
        let _ = connection.close().await;
        if !unlocked {
            bail!("release browser session lock failed")
        }
        Ok(())
    }
}
