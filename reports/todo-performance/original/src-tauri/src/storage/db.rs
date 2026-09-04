//! SQLite pool creation and migration runner.
//! Key: `init_pool()` — opens the DB with WAL journaling, foreign keys, busy timeout.
//! Key: `run_migrations()` — applies all embedded migrations from `src-tauri/migrations/`.

use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use super::paths::AppPaths;

pub async fn init_pool(paths: &AppPaths) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(&paths.db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
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
    tracing::info!("database migrations applied");
    Ok(())
}
