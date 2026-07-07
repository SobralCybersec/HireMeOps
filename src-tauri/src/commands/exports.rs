//! Export & backup commands: thin IPC wrappers over `domain::exports` that
//! flatten `DomainError` into a `String` for the frontend. Export commands
//! return the rendered file body (the frontend saves it via a dialog); backup
//! commands operate on files under the app's `export_dir`.

use std::path::PathBuf;

use tauri::State;

use crate::domain::exports::{self, BackupInfo};
use crate::AppState;

/// All profile configs + CV references as pretty JSON.
#[tauri::command]
pub async fn export_profiles_json(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_profiles_json(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Job listings with best match score, as CSV.
#[tauri::command]
pub async fn export_jobs_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_jobs_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Application run history (outcomes + retries), as CSV.
#[tauri::command]
pub async fn export_applications_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_applications_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Full audit log, as CSV.
#[tauri::command]
pub async fn export_audit_csv(state: State<'_, AppState>) -> Result<String, String> {
    exports::export_audit_csv(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Take a consistent DB snapshot into the app's backup directory.
#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>) -> Result<BackupInfo, String> {
    exports::create_backup(&state.db, &state.paths.export_dir)
        .await
        .map_err(|e| e.to_string())
}

/// List existing backup snapshots, newest first.
#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>, String> {
    exports::list_backups(&state.paths.export_dir).map_err(|e| e.to_string())
}

/// Validate and restore a backup file over the live database. The frontend
/// should prompt the user to restart the app afterwards.
#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
) -> Result<BackupInfo, String> {
    exports::restore_backup(&PathBuf::from(backup_path), &state.paths.db_path)
        .await
        .map_err(|e| e.to_string())
}
