//! `app_settings` key/value repository + the typed `AppSettings` DTO that the
//! frontend `settingsStore` consumes.
//! Key: `AppSettings` — mirrors the TS `AppSettings` interface (camelCase on the wire).
//! Key: `load()` / `save()` — assemble/persist the typed struct from the key/value table.
//! Key: `read_automation_headless_for()` — per-task headless override resolution.
//! Key: `DEFAULTS` — baseline settings seeded via `ensure_defaults()`.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::paths::AppPaths;
use crate::util::now_iso;

const DEFAULTS: &[(&str, &str)] = &[
    ("theme", "system"),
    ("reduced_effects", "auto"),
    ("portable_mode", "false"),
    ("browser_engine", "playwright_chromium"),
    ("app_language", "en"),
    ("startup_behavior", "normal"),
    ("browser_profile_root_path", ""),
    ("ai_providers", "[]"),
    ("default_ai_provider_index", "0"),
    ("audit_log_retention_days", "30"),
    ("automation_evidence_retention_days", "1"),
    ("browser_extensions", "[]"),
    ("automation_headless", "true"),
    ("automation_headless_overrides", "{}"),
    ("ai_auto_init", "true"),
];

fn default_auth_kind() -> String {
    "api_key".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSettings {
    pub kind: String,
    pub label: String,
    pub endpoint_url: String,
    pub api_key_stored: bool,
    pub default_model: String,
    #[serde(default = "default_auth_kind")]
    pub auth_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub active_profile_id: Option<String>,
    pub app_language: String,
    pub startup_behavior: String,
    pub portable_mode: bool,
    pub theme: String,
    pub reduced_effects: String,
    pub ai_providers: Vec<AiProviderSettings>,
    pub default_ai_provider_index: i64,
    pub browser_profile_root_path: String,
    pub database_path: String,
    pub audit_log_retention_days: i64,
    pub automation_evidence_retention_days: i64,
    #[serde(default)]
    pub browser_extensions: Vec<String>,
    #[serde(default = "default_automation_headless")]
    pub automation_headless: bool,
    #[serde(default)]
    pub automation_headless_overrides: BTreeMap<String, bool>,
    #[serde(default = "default_ai_auto_init")]
    pub ai_auto_init: bool,
}

fn default_automation_headless() -> bool {
    true
}

fn default_ai_auto_init() -> bool {
    true
}

pub async fn ensure_defaults(pool: &SqlitePool) -> Result<()> {
    for (key, value) in DEFAULTS {
        sqlx::query(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO NOTHING",
        )
        .bind(key)
        .bind(value)
        .bind(now_iso())
        .execute(pool)
        .await
        .with_context(|| format!("seed default setting `{key}`"))?;
    }
    Ok(())
}

async fn get_all(pool: &SqlitePool) -> Result<BTreeMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM app_settings")
        .fetch_all(pool)
        .await
        .context("load settings")?;
    Ok(rows.into_iter().collect())
}

async fn set(pool: &SqlitePool, key: &str, value: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(now_iso())
    .execute(pool)
    .await
    .with_context(|| format!("write setting `{key}`"))?;
    Ok(())
}

/// Whether the user opted the browser worker into the Docker container runtime.
/// Persisted separately from `AppSettings` (a runtime switch, not a UI preference
/// round-tripped through the settings form) under the `use_docker_worker` key.
pub async fn docker_worker_opt_in(pool: &SqlitePool) -> Result<bool> {
    let m = get_all(pool).await?;
    Ok(m.get("use_docker_worker")
        .map(|v| v == "true")
        .unwrap_or(false))
}

/// Persist the Docker-worker opt-in. The live process env is updated by the
/// command layer so the toggle takes effect without a restart.
pub async fn set_docker_worker_opt_in(pool: &SqlitePool, enabled: bool) -> Result<()> {
    set(
        pool,
        "use_docker_worker",
        if enabled { "true" } else { "false" },
    )
    .await
}

pub async fn load(pool: &SqlitePool, paths: &AppPaths) -> Result<AppSettings> {
    let m = get_all(pool).await?;
    let get = |k: &str, d: &str| m.get(k).cloned().unwrap_or_else(|| d.to_string());
    let ai_providers: Vec<AiProviderSettings> =
        serde_json::from_str(&get("ai_providers", "[]")).unwrap_or_default();
    let browser_extensions: Vec<String> =
        serde_json::from_str(&get("browser_extensions", "[]")).unwrap_or_default();

    Ok(AppSettings {
        active_profile_id: Some(
            m.get("active_profile_id")
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or_else(|| "default".to_string()),
        ),
        app_language: get("app_language", "en"),
        startup_behavior: get("startup_behavior", "normal"),
        portable_mode: paths.portable,
        theme: get("theme", "system"),
        reduced_effects: get("reduced_effects", "auto"),
        ai_providers,
        browser_extensions,
        default_ai_provider_index: get("default_ai_provider_index", "0").parse().unwrap_or(0),
        browser_profile_root_path: get("browser_profile_root_path", ""),
        database_path: paths.db_path.display().to_string(),
        audit_log_retention_days: get("audit_log_retention_days", "30").parse().unwrap_or(30),
        automation_evidence_retention_days: get("automation_evidence_retention_days", "1")
            .parse()
            .unwrap_or(1),
        automation_headless: get("automation_headless", "true").parse().unwrap_or(true),
        automation_headless_overrides: serde_json::from_str(&get(
            "automation_headless_overrides",
            "{}",
        ))
        .unwrap_or_default(),
        ai_auto_init: get("ai_auto_init", "true").parse().unwrap_or(true),
    })
}

pub async fn load_ai_providers(pool: &SqlitePool) -> Result<(Vec<AiProviderSettings>, i64)> {
    let m = get_all(pool).await?;
    let providers: Vec<AiProviderSettings> =
        serde_json::from_str(m.get("ai_providers").map(String::as_str).unwrap_or("[]"))
            .unwrap_or_default();
    let idx = m
        .get("default_ai_provider_index")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Ok((providers, idx))
}

pub async fn save(pool: &SqlitePool, s: &AppSettings) -> Result<()> {
    let pairs: [(&str, String); 14] = [
        (
            "active_profile_id",
            s.active_profile_id.clone().unwrap_or_default(),
        ),
        ("app_language", s.app_language.clone()),
        ("startup_behavior", s.startup_behavior.clone()),
        ("theme", s.theme.clone()),
        ("reduced_effects", s.reduced_effects.clone()),
        (
            "ai_providers",
            serde_json::to_string(&s.ai_providers).unwrap_or_else(|_| "[]".to_string()),
        ),
        (
            "browser_extensions",
            serde_json::to_string(&s.browser_extensions).unwrap_or_else(|_| "[]".to_string()),
        ),
        (
            "default_ai_provider_index",
            s.default_ai_provider_index.to_string(),
        ),
        (
            "browser_profile_root_path",
            s.browser_profile_root_path.clone(),
        ),
        (
            "audit_log_retention_days",
            s.audit_log_retention_days.to_string(),
        ),
        (
            "automation_evidence_retention_days",
            s.automation_evidence_retention_days.to_string(),
        ),
        ("automation_headless", s.automation_headless.to_string()),
        (
            "automation_headless_overrides",
            serde_json::to_string(&s.automation_headless_overrides)
                .unwrap_or_else(|_| "{}".to_string()),
        ),
        ("ai_auto_init", s.ai_auto_init.to_string()),
    ];
    for (k, v) in &pairs {
        set(pool, k, v).await?;
    }
    Ok(())
}

#[cfg_attr(not(feature = "real-browser"), allow(dead_code))]
pub async fn read_automation_headless(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'automation_headless'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|v| v.parse().ok())
    .unwrap_or(true)
}

#[cfg_attr(not(feature = "real-browser"), allow(dead_code))]
pub async fn read_automation_headless_for(pool: &SqlitePool, task: &str, fallback: bool) -> bool {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'automation_headless_overrides'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|v| serde_json::from_str::<BTreeMap<String, bool>>(&v).ok())
    .and_then(|m| m.get(task).copied())
    .unwrap_or(fallback)
}

#[allow(dead_code)]
pub async fn read_ai_auto_init(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = 'ai_auto_init'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(true)
}

#[allow(dead_code)]
pub async fn read_active_profile_id(pool: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'active_profile_id'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .filter(|s| !s.trim().is_empty())
}
