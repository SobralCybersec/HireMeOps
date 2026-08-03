//! Tauri commands for subscription (OAuth) login to AI providers.
//! Key: oauth_begin — step 1, returns the authorize URL (PKCE + state) for the FE to open
//! Key: oauth_complete — step 2 (manual paste), exchanges the pasted redirect/code for tokens
//! Key: oauth_await_callback — step 2 (loopback), waits for the local listener to capture the code
//! Key: oauth_status / oauth_refresh / oauth_logout — status, forced refresh, and disconnect

use crate::auth::oauth::{self, AuthStart, OAuthStatus};

#[tauri::command]
pub async fn oauth_supported(kind: String) -> Result<bool, String> {
    Ok(oauth::supports_oauth(&kind))
}

#[tauri::command]
pub async fn oauth_begin(kind: String) -> Result<AuthStart, String> {
    oauth::begin(&kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oauth_complete(kind: String, redirect: String) -> Result<OAuthStatus, String> {
    oauth::complete(&kind, &redirect)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oauth_await_callback(kind: String) -> Result<OAuthStatus, String> {
    oauth::await_callback(&kind, 300)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oauth_status(kind: String) -> Result<OAuthStatus, String> {
    oauth::status(&kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oauth_refresh(kind: String) -> Result<OAuthStatus, String> {
    oauth::refresh(&kind).await.map_err(|e| e.to_string())?;
    oauth::status(&kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oauth_logout(kind: String) -> Result<(), String> {
    oauth::logout(&kind).map_err(|e| e.to_string())
}
