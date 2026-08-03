//! Tauri commands for AI provider management.
//!
//! Key: test_provider — live end-to-end reachability probe, resolves API key exactly as real completion calls do
//! Key: list_models — discovers the models a provider endpoint exposes
//! Key: set_api_key / clear_api_key / has_api_key — OS keyring management, secret never read back to the UI

use serde::Serialize;
use std::time::Duration;

use crate::ai::{provider_from_settings, resolve_api_key, Provider};
use crate::domain::ai::{AiProvider, CompletionRequest};
use crate::storage::settings::AiProviderSettings;

const TEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderResult {
    pub ok: bool,
    pub message: String,
    pub error_kind: Option<String>,
}

#[tauri::command]
pub async fn test_provider(
    kind: String,
    endpoint_url: String,
    default_model: String,
    auth_kind: Option<String>,
) -> Result<TestProviderResult, String> {
    let settings = AiProviderSettings {
        kind,
        label: String::new(),
        endpoint_url,
        api_key_stored: false,
        default_model,
        auth_kind: auth_kind.unwrap_or_else(|| "api_key".to_string()),
    };
    let api_key = resolve_api_key(&settings).await;
    let provider = provider_from_settings(&settings, api_key);

    let result = match &provider {
        Provider::Disabled => TestProviderResult {
            ok: false,
            message: "Provider kind not recognised — check your settings.".into(),
            error_kind: Some("bad_endpoint".into()),
        },
        Provider::Unsupported { reason } => TestProviderResult {
            ok: false,
            message: reason.clone(),
            error_kind: Some("bad_endpoint".into()),
        },

        Provider::Browser { .. } => {
            if provider.default_model().is_empty() {
                return Ok(TestProviderResult {
                    ok: false,
                    message: "Default model is empty — choose a model first.".into(),
                    error_kind: Some("bad_endpoint".into()),
                });
            }
            let request = CompletionRequest {
                model: provider.default_model().to_string(),
                prompt: "Reply with OK.".into(),
                system: Some("This is a connectivity test. Reply only with OK.".into()),
                input_hash: String::new(),
            };
            match tokio::time::timeout(TEST_TIMEOUT, provider.complete(request)).await {
                Err(_) => TestProviderResult {
                    ok: false,
                    message: "Request timed out — is the browser session logged in?".into(),
                    error_kind: Some("timeout".into()),
                },
                Ok(Ok(_)) => TestProviderResult {
                    ok: true,
                    message: "Completion succeeded ✓".into(),
                    error_kind: None,
                },
                Ok(Err(error)) => {
                    let message = error.to_string();
                    let lower = message.to_ascii_lowercase();
                    let error_kind = if lower.contains("login") || lower.contains("logged in") {
                        "auth"
                    } else if lower.contains("timed out") {
                        "network"
                    } else {
                        "bad_endpoint"
                    };
                    TestProviderResult {
                        ok: false,
                        message,
                        error_kind: Some(error_kind.into()),
                    }
                }
            }
        }
    };

    Ok(result)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsResult {
    pub ok: bool,
    pub models: Vec<String>,
    pub message: String,
    pub error_kind: Option<String>,
}

#[tauri::command]
pub async fn list_models(
    kind: String,
    endpoint_url: String,
    auth_kind: Option<String>,
) -> Result<ListModelsResult, String> {
    let settings = AiProviderSettings {
        kind,
        label: String::new(),
        endpoint_url,
        api_key_stored: false,
        default_model: String::new(),
        auth_kind: auth_kind.unwrap_or_else(|| "api_key".to_string()),
    };
    let api_key = resolve_api_key(&settings).await;
    let provider = provider_from_settings(&settings, api_key);

    let result = match &provider {
        Provider::Disabled => ListModelsResult {
            ok: false,
            models: Vec::new(),
            message: "Provider kind not recognised — check your settings.".into(),
            error_kind: Some("bad_endpoint".into()),
        },
        Provider::Unsupported { reason } => ListModelsResult {
            ok: false,
            models: Vec::new(),
            message: reason.clone(),
            error_kind: Some("bad_endpoint".into()),
        },

        Provider::Browser { model, .. } => {
            let models = if model.trim().is_empty() {
                Vec::new()
            } else {
                vec![model.clone()]
            };
            ListModelsResult {
                ok: true,
                models,
                message: "Browser provider has no model list — type the in-session model.".into(),
                error_kind: None,
            }
        }
    };

    Ok(result)
}

#[tauri::command]
pub fn set_api_key(kind: String, key: String) -> Result<(), String> {
    crate::ai::store_api_key(&kind, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_api_key(kind: String) -> Result<(), String> {
    crate::ai::delete_api_key(&kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_api_key(kind: String) -> bool {
    crate::ai::has_api_key(&kind)
}
