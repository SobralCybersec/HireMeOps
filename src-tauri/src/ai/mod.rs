//! AI provider backends + the `ai_cache` caching layer.
//!
//! The only concrete completion backend implemented in this build is
//! [`Provider::Browser`]: completions run through a real, logged-in browser
//! session (see [`browser_bridge`]) instead of a paid API. Other recognised
//! settings `kind`s map to [`Provider::Unsupported`] (or [`Provider::Disabled`]
//! when the kind is unrecognised) — see [`provider_from_settings`].
//! [`Provider`] is an enum rather than `dyn AiProvider` because the trait uses
//! `async fn` (not object-safe). Prompt construction and reply parsing are
//! pure in [`prompt`].
//!
//! [`complete_cached`] is the entry point services should call: it consults
//! `ai_cache` keyed on `(model_name, prompt_hash, input_hash)`; the prompt hash
//! includes a non-secret provider/credential namespace so switches stay isolated.

pub mod browser_bridge;
pub mod prompt;

use serde_json::json;
use sqlx::SqlitePool;

use crate::domain::ai::{AiProvider, CompletionRequest, CompletionResponse};
use crate::domain::{DomainError, DomainResult};
use crate::storage::settings::AiProviderSettings;
use crate::util::{new_id, now_iso};

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
    /// A browser-backed "free" provider: completions run through a real,
    /// logged-in browser session (Playwright helper) instead of a paid API.
    /// `site` selects the target service (`chatgpt`, `claude`, …).
    Browser {
        site: String,
        model: String,
    },
    /// A recognised configuration whose completion protocol is not implemented.
    Unsupported {
        reason: String,
    },
    /// No usable provider configured — every call is a clear error.
    Disabled,
}

impl Provider {
    /// The default model name (empty for disabled or unsupported providers).
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
                // Choose the per-request model when present, else the configured
                // default; then flatten (system + prompt) the way RustProxyHub's
                // `build_prompt` does before handing it to the browser session.
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

/// Map a stored provider config to a live [`Provider`]. The API key is resolved
/// separately by the caller (see [`api_key_from_env`]) since [`AiProviderSettings`]
/// only records *whether* a key is stored, never the secret itself.
pub fn provider_from_settings(s: &AiProviderSettings, _api_key: Option<String>) -> Provider {
    let configured_model = s.default_model.trim();
    match s.kind.as_str() {
        // Browser-backed "free" provider: no API key, no wire endpoint. The
        // settings form packs the target site and in-session model into
        // `default_model` as "<site>/<model>" (site e.g. `chatgpt`, `gemini`,
        // `mistral`, `zai`, `meta`, `deepseek`; the model portion is optional).
        // The `"browser"` arm accepts any site string (routing is registry-based
        // in browser_bridge), so new providers need no logic change here. Split on the
        // FIRST '/' so a model name may itself contain slashes. Both CV analysis
        // and automation reach this via `complete_cached`.
        "browser" => {
            let (site, model) = match configured_model.split_once('/') {
                Some((site, model)) => {
                    (site.trim().to_ascii_lowercase(), model.trim().to_string())
                }
                None => (configured_model.to_ascii_lowercase(), String::new()),
            };
            let site = if site.is_empty() {
                "chatgpt".to_string()
            } else {
                site
            };
            Provider::Browser { site, model }
        }
        // "disabled" and an empty/unset kind mean no provider is configured.
        "disabled" | "" => Provider::Disabled,
        // Any other recognised `kind` (ollama, openai, openai_compatible,
        // anthropic_compatible, gemini, custom_proxy, ...) has no completion
        // protocol implemented in this build — fail fast with a clear reason
        // instead of silently behaving as Disabled.
        other => Provider::Unsupported {
            reason: format!(
                "the '{other}' provider is not implemented in this build — \
                 use a browser-backed provider instead"
            ),
        },
    }
}

/// Pick the default provider from a provider list + index. Returns
/// [`Provider::Disabled`] when the list is empty or the index is out of range.
///
/// The synchronous variant only exercises the index-selection logic and is kept
/// for unit tests; production callers use [`select_provider_resolved`], which
/// also resolves the credential (OAuth access token / env API key).
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

/// Resolve the credential for the *selected* provider itself — so OAuth
/// providers get their live keyring access token while API-key providers fall
/// back to the environment. This is the production selection path.
pub async fn select_provider_resolved(
    providers: &[AiProviderSettings],
    default_index: i64,
) -> Provider {
    let idx = usize::try_from(default_index).unwrap_or(0);
    // Fall back to the first provider when the stored index is out of range but
    // a provider IS configured. A stale `default_ai_provider_index` (e.g. left
    // over from an old multi-provider config, now pointing past a single
    // browser entry) would otherwise resolve to `Disabled` and fail with
    // "no AI provider configured" even though the user has a valid provider.
    let selected = providers.get(idx).or_else(|| providers.first());
    match selected {
        Some(s) => provider_from_settings(s, resolve_api_key(s).await),
        None => Provider::Disabled,
    }
}

/// Resolve the AI API key from the environment. Keys are intentionally not kept
/// in the settings DB unencrypted; the secret itself lives in the OS keyring
/// (see [`store_api_key`]) with this env var as a headless/CI fallback.
pub fn api_key_from_env() -> Option<String> {
    std::env::var("HIREMEOPS_AI_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
}

// ───────────────────────────── API-key keyring ──────────────────────────────

/// OS-keyring service under which user-entered AI API keys are stored, one
/// entry per provider `kind`. Kept separate from the OAuth token service
/// (`com.hiremeops.oauth`) so clearing one never disturbs the other.
const API_KEY_SERVICE: &str = "com.hiremeops.apikey";

fn api_key_entry(kind: &str) -> DomainResult<keyring::Entry> {
    keyring::Entry::new(API_KEY_SERVICE, kind)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("keyring open (api_key {kind}): {e}")))
}

/// Persist an API key for `kind` in the OS keyring. An empty/whitespace-only
/// key is rejected — callers should use [`delete_api_key`] to remove one.
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

/// Load the stored API key for `kind`, if any. A missing entry is `Ok(None)`.
pub fn load_api_key(kind: &str) -> DomainResult<Option<String>> {
    match api_key_entry(kind)?.get_password() {
        Ok(secret) => Ok(Some(secret).filter(|s| !s.is_empty())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring read (api_key {kind}): {e}"
        ))),
    }
}

/// Remove the stored API key for `kind`. Deleting a missing entry is a no-op.
pub fn delete_api_key(kind: &str) -> DomainResult<()> {
    match api_key_entry(kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring delete (api_key {kind}): {e}"
        ))),
    }
}

/// Whether a non-empty API key is stored for `kind`. Keyring errors are
/// swallowed to `false` — the UI treats "can't read" the same as "not set".
pub fn has_api_key(kind: &str) -> bool {
    matches!(load_api_key(kind), Ok(Some(_)))
}

/// OAuth provider key for an AI settings `kind`. The `*_compatible` variants
/// share the same subscription connection as their canonical provider.
fn oauth_kind(kind: &str) -> &str {
    match kind {
        "anthropic" | "anthropic_compatible" => "anthropic",
        "openai" | "openai_compatible" => "openai",
        "gemini" => "gemini",
        other => other,
    }
}

/// Resolve the credential for a provider config. OAuth (Claude Pro/Max &
/// friends) providers get a live subscription *access token* from the keyring,
/// refreshed transparently when stale; API-key providers prefer a key saved in
/// the OS keyring via the UI ([`store_api_key`]) and fall back to the
/// `HIREMEOPS_AI_API_KEY` environment variable. `None` ⇒ no usable credential.
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

// ─────────────────────────────── cache layer ────────────────────────────────

/// Run a completion through the `ai_cache` layer. On a cache hit the stored
/// response is returned (`cached: true`) and its `last_used_at` is bumped; on a
/// miss the provider is called and the fresh response is persisted.
pub async fn complete_cached<P: AiProvider>(
    pool: &SqlitePool,
    provider: &P,
    req: CompletionRequest,
) -> DomainResult<CompletionResponse> {
    // Include the concrete backend/endpoint without persisting it in plaintext.
    // This prevents a provider switch from reusing another provider's response.
    let namespace = provider.cache_namespace();
    let content_hash = prompt_hash(req.system.as_deref(), &req.prompt);
    let ph = sha256_hex(&format!("{namespace}\u{1f}{content_hash}"));

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
            // Older builds could cache a 2xx response with no completion text.
            // Drop that poisoned row and retry the provider below.
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

    // Miss — call the backend and persist. Clone the key fields first since
    // `complete` consumes the request.
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

// ─────────────────────────────── HTTP backends ──────────────────────────────

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
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::Barrier;

    /// A provider that returns a canned reply and counts how many times it was
    /// actually invoked (to prove the cache short-circuits the backend).
    struct MockProvider {
        reply: String,
        namespace: String,
        calls: AtomicU32,
    }

    impl MockProvider {
        fn new(reply: &str) -> Self {
            Self {
                reply: reply.into(),
                namespace: "mock".into(),
                calls: AtomicU32::new(0),
            }
        }
        fn with_namespace(reply: &str, namespace: &str) -> Self {
            Self {
                reply: reply.into(),
                namespace: namespace.into(),
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
        fn cache_namespace(&self) -> String {
            self.namespace.clone()
        }
        async fn complete(&self, _req: CompletionRequest) -> DomainResult<CompletionResponse> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(CompletionResponse {
                text: self.reply.clone(),
                cached: false,
            })
        }
    }

    struct RacingProvider {
        barrier: Arc<Barrier>,
        calls: AtomicU32,
    }

    impl AiProvider for RacingProvider {
        fn id(&self) -> &'static str {
            "racing"
        }

        async fn complete(&self, _req: CompletionRequest) -> DomainResult<CompletionResponse> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.barrier.wait().await;
            Ok(CompletionResponse {
                text: "ok".into(),
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
    async fn cache_is_isolated_by_provider_namespace() {
        let pool = mem_pool().await;
        let first = MockProvider::with_namespace("first", "provider-a");
        let second = MockProvider::with_namespace("second", "provider-b");

        let r1 = complete_cached(&pool, &first, req()).await.unwrap();
        let r2 = complete_cached(&pool, &second, req()).await.unwrap();

        assert_eq!(r1.text, "first");
        assert_eq!(r2.text, "second");
        assert_eq!(first.call_count(), 1);
        assert_eq!(second.call_count(), 1);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[tokio::test]
    async fn concurrent_cache_misses_do_not_violate_unique_index() {
        let pool = mem_pool().await;
        let provider = RacingProvider {
            barrier: Arc::new(Barrier::new(2)),
            calls: AtomicU32::new(0),
        };

        let (first, second) = tokio::join!(
            complete_cached(&pool, &provider, req()),
            complete_cached(&pool, &provider, req())
        );

        assert!(first.is_ok());
        assert!(second.is_ok());
        assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[tokio::test]
    async fn blank_provider_response_is_rejected_before_cache_write() {
        let pool = mem_pool().await;
        let provider = MockProvider::new("  \n");

        assert!(complete_cached(&pool, &provider, req()).await.is_err());
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 0);
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
            auth_kind: "api_key".into(),
        };
        // Removed backends are no longer implemented: any previously-supported
        // `kind` other than "browser"/"disabled" now fails fast as Unsupported.
        assert!(matches!(
            provider_from_settings(&mk("ollama", ""), None),
            Provider::Unsupported { .. }
        ));
        assert!(matches!(
            provider_from_settings(&mk("openai_compatible", "https://api.x.com/v1/"), Some("k".into())),
            Provider::Unsupported { .. }
        ));
        assert!(matches!(
            provider_from_settings(&mk("custom_proxy", "https://proxy/v1"), None),
            Provider::Unsupported { .. }
        ));
        assert!(matches!(
            provider_from_settings(&mk("anthropic_compatible", ""), None),
            Provider::Unsupported { .. }
        ));
        assert!(provider_from_settings(&mk("disabled", ""), None).is_disabled());
        assert!(provider_from_settings(&mk("", ""), None).is_disabled());
    }

    #[test]
    fn gemini_oauth_fails_fast_as_unsupported() {
        let settings = AiProviderSettings {
            kind: "gemini".into(),
            label: "Gemini".into(),
            endpoint_url: "https://cloudcode-pa.googleapis.com".into(),
            api_key_stored: false,
            default_model: "gemini-2.5-pro".into(),
            auth_kind: "oauth".into(),
        };
        assert!(matches!(
            provider_from_settings(&settings, Some("token".into())),
            Provider::Unsupported { .. }
        ));
    }

    #[test]
    fn cache_namespace_isolates_browser_sites() {
        // The only variant whose `cache_namespace` varies by input is
        // `Browser` (keyed on `site`, not on any credential — a browser
        // session carries no API key). The credential-namespace test this
        // replaced (`cache_namespace_isolates_credentials_without_exposing_them`)
        // no longer applies: it exercised the `openai`/api_key path, which now
        // resolves to the constant `Provider::Unsupported` namespace.
        let a = Provider::Browser {
            site: "chatgpt".into(),
            model: "gpt".into(),
        };
        let b = Provider::Browser {
            site: "claude".into(),
            model: "gpt".into(),
        };
        assert_ne!(a.cache_namespace(), b.cache_namespace());
        assert_eq!(
            Provider::Unsupported { reason: "x".into() }.cache_namespace(),
            Provider::Unsupported { reason: "y".into() }.cache_namespace(),
        );
    }

    #[test]
    fn successful_response_requires_non_blank_text() {
        assert!(validated_text("test", String::new()).is_err());
        assert!(validated_text("test", "  \n".into()).is_err());
        assert_eq!(validated_text("test", "ok".into()).unwrap(), "ok");
    }

    #[test]
    fn select_provider_handles_empty_and_oob() {
        assert!(select_provider(&[], 0, None).is_disabled());
        // A browser-backed provider is the only live variant that carries a
        // non-empty `default_model` (packed as "<site>/<model>"), so it is what
        // exercises the "valid index resolves to a real provider" path here.
        let one = vec![AiProviderSettings {
            kind: "browser".into(),
            label: "l".into(),
            endpoint_url: "".into(),
            api_key_stored: false,
            default_model: "chatgpt/gpt-4".into(),
            auth_kind: "none".into(),
        }];
        assert_eq!(select_provider(&one, 0, None).default_model(), "gpt-4");
        assert!(select_provider(&one, 5, None).is_disabled());
    }
}
