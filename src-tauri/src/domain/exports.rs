//! Data export and backup / restore (Phase 6/7).
//!
//! Two responsibilities:
//!  * **Exports** — human-portable dumps of the user's data: profiles as JSON
//!    (configs + CV references), and jobs / applications / audit log as CSV.
//!  * **Backups** — full, self-consistent database snapshots via SQLite
//!    `VACUUM INTO`, listing of existing snapshots, and a validated restore.
//!
//! No external `csv` crate is pulled in — the RFC-4180 escaping we need is a
//! few lines. `VACUUM INTO` yields a fully-consistent snapshot even while the
//! primary connection stays live, which is exactly what a backup wants.

use std::path::Path;

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use super::{DomainError, DomainResult};
use crate::util::{new_id, now_iso};

// ── CSV helpers ─────────────────────────────────────────────────────────────

/// Escape one CSV field per RFC-4180: wrap in double-quotes and double any
/// embedded quote when the value contains a comma, quote, CR or LF.
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Join one row of raw string fields, CRLF-terminated (RFC-4180).
fn csv_row(fields: &[&str]) -> String {
    let mut line = String::new();
    for (i, f) in fields.iter().enumerate() {
        if i > 0 {
            line.push(',');
        }
        line.push_str(&csv_field(f));
    }
    line.push_str("\r\n");
    line
}

/// Read column `name` as text, mapping SQL NULL to an empty string. Every
/// export query `CAST`s integer columns to TEXT so this reads uniformly.
fn text(row: &sqlx::sqlite::SqliteRow, name: &str) -> String {
    row.try_get::<Option<String>, _>(name)
        .ok()
        .flatten()
        .unwrap_or_default()
}

// ── Exports ─────────────────────────────────────────────────────────────────

/// All profile configs plus their CV document references, as pretty JSON.
pub async fn export_profiles_json(pool: &SqlitePool) -> DomainResult<String> {
    let profiles = sqlx::query(
        "SELECT id, display_name, target_title, summary, location, \
         remote_preference, seniority, is_active, created_at, updated_at \
         FROM profiles ORDER BY created_at",
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(profiles.len());
    for p in &profiles {
        let id: String = p.try_get("id")?;
        let cvs = sqlx::query(
            "SELECT id, file_name, file_type, created_at FROM cv_documents \
             WHERE profile_id = ?1 ORDER BY created_at",
        )
        .bind(&id)
        .fetch_all(pool)
        .await?;
        let cv_docs: Vec<_> = cvs
            .iter()
            .map(|c| {
                serde_json::json!({
                    "id": text(c, "id"),
                    "file_name": text(c, "file_name"),
                    "file_type": text(c, "file_type"),
                    "created_at": text(c, "created_at"),
                })
            })
            .collect();
        out.push(serde_json::json!({
            "id": id,
            "display_name": text(p, "display_name"),
            "target_title": text(p, "target_title"),
            "summary": text(p, "summary"),
            "location": text(p, "location"),
            "remote_preference": text(p, "remote_preference"),
            "seniority": text(p, "seniority"),
            "is_active": p.try_get::<i64, _>("is_active").unwrap_or(0) != 0,
            "created_at": text(p, "created_at"),
            "updated_at": text(p, "updated_at"),
            "cv_documents": cv_docs,
        }));
    }

    let doc = serde_json::json!({
        "exported_at": now_iso(),
        "profile_count": out.len(),
        "profiles": out,
    });
    serde_json::to_string_pretty(&doc).map_err(|e| DomainError::Other(e.into()))
}

/// Job listings joined with their best match score, as CSV.
pub async fn export_jobs_csv(pool: &SqlitePool) -> DomainResult<String> {
    let rows = sqlx::query(
        "SELECT j.title AS title, j.company AS company, j.location AS location, \
         j.remote_mode AS remote_mode, j.platform AS platform, j.status AS status, \
         CAST(j.salary_min AS TEXT) AS salary_min, \
         CAST(j.salary_max AS TEXT) AS salary_max, j.currency AS currency, \
         CAST(m.best_score AS TEXT) AS best_score, j.url AS url, \
         j.discovered_at AS discovered_at \
         FROM job_posts j \
         LEFT JOIN (SELECT job_id, MAX(score) AS best_score FROM job_matches \
                    GROUP BY job_id) m ON m.job_id = j.id \
         ORDER BY j.discovered_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut csv = csv_row(&[
        "Title",
        "Company",
        "Location",
        "Remote",
        "Platform",
        "Status",
        "Salary Min",
        "Salary Max",
        "Currency",
        "Best Match Score",
        "URL",
        "Discovered At",
    ]);
    for r in &rows {
        csv.push_str(&csv_row(&[
            &text(r, "title"),
            &text(r, "company"),
            &text(r, "location"),
            &text(r, "remote_mode"),
            &text(r, "platform"),
            &text(r, "status"),
            &text(r, "salary_min"),
            &text(r, "salary_max"),
            &text(r, "currency"),
            &text(r, "best_score"),
            &text(r, "url"),
            &text(r, "discovered_at"),
        ]));
    }
    Ok(csv)
}

/// Application run history — outcomes and retry attempts — as CSV.
pub async fn export_applications_csv(pool: &SqlitePool) -> DomainResult<String> {
    let rows = sqlx::query(
        "SELECT r.id AS id, j.title AS title, j.company AS company, \
         r.platform AS platform, r.mode AS mode, r.status AS status, \
         CAST(r.attempt AS TEXT) AS attempt, r.started_at AS started_at, \
         r.finished_at AS finished_at, r.failure_reason AS failure_reason \
         FROM application_runs r \
         LEFT JOIN job_posts j ON j.id = r.job_id \
         ORDER BY r.started_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut csv = csv_row(&[
        "Run ID",
        "Job Title",
        "Company",
        "Platform",
        "Mode",
        "Status",
        "Attempt",
        "Started At",
        "Finished At",
        "Failure Reason",
    ]);
    for r in &rows {
        csv.push_str(&csv_row(&[
            &text(r, "id"),
            &text(r, "title"),
            &text(r, "company"),
            &text(r, "platform"),
            &text(r, "mode"),
            &text(r, "status"),
            &text(r, "attempt"),
            &text(r, "started_at"),
            &text(r, "finished_at"),
            &text(r, "failure_reason"),
        ]));
    }
    Ok(csv)
}

/// The full audit log with timestamps and event types, as CSV.
pub async fn export_audit_csv(pool: &SqlitePool) -> DomainResult<String> {
    let rows = sqlx::query(
        "SELECT created_at, entity_type, entity_id, action, severity, message \
         FROM audit_logs ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut csv = csv_row(&[
        "Timestamp",
        "Entity Type",
        "Entity ID",
        "Action",
        "Severity",
        "Message",
    ]);
    for r in &rows {
        csv.push_str(&csv_row(&[
            &text(r, "created_at"),
            &text(r, "entity_type"),
            &text(r, "entity_id"),
            &text(r, "action"),
            &text(r, "severity"),
            &text(r, "message"),
        ]));
    }
    Ok(csv)
}

// ── Backups ─────────────────────────────────────────────────────────────────

/// Metadata for a single on-disk backup snapshot (frontend-serializable).
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: i64,
    pub created_at: String,
}

const BACKUP_PREFIX: &str = "hiremeops-backup-";
const BACKUP_SUFFIX: &str = ".sqlite3";

/// Format a `SystemTime` as an RFC-3339 string (matches `util::now_iso`).
fn system_time_to_iso(t: std::time::SystemTime) -> String {
    time::OffsetDateTime::from(t)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Take a full, consistent database snapshot into `export_dir` using
/// `VACUUM INTO`. Returns metadata for the file just written.
pub async fn create_backup(pool: &SqlitePool, export_dir: &Path) -> DomainResult<BackupInfo> {
    std::fs::create_dir_all(export_dir).map_err(|e| DomainError::Other(e.into()))?;

    // Filesystem-safe, sortable, collision-proof name: sanitized timestamp
    // plus a short uuid fragment (VACUUM INTO refuses to overwrite).
    let stamp = now_iso().replace(':', "-");
    let file_name = format!("{BACKUP_PREFIX}{stamp}-{}{BACKUP_SUFFIX}", &new_id()[..8]);
    let path = export_dir.join(&file_name);

    // VACUUM INTO takes a string-literal filename; single-quote-escape it.
    // Audited safe: `path` is a generated name under `export_dir`, and any
    // quote in it is doubled, so the literal cannot break out of the string.
    let target = path.to_string_lossy().replace('\'', "''");
    sqlx::query(sqlx::AssertSqlSafe(format!("VACUUM INTO '{target}'")))
        .execute(pool)
        .await?;

    let size_bytes = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    Ok(BackupInfo {
        file_name,
        path: path.to_string_lossy().into_owned(),
        size_bytes,
        created_at: now_iso(),
    })
}

/// List existing backup snapshots in `export_dir`, newest first. A missing
/// directory is not an error — it simply means no backups exist yet.
pub fn list_backups(export_dir: &Path) -> DomainResult<Vec<BackupInfo>> {
    let mut backups = Vec::new();
    let rd = match std::fs::read_dir(export_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(backups),
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX)) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let created_at = meta
            .modified()
            .ok()
            .map(system_time_to_iso)
            .unwrap_or_default();
        backups.push(BackupInfo {
            file_name: name,
            path: entry.path().to_string_lossy().into_owned(),
            size_bytes: meta.len() as i64,
            created_at,
        });
    }
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

/// Validate a backup file (integrity + expected schema) then copy it over the
/// live database at `target_db_path`. The app should restart afterwards so the
/// pool re-opens against the restored file. Returns metadata for the restore.
pub async fn restore_backup(backup_path: &Path, target_db_path: &Path) -> DomainResult<BackupInfo> {
    if !backup_path.exists() {
        return Err(DomainError::InvalidInput(format!(
            "backup not found: {}",
            backup_path.display()
        )));
    }

    // Open the candidate read-only and prove it is a healthy DB with our schema
    // before we let it clobber the live database.
    let opts = SqliteConnectOptions::new()
        .filename(backup_path)
        .read_only(true);
    let vpool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&vpool)
        .await
        .unwrap_or_else(|_| "error".to_string());
    if integrity != "ok" {
        vpool.close().await;
        return Err(DomainError::InvalidInput(format!(
            "backup failed integrity check: {integrity}"
        )));
    }
    let has_schema: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'profiles'",
    )
    .fetch_one(&vpool)
    .await
    .unwrap_or(0);
    vpool.close().await;
    if has_schema == 0 {
        return Err(DomainError::InvalidInput(
            "backup is missing the expected schema".to_string(),
        ));
    }

    // Copy via a temp file + rename so a mid-copy failure can't leave the live
    // database truncated.
    let tmp = target_db_path.with_extension("restore-tmp");
    std::fs::copy(backup_path, &tmp).map_err(|e| DomainError::Other(e.into()))?;
    std::fs::rename(&tmp, target_db_path).map_err(|e| DomainError::Other(e.into()))?;

    let size_bytes = std::fs::metadata(target_db_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    Ok(BackupInfo {
        file_name: backup_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: target_db_path.to_string_lossy().into_owned(),
        size_bytes,
        created_at: now_iso(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;

    async fn mem_pool() -> SqlitePool {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn seed_profile(pool: &SqlitePool) -> String {
        let id = new_id();
        sqlx::query(
            "INSERT INTO profiles (id, display_name, target_title, seniority, \
             is_active, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        )
        .bind(&id)
        .bind("Ada, \"the\" Engineer")
        .bind("Staff Rust Engineer")
        .bind("staff")
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
        id
    }

    #[test]
    fn csv_field_escapes_specials() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("she said \"hi\""), "\"she said \"\"hi\"\"\"");
        assert_eq!(csv_field("line1\nline2"), "\"line1\nline2\"");
    }

    #[tokio::test]
    async fn profiles_json_includes_seeded_profile_and_is_valid() {
        let pool = mem_pool().await;
        seed_profile(&pool).await;
        let json = export_profiles_json(&pool).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["profile_count"], 1);
        assert_eq!(parsed["profiles"][0]["display_name"], "Ada, \"the\" Engineer");
        assert!(parsed["profiles"][0]["cv_documents"].is_array());
    }

    #[tokio::test]
    async fn jobs_csv_has_header_even_when_empty() {
        let pool = mem_pool().await;
        let csv = export_jobs_csv(&pool).await.unwrap();
        assert!(csv.starts_with("Title,Company,Location"));
        assert!(csv.ends_with("\r\n"));
    }

    #[tokio::test]
    async fn applications_and_audit_csv_export() {
        let pool = mem_pool().await;
        let apps = export_applications_csv(&pool).await.unwrap();
        assert!(apps.starts_with("Run ID,Job Title,Company"));
        let audit = export_audit_csv(&pool).await.unwrap();
        assert!(audit.starts_with("Timestamp,Entity Type,Entity ID"));
    }

    #[tokio::test]
    async fn backup_create_list_and_restore_roundtrip() {
        // `VACUUM INTO` only writes a snapshot from an on-disk source database;
        // it is a silent no-op against `sqlite::memory:`. Production always runs
        // against a real file, so mirror that here rather than using `mem_pool`.
        let dir = std::env::temp_dir().join(format!("hiremeops-bk-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src_path = dir.join("source.sqlite3");
        let opts = SqliteConnectOptions::new()
            .filename(&src_path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        seed_profile(&pool).await;

        // Create → file exists and is listed.
        let info = create_backup(&pool, &dir).await.unwrap();
        assert!(info.size_bytes > 0);
        assert!(std::path::Path::new(&info.path).exists());
        let listed = list_backups(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, info.file_name);

        // Restore the snapshot onto a fresh target path and re-open it.
        let target = dir.join("restored.sqlite3");
        let backup_path = std::path::PathBuf::from(&info.path);
        restore_backup(&backup_path, &target).await.unwrap();
        let ropts = SqliteConnectOptions::new().filename(&target).read_only(true);
        let rpool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(ropts)
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
            .fetch_one(&rpool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        rpool.close().await;

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn restore_rejects_missing_file() {
        let bogus = std::env::temp_dir().join(format!("nope-{}.sqlite3", new_id()));
        let target = std::env::temp_dir().join(format!("t-{}.sqlite3", new_id()));
        let err = restore_backup(&bogus, &target).await;
        assert!(err.is_err());
    }
}
