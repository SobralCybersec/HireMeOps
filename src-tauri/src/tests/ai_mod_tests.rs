use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::Barrier;

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
    assert!(matches!(
        provider_from_settings(&mk("ollama", ""), None),
        Provider::Unsupported { .. }
    ));
    assert!(matches!(
        provider_from_settings(
            &mk("openai_compatible", "https://api.x.com/v1/"),
            Some("k".into())
        ),
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
fn cache_namespace_isolates_browser_sites() {
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
