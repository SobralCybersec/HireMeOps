//! Profile commands. `list_profiles` feeds the frontend `profileStore`.

use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub is_active: bool,
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileDto>, String> {
    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT id, display_name, is_active FROM profiles ORDER BY display_name")
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, name, active)| ProfileDto {
            id,
            name,
            is_active: active != 0,
        })
        .collect())
}
