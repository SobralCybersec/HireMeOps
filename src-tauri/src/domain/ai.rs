//! AI provider abstraction: pluggable LLM backends with a shared completion request/response contract and response cache namespace.
//! Key: AiProvider — trait: id, cache_namespace, complete
//! Key: CompletionRequest / CompletionResponse — request/response DTOs, cached in ai_cache keyed by (model_name, prompt_hash, input_hash)

use serde::{Deserialize, Serialize};

use super::DomainResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub prompt: String,
    pub system: Option<String>,
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    pub cached: bool,
}

#[allow(async_fn_in_trait)]
pub trait AiProvider: Send + Sync {
    fn id(&self) -> &'static str;

    fn cache_namespace(&self) -> String {
        self.id().to_string()
    }

    async fn complete(&self, req: CompletionRequest) -> DomainResult<CompletionResponse>;
}
