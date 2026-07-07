//! AI provider backends + the `ai_cache` caching layer.
//!
//! Concrete providers (Ollama local, OpenAI-compatible, Anthropic) live in the
//! [`Provider`] enum — an enum rather than `dyn AiProvider` because the trait
//! uses `async fn` (not object-safe). Network calls happen here; prompt
//! construction and reply parsing are pure in [`prompt`].
//!
//! [`complete_cached`] is the entry point services should call: it consults
//! `ai_cache` keyed on `(model_name, prompt_hash, input_hash)` and only hits the
//! network on a miss, so identical prompts are free and deterministic.

pub mod prompt;

use std::time::Duration;

use serde_json::json;
use sqlx::SqlitePool;

use crate::domain::ai::{AiProvider, CompletionRequest, CompletionResponse};
use crate::domain::{DomainError, DomainResult};
use crate::storage::settings::AiProviderSettings;
use crate::util::{new_id, now_iso};

/// How long to wait on a single completion before giving up. Local models on a
/// cold start and large prompts can be slow, so this is generous.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// sha256 hex digest of a string.
fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Deterministic hash of the (system, prompt) pair used as a cache key. The
/// `\u{1f}` unit separator keeps the two fields unambiguous.
pub fn prompt_hash(system: Option<&str>, prompt: &str) -> String {
    sha256_hex(&format!("{}\u{1f}{}", system.unwrap_or(""), prompt))
}

/// Build a cache `input_hash` from arbitrary semantic parts + a prompt version,
/// so bumping a prompt version invalidates its cached rows.
pub fn input_hash(parts: &[&str]) -> String {
    sha256_hex(&parts.join("\u{1f}"))
}

// ─────────────────────────────── providers ──────────────────────────────────

/// A configured LLM backend. The `model` is the default for that backend; the
/// per-request model in [`CompletionRequest`] is authoritative for the call.
#[derive(Debug, Clone)]
pub enum Provider {
    Ollama {
        base_url: String,
        model: String,
    },
    OpenAiCompatible {
        base_url: String,
        api_key: Option<String>,
        model: String,
    },
    Anthropic {
        base_url: String,
        api_key: Option<String>,
        model: String,
    },
    /// No usable provider configured — every call is a clear error.
    Disabled,
}

impl Provider {
    /// The default model name for this backend (empty for [`Provider::Disabled`]).
    pub fn default_model(&self) -> &str {
        match self {
            Provider::Ollama { model, .. }
            | Provider::OpenAiCompatible { model, .. }
            | Provider::Anthropic { model, .. } => model,
            Provider::Disabled => "",
        }
    }

    pub fn is_disabled(&self) -> bool {
        matches!(self, Provider::Disabled)
    }
}

impl AiProvider for Provider {
    fn id(&self) -> &'static str {
        match self {
            Provider::Ollama { .. } => "ollama",
            Provider::OpenAiCompatible { .. } => "openai_compatible",
            Provider::Anthropic { .. } => "anthropic_compatible",
            Provider::Disabled => "disabled",
        }
    }

    async fn complete(&self, req: CompletionRequest) -> DomainResult<CompletionResponse> {
        match self {
            Provider::Disabled => Err(DomainError::InvalidInput(
                "no AI provider configured — add one in Settings".into(),
            )),
            Provider::Ollama { base_url, .. } => ollama_complete(base_url, &req).await,
            Provider::OpenAiCompatible {
                base_url, api_key, ..
            } => openai_complete(base_url, api_key.as_deref(), &req).await,
            Provider::Anthropic {
                base_url, api_key, ..
            } => anthropic_complete(base_url, api_key.as_deref(), &req).await,
        }
    }
}

/// Map a stored provider config to a live [`Provider`]. The API key is resolved
/// separately by the caller (see [`api_key_from_env`]) since [`AiProviderSettings`]
/// only records *whether* a key is stored, never the secret itself.
pub fn provider_from_settings(s: &AiProviderSettings, api_key: Option<String>) -> Provider {
    let base = s.endpoint_url.trim().trim_end_matches('/').to_string();
    let model = s.default_model.trim().to_string();
    match s.kind.as_str() {
        "ollama" => Provider::Ollama {
            base_url: if base.is_empty() {
                "http://localhost:11434".into()
            } else {
                base
            },
            model,
        },
        "openai_compatible" | "custom_proxy" => Provider::OpenAiCompatible {
            base_url: base,
            api_key,
            model,
        },
        "anthropic_compatible" => Provider::Anthropic {
            base_url: if base.is_empty() {
                "https://api.anthropic.com".into()
            } else {
                base
            },
            api_key,
            model,
        },
        _ => Provider::Disabled,
    }
}

/// Pick the default provider from a provider list + index. Returns
/// [`Provider::Disabled`] when the list is empty or the index is out of range.
pub fn select_provider(
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

/// Resolve the AI API key from the environment. Keys are intentionally not kept
/// in the settings DB unencrypted; encrypted at-rest storage lands with the
/// security crates in a later phase.
pub fn api_key_from_env() -> Option<String> {
    std::env::var("HIREMEOPS_AI_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
}

// ─────────────────────────────── cache layer ────────────────────────────────

/// Run a completion through the `ai_cache` layer. On a cache hit the stored
/// response is returned (`cached: true`) and its `last_used_at` is bumped; on a
/// miss the provider is called and the fresh response is persisted.
pub async fn complete_cached<P: AiProvider>(
    pool: &SqlitePool,
    provider: &P,
    req: CompletionRequest,
) -> DomainResult<CompletionResponse> {
    let ph = prompt_hash(req.system.as_deref(), &req.prompt);

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

    // Miss — call the backend and persist. Clone the key fields first since
    // `complete` consumes the request.
    let model = req.model.clone();
    let input = req.input_hash.clone();
    let provider_id = provider.id();
    let resp = provider.complete(req).await?;

    let now = now_iso();
    sqlx::query(
        "INSERT INTO ai_cache \
         (id, provider_id, model_name, prompt_hash, input_hash, response_text, metadata_json, created_at, last_used_at) \
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
    )
    .bind(new_id())
    .bind(&model)
    .bind(&ph)
    .bind(&input)
    .bind(&resp.text)
    .bind(json!({ "provider": provider_id }).to_string())
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(CompletionResponse {
        text: resp.text,
        cached: false,
    })
}

// ─────────────────────────────── HTTP backends ──────────────────────────────

fn http_client() -> DomainResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| DomainError::Other(anyhow::anyhow!("build http client: {e}")))
}

fn net_err(e: reqwest::Error) -> DomainError {
    DomainError::Other(anyhow::anyhow!("ai request failed: {e}"))
}

/// Ollama native API: `POST {base}/api/generate`, non-streaming.
async fn ollama_complete(base: &str, req: &CompletionRequest) -> DomainResult<CompletionResponse> {
    let url = format!("{base}/api/generate");
    let mut body = json!({ "model": req.model, "prompt": req.prompt, "stream": false });
    if let Some(sys) = &req.system {
        body["system"] = json!(sys);
    }
    let resp = http_client()?
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(net_err)?;
    let v = decode_json(resp).await?;
    let text = v
        .get("response")
        .and_then(|r| r.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(CompletionResponse {
        text,
        cached: false,
    })
}

/// OpenAI-compatible chat completions. Appends the versioned path unless the
/// base already ends in `/v1`.
async fn openai_complete(
    base: &str,
    api_key: Option<&str>,
    req: &CompletionRequest,
) -> DomainResult<CompletionResponse> {
    let url = if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    };
    let mut messages = Vec::new();
    if let Some(sys) = &req.system {
        messages.push(json!({ "role": "system", "content": sys }));
    }
    messages.push(json!({ "role": "user", "content": req.prompt }));
    let body = json!({ "model": req.model, "messages": messages });

    let mut rb = http_client()?.post(url).json(&body);
    if let Some(key) = api_key {
        rb = rb.bearer_auth(key);
    }
    let resp = rb.send().await.map_err(net_err)?;
    let v = decode_json(resp).await?;
    let text = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(CompletionResponse {
        text,
        cached: false,
    })
}

/// Anthropic Messages API: `POST {base}/v1/messages`.
async fn anthropic_complete(
    base: &str,
    api_key: Option<&str>,
    req: &CompletionRequest,
) -> DomainResult<CompletionResponse> {
    let url = format!("{base}/v1/messages");
    let mut body = json!({
        "model": req.model,
        "max_tokens": 2048,
        "messages": [{ "role": "user", "content": req.prompt }],
    });
    if let Some(sys) = &req.system {
        body["system"] = json!(sys);
    }
    let mut rb = http_client()?
        .post(url)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    if let Some(key) = api_key {
        rb = rb.header("x-api-key", key);
    }
    let resp = rb.send().await.map_err(net_err)?;
    let v = decode_json(resp).await?;
    let text = v
        .pointer("/content/0/text")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(CompletionResponse {
        text,
        cached: false,
    })
}

/// Read a response body, surfacing non-2xx statuses (with the body for context)
/// as errors before attempting to parse JSON.
async fn decode_json(resp: reqwest::Response) -> DomainResult<serde_json::Value> {
    let status = resp.status();
    let body = resp.text().await.map_err(net_err)?;
    if !status.is_success() {
        return Err(DomainError::Other(anyhow::anyhow!(
            "ai provider returned {status}: {body}"
        )));
    }
    serde_json::from_str(&body)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("parse ai response: {e}; body: {body}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A provider that returns a canned reply and counts how many times it was
    /// actually invoked (to prove the cache short-circuits the backend).
    struct MockProvider {
        reply: String,
        calls: AtomicU32,
    }

    impl MockProvider {
        fn new(reply: &str) -> Self {
            Self {
                reply: reply.into(),
                calls: AtomicU32::new(0),
            }
        }
        fn call_count(&self) -> u32 {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl AiProvider for MockProvider {
        fn id(&self) -> &'static str {
            "mock"
        }
        async fn complete(&self, _req: CompletionRequest) -> DomainResult<CompletionResponse> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(CompletionResponse {
                text: self.reply.clone(),
                cached: false,
            })
        }
    }

    async fn mem_pool() -> SqlitePool {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn req() -> CompletionRequest {
        CompletionRequest {
            model: "test-model".into(),
            prompt: "hello".into(),
            system: Some("be nice".into()),
            input_hash: input_hash(&["seed", "v1"]),
        }
    }

    #[tokio::test]
    async fn miss_then_hit_calls_backend_once() {
        let pool = mem_pool().await;
        let p = MockProvider::new("world");

        let r1 = complete_cached(&pool, &p, req()).await.unwrap();
        assert_eq!(r1.text, "world");
        assert!(!r1.cached, "first call is a miss");

        let r2 = complete_cached(&pool, &p, req()).await.unwrap();
        assert_eq!(r2.text, "world");
        assert!(r2.cached, "second identical call is a hit");

        assert_eq!(p.call_count(), 1, "backend invoked exactly once");
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1, "exactly one cache row persisted");
    }

    #[tokio::test]
    async fn different_input_hash_is_a_separate_entry() {
        let pool = mem_pool().await;
        let p = MockProvider::new("x");
        complete_cached(&pool, &p, req()).await.unwrap();
        let mut r2 = req();
        r2.input_hash = input_hash(&["seed", "v2"]);
        complete_cached(&pool, &p, r2).await.unwrap();
        assert_eq!(p.call_count(), 2);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[tokio::test]
    async fn hit_bumps_last_used_at() {
        let pool = mem_pool().await;
        let p = MockProvider::new("x");
        complete_cached(&pool, &p, req()).await.unwrap();
        let (created, used0): (String, String) =
            sqlx::query_as("SELECT created_at, last_used_at FROM ai_cache")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created, used0, "fresh row: created == last_used");
        // Force a later timestamp then hit again.
        sqlx::query("UPDATE ai_cache SET last_used_at = '2000-01-01T00:00:00Z'")
            .execute(&pool)
            .await
            .unwrap();
        complete_cached(&pool, &p, req()).await.unwrap();
        let used1: String = sqlx::query_scalar("SELECT last_used_at FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_ne!(used1, "2000-01-01T00:00:00Z", "hit refreshed last_used_at");
    }

    #[test]
    fn factory_maps_kinds_and_defaults_base_urls() {
        let mk = |kind: &str, url: &str| AiProviderSettings {
            kind: kind.into(),
            label: "l".into(),
            endpoint_url: url.into(),
            api_key_stored: false,
            default_model: "m".into(),
        };
        assert!(matches!(
            provider_from_settings(&mk("ollama", ""), None),
            Provider::Ollama { base_url, .. } if base_url == "http://localhost:11434"
        ));
        assert!(matches!(
            provider_from_settings(&mk("openai_compatible", "https://api.x.com/v1/"), Some("k".into())),
            Provider::OpenAiCompatible { base_url, api_key: Some(_), .. } if base_url == "https://api.x.com/v1"
        ));
        assert!(matches!(
            provider_from_settings(&mk("custom_proxy", "https://proxy/v1"), None),
            Provider::OpenAiCompatible { .. }
        ));
        assert!(matches!(
            provider_from_settings(&mk("anthropic_compatible", ""), None),
            Provider::Anthropic { base_url, .. } if base_url == "https://api.anthropic.com"
        ));
        assert!(provider_from_settings(&mk("disabled", ""), None).is_disabled());
    }

    #[test]
    fn select_provider_handles_empty_and_oob() {
        assert!(select_provider(&[], 0, None).is_disabled());
        let one = vec![AiProviderSettings {
            kind: "ollama".into(),
            label: "l".into(),
            endpoint_url: "".into(),
            api_key_stored: false,
            default_model: "llama3".into(),
        }];
        assert_eq!(select_provider(&one, 0, None).default_model(), "llama3");
        assert!(select_provider(&one, 5, None).is_disabled());
    }
}
