//! `app_settings` key/value repository + the typed [`AppSettings`] DTO that the
//! frontend `settingsStore` consumes.
//!
//! Scalars are stored as individual key/value rows; `ai_providers` is stored as
//! a JSON blob under one key. `portable_mode` and `database_path` are *derived*
//! from [`AppPaths`] at read time and are not persisted.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::paths::AppPaths;
use crate::util::now_iso;

/// Baseline settings. Migration `0001` seeds a subset; this guard keeps the set
/// complete when new keys are introduced between releases.
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
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSettings {
    pub kind: String,
    pub label: String,
    pub endpoint_url: String,
    pub api_key_stored: bool,
    pub default_model: String,
}

/// Mirrors the TypeScript `AppSettings` interface (camelCase on the wire).
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

/// Assemble the typed settings object from the key/value store, deriving the
/// path-based fields from [`AppPaths`].
pub async fn load(pool: &SqlitePool, paths: &AppPaths) -> Result<AppSettings> {
    let m = get_all(pool).await?;
    let get = |k: &str, d: &str| m.get(k).cloned().unwrap_or_else(|| d.to_string());
    let ai_providers: Vec<AiProviderSettings> =
        serde_json::from_str(&get("ai_providers", "[]")).unwrap_or_default();

    Ok(AppSettings {
        active_profile_id: m
            .get("active_profile_id")
            .filter(|s| !s.is_empty())
            .cloned(),
        app_language: get("app_language", "en"),
        startup_behavior: get("startup_behavior", "normal"),
        portable_mode: paths.portable,
        theme: get("theme", "system"),
        reduced_effects: get("reduced_effects", "auto"),
        ai_providers,
        default_ai_provider_index: get("default_ai_provider_index", "0").parse().unwrap_or(0),
        browser_profile_root_path: get("browser_profile_root_path", ""),
        database_path: paths.db_path.display().to_string(),
        audit_log_retention_days: get("audit_log_retention_days", "30").parse().unwrap_or(30),
        automation_evidence_retention_days: get("automation_evidence_retention_days", "1")
            .parse()
            .unwrap_or(1),
    })
}

/// Read just the configured AI providers + default index, without needing
/// [`AppPaths`]. Used by AI-backed services (CV analysis, application drafting)
/// that only care about provider config, not the path-derived fields.
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

/// Persist the writable fields. Derived fields (`portable_mode`,
/// `database_path`) are intentionally not written back.
pub async fn save(pool: &SqlitePool, s: &AppSettings) -> Result<()> {
    let pairs: [(&str, String); 10] = [
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
    ];
    for (k, v) in &pairs {
        set(pool, k, v).await?;
    }
    Ok(())
}
