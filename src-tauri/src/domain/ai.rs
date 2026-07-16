//! AI provider abstraction (Phase 2+).
//!
//! Concrete providers (Ollama local, Anthropic, OpenAI-compatible) implement
//! [`AiProvider`]. Responses are cached in `ai_cache` keyed by
//! `(model_name, prompt_hash, input_hash)`; the concrete provider namespace is
//! folded into `prompt_hash` so identical requests cannot cross providers.

use serde::{Deserialize, Serialize};

use super::DomainResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub prompt: String,
    pub system: Option<String>,
    /// Deterministic hash of the semantic input, used as a cache key.
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    pub cached: bool,
}

/// A pluggable large-language-model backend.
#[allow(async_fn_in_trait)]
pub trait AiProvider: Send + Sync {
    /// Human-readable provider id (e.g. `"ollama"`, `"anthropic"`).
    fn id(&self) -> &'static str;

    /// Stable, non-secret namespace used to isolate cached responses.
    /// Implementations that can target multiple endpoints should override this.
    fn cache_namespace(&self) -> String {
        self.id().to_string()
    }

    /// Run a completion, honouring the `ai_cache` layer.
    async fn complete(&self, req: CompletionRequest) -> DomainResult<CompletionResponse>;
}
