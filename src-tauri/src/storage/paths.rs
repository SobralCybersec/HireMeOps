//! Application path resolution.
//!
//! Supports two layouts:
//!  * **Portable** — a `portable.txt` marker next to the executable pins all
//!    state into `./data` beside the binary (USB-stick / no-install use).
//!  * **Installed** — state lives in the OS-standard per-user app-data dir.

use std::path::PathBuf;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct AppPaths {
    /// Root directory holding the DB, evidence, exports and backups.
    pub data_dir: PathBuf,
    /// Absolute path to the SQLite database file.
    pub db_path: PathBuf,
    /// Sub-directory for automation evidence (screenshots, HTML snapshots).
    pub evidence_dir: PathBuf,
    /// Sub-directory for exports and backups.
    pub export_dir: PathBuf,
    /// Whether the app is running in portable mode.
    pub portable: bool,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        let exe_dir = std::env::current_exe()
            .context("resolve current_exe")?
            .parent()
            .map(PathBuf::from);

        let portable = exe_dir
            .as_ref()
            .map(|d| d.join("portable.txt").exists())
            .unwrap_or(false);

        let data_dir = if portable {
            exe_dir
                .context("portable mode requires an executable directory")?
                .join("data")
        } else {
            app.path().app_data_dir().context("resolve app_data_dir")?
        };

        let evidence_dir = data_dir.join("evidence");
        let export_dir = data_dir.join("exports");
        for dir in [&data_dir, &evidence_dir, &export_dir] {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("create dir {}", dir.display()))?;
        }

        let db_path = data_dir.join("hiremeops.sqlite3");
        Ok(Self {
            data_dir,
            db_path,
            evidence_dir,
            export_dir,
            portable,
        })
    }
}
