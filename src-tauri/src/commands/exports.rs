//! Export & backup commands: thin IPC wrappers over `domain::exports` that
//! flatten `DomainError` into a `String` for the frontend.
//! Key: `export_profiles_json` / `export_jobs_csv` / `export_applications_csv` / `export_audit_csv` — data exports.
//! Key: `create_backup` / `list_backups` / `restore_backup` — DB snapshot lifecycle.

use std::path::PathBuf;

use tauri::State;

use crate::domain::exports::{self, BackupInfo};
use crate::AppState;

#[tauri::command]
pub async fn export_profiles_json(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_profiles_json(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_jobs_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_jobs_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_applications_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_applications_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_audit_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_audit_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>) -> Result<BackupInfo, String> {
    exports::create_backup(&state.db, &state.paths.export_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>, String> {
    exports::list_backups(&state.paths.export_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
) -> Result<BackupInfo, String> {
    exports::restore_backup(&PathBuf::from(backup_path), &state.paths.db_path)
        .await
        .map_err(|e| e.to_string())
}
