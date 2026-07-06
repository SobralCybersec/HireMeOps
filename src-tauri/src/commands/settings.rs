//! Settings commands. Mirrors the frontend `settingsStore` contract:
//! `get_settings` → `AppSettings`, `update_settings({ settings })`.

use tauri::State;

use crate::storage::settings::AppSettings;
use crate::{storage, AppState};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    storage::settings::load(&state.db, &state.paths)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    storage::settings::save(&state.db, &settings)
        .await
        .map_err(|e| e.to_string())
}
