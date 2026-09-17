//! AI provider backends + the ai_cache caching layer.
//!
//! Key: Provider — enum dispatching to the Browser/Unsupported/Disabled backends
//! Key: complete_cached / complete_fresh — cached and provider-fresh completion entry points
//! Key: provider_from_settings — maps a stored AiProviderSettings to a live Provider
//! Key: select_provider_resolved — resolves credentials and picks the default provider
//! Key: resolve_api_key — resolves an OAuth access token or a keyring/env API key

pub mod browser_bridge;
pub mod prompt;

use serde_json::json;
use sqlx::SqlitePool;

use crate::domain::ai::{AiProvider, CompletionRequest, CompletionResponse};
use crate::domain::{DomainError, DomainResult};
use crate::storage::settings::AiProviderSettings;
use crate::util::{new_id, now_iso};

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn prompt_hash(system: Option<&str>, prompt: &str) -> String {
    sha256_hex(&format!("{}\u{1f}{}", system.unwrap_or(""), prompt))
}

pub fn input_hash(parts: &[&str]) -> String {
    sha256_hex(&parts.join("\u{1f}"))
}

#[derive(Debug, Clone)]
pub enum Provider {
    Browser { site: String, model: String },
    Unsupported { reason: String },
    Disabled,
}

impl Provider {
    pub fn default_model(&self) -> &str {
        match self {
            Provider::Browser { model, .. } => model,
            Provider::Unsupported { .. } | Provider::Disabled => "",
        }
    }

    pub fn is_disabled(&self) -> bool {
        matches!(self, Provider::Disabled)
    }
}

impl AiProvider for Provider {
    fn id(&self) -> &'static str {
        match self {
            Provider::Browser { .. } => "browser",
            Provider::Unsupported { .. } => "unsupported",
            Provider::Disabled => "disabled",
        }
    }

    fn cache_namespace(&self) -> String {
        match self {
            Provider::Browser { site, .. } => format!("browser:{site}"),
            Provider::Unsupported { .. } => "unsupported".into(),
            Provider::Disabled => "disabled".into(),
        }
    }

    async fn complete(&self, req: CompletionRequest) -> DomainResult<CompletionResponse> {
        match self {
            Provider::Disabled => Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            )),
            Provider::Unsupported { reason } => Err(DomainError::InvalidInput(reason.clone())),
            Provider::Browser { site, model } => {
                let model = if req.model.trim().is_empty() {
                    model.clone()
                } else {
                    req.model.clone()
                };
                let mut prompt = String::new();
                if let Some(system) = req.system.as_deref() {
                    if !system.trim().is_empty() {
                        prompt.push_str(system);
                        prompt.push_str("\n\n");
                    }
                }
                prompt.push_str(&req.prompt);
                let text = browser_bridge::chat(site, &model, prompt, false)
                    .await
                    .map_err(DomainError::Other)?;
                Ok(CompletionResponse {
                    text,
                    cached: false,
                })
            }
        }
    }
}

pub fn provider_from_settings(s: &AiProviderSettings, _api_key: Option<String>) -> Provider {
    let configured_model = s.default_model.trim();
    match s.kind.as_str() {
        "browser" => {
            let (site, model) = match configured_model.split_once('/') {
                Some((site, model)) => (site.trim().to_ascii_lowercase(), model.trim().to_string()),
                None => (configured_model.to_ascii_lowercase(), String::new()),
            };
            let site = if site.is_empty() {
                "chatgpt".to_string()
            } else {
                site
            };
            Provider::Browser { site, model }
        }
        "disabled" | "" => Provider::Disabled,
        other => Provider::Unsupported {
            reason: format!(
                "the '{other}' provider is not implemented in this build — \
                 use a browser-backed provider instead"
            ),
        },
    }
}

#[cfg(test)]
fn select_provider(
    providers: &[AiProviderSettings],
    default_index: i64,
    api_key: Option<String>,
) -> Provider {
    let idx = usize::try_from(default_index).unwrap_or(0);
    match providers.get(idx) {
        Some(s) => provider_from_settings(s, api_key),
        None => Provider::Disabled,
    }
}

pub async fn select_provider_resolved(
    providers: &[AiProviderSettings],
    default_index: i64,
) -> Provider {
    let idx = usize::try_from(default_index).unwrap_or(0);
    let selected = providers.get(idx).or_else(|| providers.first());
    match selected {
        Some(s) => provider_from_settings(s, resolve_api_key(s).await),
        None => Provider::Disabled,
    }
}

pub fn api_key_from_env() -> Option<String> {
    std::env::var("HIREMEOPS_AI_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
}

const API_KEY_SERVICE: &str = "com.hiremeops.apikey";

fn api_key_entry(kind: &str) -> DomainResult<keyring::Entry> {
    keyring::Entry::new(API_KEY_SERVICE, kind)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("keyring open (api_key {kind}): {e}")))
}

pub fn store_api_key(kind: &str, key: &str) -> DomainResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(DomainError::InvalidInput(
            "API key is empty — enter a key or clear the stored one".into(),
        ));
    }
    api_key_entry(kind)?
        .set_password(key)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("keyring store (api_key {kind}): {e}")))
}

pub fn load_api_key(kind: &str) -> DomainResult<Option<String>> {
    match api_key_entry(kind)?.get_password() {
        Ok(secret) => Ok(Some(secret).filter(|s| !s.is_empty())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring read (api_key {kind}): {e}"
        ))),
    }
}

pub fn delete_api_key(kind: &str) -> DomainResult<()> {
    match api_key_entry(kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring delete (api_key {kind}): {e}"
        ))),
    }
}

pub fn has_api_key(kind: &str) -> bool {
    matches!(load_api_key(kind), Ok(Some(_)))
}

fn oauth_kind(kind: &str) -> &str {
    match kind {
        "anthropic" | "anthropic_compatible" => "anthropic",
        "openai" | "openai_compatible" => "openai",
        other => other,
    }
}

pub async fn resolve_api_key(s: &AiProviderSettings) -> Option<String> {
    if s.auth_kind == "oauth" {
        crate::auth::oauth::valid_access_token(oauth_kind(&s.kind))
            .await
            .ok()
            .flatten()
    } else {
        load_api_key(&s.kind)
            .ok()
            .flatten()
            .or_else(api_key_from_env)
    }
}

pub async fn complete_cached<P: AiProvider>(
    pool: &SqlitePool,
    provider: &P,
    req: CompletionRequest,
) -> DomainResult<CompletionResponse> {
    complete_with_cache(pool, provider, req, true).await
}

/// Run a provider completion without reading an existing cached response.
/// The fresh response still updates the matching cache entry for later reads.
pub async fn complete_fresh<P: AiProvider>(
    pool: &SqlitePool,
    provider: &P,
    req: CompletionRequest,
) -> DomainResult<CompletionResponse> {
    complete_with_cache(pool, provider, req, false).await
}

async fn complete_with_cache<P: AiProvider>(
    pool: &SqlitePool,
    provider: &P,
    req: CompletionRequest,
    read_cache: bool,
) -> DomainResult<CompletionResponse> {
    let namespace = provider.cache_namespace();
    let content_hash = prompt_hash(req.system.as_deref(), &req.prompt);
    let ph = sha256_hex(&format!("{namespace}\u{1f}{content_hash}"));

    if read_cache {
        if let Some(text) = sqlx::query_scalar::<_, String>(
            "SELECT response_text FROM ai_cache \
             WHERE model_name = ?1 AND prompt_hash = ?2 AND input_hash = ?3",
        )
        .bind(&req.model)
        .bind(&ph)
        .bind(&req.input_hash)
        .fetch_optional(pool)
        .await?
        {
            if text.trim().is_empty() {
                sqlx::query(
                    "DELETE FROM ai_cache \
                     WHERE model_name = ?1 AND prompt_hash = ?2 AND input_hash = ?3",
                )
                .bind(&req.model)
                .bind(&ph)
                .bind(&req.input_hash)
                .execute(pool)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE ai_cache SET last_used_at = ?1 \
                     WHERE model_name = ?2 AND prompt_hash = ?3 AND input_hash = ?4",
                )
                .bind(now_iso())
                .bind(&req.model)
                .bind(&ph)
                .bind(&req.input_hash)
                .execute(pool)
                .await?;
                return Ok(CompletionResponse { text, cached: true });
            }
        }
    }

    let model = req.model.clone();
    let input = req.input_hash.clone();
    let provider_id = provider.id();
    let resp = provider.complete(req).await?;
    let text = validated_text(provider_id, resp.text)?;

    let now = now_iso();
    sqlx::query(
        "INSERT INTO ai_cache \
         (id, provider_id, model_name, prompt_hash, input_hash, response_text, metadata_json, created_at, last_used_at) \
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?7) \
         ON CONFLICT(model_name, prompt_hash, input_hash) DO UPDATE SET \
           response_text = excluded.response_text, \
           metadata_json = excluded.metadata_json, \
           last_used_at = excluded.last_used_at",
    )
    .bind(new_id())
    .bind(&model)
    .bind(&ph)
    .bind(&input)
    .bind(&text)
    .bind(json!({ "provider": provider_id }).to_string())
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(CompletionResponse {
        text,
        cached: false,
    })
}

fn validated_text(provider: &str, text: String) -> DomainResult<String> {
    if text.trim().is_empty() {
        Err(DomainError::Other(anyhow::anyhow!(
            "{provider} returned a successful response without completion text"
        )))
    } else {
        Ok(text)
    }
}

#[cfg(test)]
#[path = "../tests/ai_mod_tests.rs"]
mod tests;
