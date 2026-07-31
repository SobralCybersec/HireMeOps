//! Profile commands. `list_profiles` feeds the frontend `profileStore`.
//!
//! Key: create_profile — new profile is a fully independent operator identity (own browser jar, CVs, variants, jobs, settings)
//! Key: get_profile_facts / save_profile_facts — identity facts (salary, work auth, phone, links) as a flat key-value map, feeds Easy Apply

use std::collections::HashMap;

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

#[tauri::command]
pub async fn create_profile(state: State<'_, AppState>, name: String) -> Result<ProfileDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Profile name is required".to_string());
    }
    let id = crate::util::new_id();
    let now = crate::util::now_iso();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES (?1, ?2, ?3, ?3, 0)",
    )
    .bind(&id)
    .bind(name)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ProfileDto {
        id,
        name: name.to_string(),
        is_active: false,
    })
}

#[tauri::command]
pub async fn rename_profile(
    state: State<'_, AppState>,
    profile_id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Profile name is required".to_string());
    }
    let now = crate::util::now_iso();
    let res = sqlx::query("UPDATE profiles SET display_name = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(name)
        .bind(&now)
        .bind(&profile_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if res.rows_affected() == 0 {
        return Err("Profile not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_profile_facts(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<HashMap<String, String>, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT fact_key, fact_value FROM profile_facts WHERE profile_id = ?1")
            .bind(&profile_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

#[tauri::command]
pub async fn save_profile_facts(
    state: State<'_, AppState>,
    profile_id: String,
    facts: HashMap<String, String>,
) -> Result<(), String> {
    let now = crate::util::now_iso();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;
    for (key, value) in facts {
        let value = value.trim();
        if value.is_empty() {
            sqlx::query("DELETE FROM profile_facts WHERE profile_id = ?1 AND fact_key = ?2")
                .bind(&profile_id)
                .bind(&key)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            continue;
        }
        sqlx::query(
            "INSERT INTO profile_facts (id, profile_id, fact_key, fact_value, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'user', ?5)
             ON CONFLICT(profile_id, fact_key)
             DO UPDATE SET fact_value = excluded.fact_value, source = 'user', updated_at = excluded.updated_at",
        )
        .bind(crate::util::new_id())
        .bind(&profile_id)
        .bind(&key)
        .bind(value)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
