//! Small shared helpers: timestamps, ID generation, and self memory logging.
//! Key: `now_iso()` — canonical RFC-3339 UTC timestamp used across all tables/events.
//! Key: `new_id()` — fresh v4 UUID for TEXT primary keys.
//! Key: `spawn_self_mem_logger()` — logs this process's RSS/virtual mem when `HIREMEOPS_PERF` is set.

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn spawn_self_mem_logger() {
    let enabled = std::env::var("HIREMEOPS_PERF")
        .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let interval_ms = std::env::var("HIREMEOPS_PERF_INTERVAL_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(15_000)
        .max(1_000);

    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(interval_ms));
        loop {
            tick.tick().await;
            if let Some(u) = memory_stats::memory_stats() {
                tracing::info!(
                    "[perf] rust self memory rssMb={:.1} virtMb={:.1}",
                    u.physical_mem as f64 / 1_048_576.0,
                    u.virtual_mem as f64 / 1_048_576.0,
                );
            }
        }
    });
}
