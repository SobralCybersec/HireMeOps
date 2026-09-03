//! SQLite pool creation and migration runner.
//! Key: `init_pool()` — opens the DB with WAL journaling, foreign keys, busy timeout.
//! Key: `run_migrations()` — applies all embedded migrations from `src-tauri/migrations/`.

use std::{env, fs, time::Duration};

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tracing::log::LevelFilter;

use super::paths::AppPaths;

pub async fn init_pool(paths: &AppPaths) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(&paths.db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .statement_cache_capacity(statement_cache_capacity())
        .optimize_on_close(true, None);
    let options = apply_tuning(options);

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections())
        .acquire_time_level(LevelFilter::Debug)
        .acquire_slow_level(LevelFilter::Warn)
        .acquire_slow_threshold(Duration::from_millis(50))
        .connect_with(options)
        .await
        .context("open sqlite pool")?;

    Ok(pool)
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .context("run database migrations")?;
    sqlx::query("PRAGMA optimize").execute(pool).await?;
    let sqlite_version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(pool)
        .await?;
    tracing::info!(%sqlite_version, "database migrations applied");
    Ok(())
}

fn max_connections() -> u32 {
    env::var("HIREMEOPS_DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(5)
        .clamp(1, 8)
}

fn statement_cache_capacity() -> usize {
    env::var("HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(256)
        .clamp(32, 1024)
}

fn apply_tuning(mut options: SqliteConnectOptions) -> SqliteConnectOptions {
    if let Some(cache_size) = env::var("HIREMEOPS_DB_CACHE_SIZE")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
    {
        options = options.pragma("cache_size", cache_size.to_string());
    }
    if let Some(mmap_size) = env::var("HIREMEOPS_DB_MMAP_SIZE")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        options = options.pragma("mmap_size", mmap_size.to_string());
    }
    if let Some(temp_store) = env::var("HIREMEOPS_DB_TEMP_STORE")
        .ok()
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value <= 2)
    {
        options = options.pragma("temp_store", temp_store.to_string());
    }
    options
}

/// Log passive WAL checkpoint state and file sizes without blocking writers.
pub async fn observe_wal(pool: &SqlitePool, db_path: &std::path::Path) -> Result<()> {
    let checkpoint: Option<(i64, i64, i64)> = sqlx::query_as("PRAGMA wal_checkpoint(PASSIVE)")
        .fetch_optional(pool)
        .await?;
    let file_name = db_path.file_name().unwrap_or_default().to_string_lossy();
    let wal_path = db_path.with_file_name(format!("{file_name}-wal"));
    let wal_bytes = fs::metadata(&wal_path).map(|meta| meta.len()).unwrap_or(0);
    tracing::debug!(?checkpoint, wal_bytes, "sqlite WAL observation");
    Ok(())
}

pub async fn maintain(pool: &SqlitePool, db_path: &std::path::Path) -> Result<()> {
    sqlx::query("PRAGMA optimize").execute(pool).await?;
    observe_wal(pool, db_path).await
}
