//! Application path resolution: portable (`./data` beside the executable) vs
//! installed (OS-standard per-user app-data dir) layouts.
//! Key: `AppPaths` — resolved data/db/evidence/export/cv_files dirs + portable flag.
//! Key: `AppPaths::resolve()` — detects portable mode, creates all sub-dirs.
//! Key: `automation_profile_dir()` — canonical per-profile browser-profile dir shared by all automation flows.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub evidence_dir: PathBuf,
    pub export_dir: PathBuf,
    pub cv_files_dir: PathBuf,
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
        let cv_files_dir = data_dir.join("cv_files");
        for dir in [&data_dir, &evidence_dir, &export_dir, &cv_files_dir] {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("create dir {}", dir.display()))?;
        }

        let db_path = data_dir.join("hiremeops.sqlite3");
        Ok(Self {
            data_dir,
            db_path,
            evidence_dir,
            export_dir,
            cv_files_dir,
            portable,
        })
    }
}

#[cfg_attr(not(feature = "real-browser"), allow(dead_code))]
pub fn automation_profile_dir(data_dir: &Path, profile_id: &str) -> PathBuf {
    data_dir.join("profiles").join(profile_id).join("browser")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automation_profile_dir_same_inputs_same_output() {
        let root = PathBuf::from("/data");
        let a = automation_profile_dir(&root, "profile-1");
        let b = automation_profile_dir(&root, "profile-1");
        let c = automation_profile_dir(&root, "profile-2");
        assert_eq!(a, b, "same inputs must produce identical paths");
        assert_ne!(a, c, "different profile_ids must produce different paths");
        assert_eq!(a, PathBuf::from("/data/profiles/profile-1/browser"));
    }
}
