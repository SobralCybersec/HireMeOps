//! Tauri commands for the browser-backed "free" AI provider.
//! Key: `browser_provider_login` — visible one-time interactive login for a site.
//! Key: `browser_provider_status` — readiness (initialised/running/logged-in) per known site.
//! Key: `browser_provider_models` — enumerate available models/sessions for a site.

use crate::ai::browser_bridge::{self, BrowserProviderStatus};

#[tauri::command]
pub async fn browser_provider_login(site: String) -> Result<Vec<String>, String> {
    browser_bridge::manual_login(&site)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_provider_status() -> Result<Vec<BrowserProviderStatus>, String> {
    Ok(browser_bridge::status().await)
}

#[tauri::command]
pub async fn browser_provider_models(site: String) -> Result<Vec<String>, String> {
    browser_bridge::list_models(&site)
        .await
        .map_err(|e| e.to_string())
}
