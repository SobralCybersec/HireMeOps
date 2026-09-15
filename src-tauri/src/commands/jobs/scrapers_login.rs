use super::*;

#[tauri::command]
pub async fn linkedin_job_login(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        crate::commands::open_login_page(
            &state,
            profile_id,
            "linkedin",
            "https://www.linkedin.com/login",
        )
        .await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn linkedin_job_login_status(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<bool, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        state
            .playwright
            .check_login(&dir)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}
