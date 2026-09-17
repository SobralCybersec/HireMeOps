//! Tauri commands for AI provider management.
//!
//! Key: test_provider — live end-to-end reachability probe, resolves API key exactly as real completion calls do
//! Key: list_models — discovers the models a provider endpoint exposes
//! Key: set_api_key / clear_api_key / has_api_key — OS keyring management, secret never read back to the UI

use serde::Deserialize;
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use crate::ai::{provider_from_settings, resolve_api_key, Provider};
use crate::domain::ai::{AiProvider, CompletionRequest};
use crate::storage::settings::AiProviderSettings;

const TEST_TIMEOUT: Duration = Duration::from_secs(10);

static CANCELLED_CHATS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_chats() -> &'static Mutex<HashSet<String>> {
    CANCELLED_CHATS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Debug, Deserialize)]
pub struct ChatModelMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub run_id: String,
    pub model: Option<String>,
    pub messages: Vec<ChatModelMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatStreamEvent {
    Start {
        message_id: String,
    },
    TextDelta {
        message_id: String,
        delta: String,
    },
    ToolCall {
        tool_call_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_call_id: String,
        output: serde_json::Value,
    },
    Finish {
        message_id: String,
    },
    Abort {
        message_id: String,
    },
}

fn set_chat_cancelled(run_id: String) {
    if let Ok(mut ids) = cancelled_chats().lock() {
        ids.insert(run_id);
    }
}

fn take_chat_cancelled(run_id: &str) -> bool {
    cancelled_chats()
        .lock()
        .map(|mut ids| ids.remove(run_id))
        .unwrap_or(false)
}

fn is_chat_cancelled(run_id: &str) -> bool {
    cancelled_chats()
        .lock()
        .map(|ids| ids.contains(run_id))
        .unwrap_or(false)
}

fn content_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                let object = part.as_object()?;
                if object.get("type").and_then(serde_json::Value::as_str) == Some("text") {
                    object
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn chat_prompt(messages: &[ChatModelMessage]) -> String {
    messages
        .iter()
        .filter_map(|message| {
            let text = content_text(&message.content);
            if text.trim().is_empty() {
                None
            } else {
                Some(format!(
                    "{}: {}",
                    message.role.to_ascii_uppercase(),
                    text.trim()
                ))
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn text_chunks(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunk = String::new();
    let mut chunks = Vec::new();
    for character in text.chars() {
        chunk.push(character);
        if chunk.chars().count() >= max_chars && character.is_whitespace() {
            chunks.push(std::mem::take(&mut chunk));
        }
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    chunks
}

#[tauri::command]
pub async fn chat_cancel(run_id: String) {
    if !run_id.trim().is_empty() {
        set_chat_cancelled(run_id);
    }
}

#[tauri::command]
pub async fn chat_stream(
    state: tauri::State<'_, crate::AppState>,
    request: ChatRequest,
    channel: tauri::ipc::Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let run_id = request.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("chat run id is empty".into());
    }
    if request.messages.is_empty() {
        return Err("chat message history is empty".into());
    }

    take_chat_cancelled(&run_id);
    let result = stream_chat_response(&state, &request, &run_id, &channel).await;
    take_chat_cancelled(&run_id);
    result
}

async fn stream_chat_response(
    state: &crate::AppState,
    request: &ChatRequest,
    run_id: &str,
    channel: &tauri::ipc::Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = chat_prompt(&request.messages);
    if prompt.trim().is_empty() {
        return Err("chat message history has no text".into());
    }
    let (providers, default_index) = crate::storage::settings::load_ai_providers(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    let provider = crate::ai::select_provider_resolved(&providers, default_index).await;
    let model = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(provider.default_model())
        .to_string();
    if model.is_empty() {
        return Err("no AI model configured — choose one in Settings".into());
    }

    let system = Some(
        "You are ENI, the HireMeOps assistant. Answer in the user's language. Be concise, practical, and never invent application state.".to_string(),
    );
    let response = crate::ai::complete_fresh(
        &state.db,
        &provider,
        crate::domain::ai::CompletionRequest {
            model,
            prompt,
            system,
            input_hash: crate::ai::input_hash(&[run_id]),
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    let message_id = crate::util::new_id();
    channel
        .send(ChatStreamEvent::Start {
            message_id: message_id.clone(),
        })
        .map_err(|error| error.to_string())?;

    for delta in text_chunks(&response.text, 48) {
        if is_chat_cancelled(run_id) {
            channel
                .send(ChatStreamEvent::Abort { message_id })
                .map_err(|error| error.to_string())?;
            return Ok(());
        }
        channel
            .send(ChatStreamEvent::TextDelta {
                message_id: message_id.clone(),
                delta,
            })
            .map_err(|error| error.to_string())?;
        tokio::time::sleep(Duration::from_millis(8)).await;
    }

    channel
        .send(ChatStreamEvent::Finish { message_id })
        .map_err(|error| error.to_string())
}

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

#[cfg(test)]
#[path = "../tests/commands_ai_tests.rs"]
mod tests;
