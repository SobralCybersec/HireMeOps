//! Tauri command surface (the IPC boundary invoked from the frontend).

#[cfg(feature = "real-browser")]
pub(crate) async fn open_login_page(
    state: &crate::AppState,
    profile_id: String,
    platform: &str,
    url: &str,
) -> Result<(), String> {
    use crate::domain::automation::{BrowserDriver, SessionSpec};
    use crate::storage::paths::automation_profile_dir;

    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
        .to_string_lossy()
        .into_owned();
    let handle = state
        .playwright
        .open_login_session(&SessionSpec {
            profile_id,
            platform: platform.into(),
            user_data_dir,
            extensions: vec![],
            headless: false,
        })
        .await
        .map_err(|e| e.to_string())?;
    state
        .playwright
        .navigate(&handle, url)
        .await
        .map_err(|e| e.to_string())
}

pub mod ai;
pub mod applications;
pub mod auth;
pub mod automation;
pub mod browser_provider;
pub mod browser_view;
pub mod cv;
pub mod docker;
pub mod events;
pub mod exports;
pub mod jobs;
pub mod preview;
pub mod profile_variants;
pub mod profiles;
pub mod settings;
pub mod setup;
