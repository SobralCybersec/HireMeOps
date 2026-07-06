//! SQLite pool creation and migration runner.

use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use super::paths::AppPaths;

/// Open (creating if needed) the SQLite database with sane local-first
/// pragmas: WAL journaling, enforced foreign keys and a busy timeout.
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

/// Apply all embedded migrations from `src-tauri/migrations/`.
pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .context("run database migrations")?;
    tracing::info!("database migrations applied");
    Ok(())
}
