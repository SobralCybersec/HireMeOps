//! Cloud browser-session commands. Plain storage state stays inside Rust long
//! enough to encrypt it; the frontend receives metadata only.

use serde_json::{json, Value};

#[cfg(any(test, feature = "real-browser"))]
use serde_json::Map;

use crate::storage::postgres::{self, BrowserSessionMetadata};

#[cfg(feature = "real-browser")]
use crate::storage::postgres_browser_sessions::ProfileSessionLock;
#[cfg(feature = "real-browser")]
use crate::storage::session_crypto;

const STORAGE_STATE_VERSION: i32 = 1;

fn validated_profile_id(profile_id: &str) -> Result<&str, String> {
    let trimmed = profile_id.trim();
    if trimmed.is_empty() {
        return Err("profile_id is required".to_owned());
    }
    Ok(trimmed)
}

fn shared_db(state: &crate::AppState) -> Result<&sqlx::PgPool, String> {
    state
        .shared_db
        .as_ref()
        .ok_or_else(|| "shared PostgreSQL is not configured".to_owned())
}

#[cfg(any(test, feature = "real-browser"))]
fn platform_status(reply: &Map<String, Value>) -> Value {
    let Some(status) = reply.get("platform_status").and_then(Value::as_object) else {
        return json!({});
    };
    Value::Object(
        status
            .iter()
            .filter(|(platform, _)| platform.as_str() != "infojobs")
            .map(|(platform, value)| (platform.clone(), value.clone()))
            .collect(),
    )
}

#[cfg(any(test, feature = "real-browser"))]
fn summarize_status(status: &Value) -> &'static str {
    let Some(values) = status.as_object() else {
        return "unknown";
    };
    if values.is_empty() {
        return "unknown";
    }
    if values
        .values()
        .any(|value| value.as_str() == Some("challenged"))
    {
        return "challenged";
    }
    if values.values().any(|value| value.as_str() == Some("valid")) {
        return "valid";
    }
    if values
        .values()
        .any(|value| value.as_str() == Some("login_required"))
    {
        return "login_required";
    }
    "unknown"
}

#[cfg(feature = "real-browser")]
async fn release_lock(
    lock: ProfileSessionLock,
    result: Result<BrowserSessionMetadata, String>,
) -> Result<BrowserSessionMetadata, String> {
    let release = lock.release().await.map_err(|error| error.to_string());
    match (result, release) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

#[tauri::command]
pub async fn browser_session_status(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<Option<BrowserSessionMetadata>, String> {
    let profile_id = validated_profile_id(&profile_id)?;
    postgres::get_browser_session_metadata(shared_db(&state)?, profile_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_browser_session(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<BrowserSessionMetadata, String> {
    let profile_id = validated_profile_id(&profile_id)?;
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let pool = shared_db(&state)?;
        let Some(lock) = postgres::try_lock_profile(pool, profile_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            return Err("browser session is busy".to_owned());
        };
        let user_data_dir = automation_profile_dir(&state.paths.data_dir, profile_id)
            .to_string_lossy()
            .into_owned();
        let result = sync_locked(&state, pool, profile_id, &user_data_dir).await;
        release_lock(lock, result).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_owned())
    }
}

#[cfg(feature = "real-browser")]
async fn sync_locked(
    state: &crate::AppState,
    pool: &sqlx::PgPool,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<BrowserSessionMetadata, String> {
    sync_locked_for_sites(state, pool, profile_id, user_data_dir, &[]).await
}

#[cfg(feature = "real-browser")]
async fn sync_locked_for_sites(
    state: &crate::AppState,
    pool: &sqlx::PgPool,
    profile_id: &str,
    user_data_dir: &str,
    sites: &[&str],
) -> Result<BrowserSessionMetadata, String> {
    let handle = login_handle(state, profile_id).await?;
    let (status, platforms) = validated_platforms_for_sites(state, user_data_dir, sites).await?;
    let (state_version, storage_state) = exported_state(state, &handle).await?;
    let encrypted =
        session_crypto::encrypt_json(&storage_state).map_err(|error| error.to_string())?;
    let current = postgres::get_browser_session_metadata(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?;
    let expected_revision = current.as_ref().map(|value| value.revision);
    let existing_platforms = current
        .as_ref()
        .map(|value| value.platform_status.clone())
        .unwrap_or_else(|| json!({}));
    let platforms = merge_platform_status(&existing_platforms, &platforms);
    let status = summarize_status(&platforms);
    postgres::upsert_browser_session(
        pool,
        postgres::BrowserSessionWrite {
            profile_id,
            encrypted_state: &encrypted,
            encryption_version: session_crypto::ENCRYPTION_VERSION,
            state_format_version: state_version,
            status,
            platform_status: &platforms,
            expected_revision,
        },
    )
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "browser session revision conflict".to_owned())
}

#[tauri::command]
pub async fn validate_browser_session(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<BrowserSessionMetadata, String> {
    let profile_id = validated_profile_id(&profile_id)?;
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let pool = shared_db(&state)?;
        let Some(lock) = postgres::try_lock_profile(pool, profile_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            return Err("browser session is busy".to_owned());
        };
        let user_data_dir = automation_profile_dir(&state.paths.data_dir, profile_id)
            .to_string_lossy()
            .into_owned();
        let result = validate_locked(&state, pool, profile_id, &user_data_dir).await;
        release_lock(lock, result).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_owned())
    }
}

#[cfg(feature = "real-browser")]
async fn validate_locked(
    state: &crate::AppState,
    pool: &sqlx::PgPool,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<BrowserSessionMetadata, String> {
    let checked = state
        .playwright
        .check_logins_detailed(user_data_dir)
        .await
        .map_err(|error| error.to_string())?;
    let platforms = platform_status(&checked);
    let status = summarize_status(&platforms);
    let current = postgres::get_browser_session_metadata(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "cloud browser session is not synchronized".to_owned())?;
    postgres::update_browser_session_status(pool, profile_id, status, &platforms, current.revision)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "browser session revision conflict".to_owned())
}

#[cfg(feature = "real-browser")]
async fn login_handle(state: &crate::AppState, profile_id: &str) -> Result<String, String> {
    state
        .playwright
        .login_session_for(profile_id)
        .await
        .ok_or_else(|| "open all logins before syncing browser session".to_owned())
}

#[cfg(feature = "real-browser")]
async fn validated_platforms_for_sites(
    state: &crate::AppState,
    user_data_dir: &str,
    sites: &[&str],
) -> Result<(&'static str, Value), String> {
    let checked = if sites.is_empty() {
        state.playwright.check_logins_detailed(user_data_dir).await
    } else {
        state
            .playwright
            .check_logins_detailed_for_sites(user_data_dir, sites)
            .await
    }
    .map_err(|error| error.to_string())?;
    let platforms = platform_status(&checked);
    let status = summarize_status(&platforms);
    let target_status = sites.iter().find_map(|site| {
        platforms
            .get(*site)
            .and_then(Value::as_str)
            .or(Some("unknown"))
    });
    if let Some(target_status) = target_status {
        if target_status != "valid" {
            return Err(format!(
                "browser session validation status: {target_status}"
            ));
        }
    } else if status != "valid" {
        return Err(format!("browser session validation status: {status}"));
    }
    Ok((status, platforms))
}

#[cfg(feature = "real-browser")]
fn merge_platform_status(existing: &Value, incoming: &Value) -> Value {
    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if let Some(incoming) = incoming.as_object() {
        merged.extend(incoming.clone());
    }
    Value::Object(merged)
}

#[cfg(feature = "real-browser")]
async fn exported_state(state: &crate::AppState, handle: &str) -> Result<(i32, Value), String> {
    let (state_version, storage_state) = state
        .playwright
        .export_storage_state(handle)
        .await
        .map_err(|error| error.to_string())?;
    if state_version != STORAGE_STATE_VERSION {
        return Err(format!(
            "unsupported storage state version: {state_version}"
        ));
    }
    Ok((state_version, storage_state))
}

#[tauri::command]
pub async fn revoke_browser_session(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<Option<BrowserSessionMetadata>, String> {
    let profile_id = validated_profile_id(&profile_id)?;
    let pool = shared_db(&state)?;
    let Some(lock) = postgres::try_lock_profile(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err("browser session is busy".to_owned());
    };
    let result = postgres::revoke_browser_session(pool, profile_id)
        .await
        .map_err(|error| error.to_string());
    let release = lock.release().await.map_err(|error| error.to_string());
    match (result, release) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRunInput {
    pub profile_id: String,
    pub intent: String,
    pub query_plan: Value,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRunReceipt {
    pub profile_id: String,
    pub session_revision: i64,
    pub search_run_id: String,
    pub northflank_run_id: String,
    pub northflank_run_name: String,
}

#[tauri::command]
pub async fn trigger_cloud_run(
    state: tauri::State<'_, crate::AppState>,
    mut input: CloudRunInput,
) -> Result<CloudRunReceipt, String> {
    input.profile_id = validated_profile_id(&input.profile_id)?.to_owned();
    let pool = shared_db(&state)?;
    let platform = input.query_plan.get("platform").and_then(Value::as_str);
    #[cfg(feature = "real-browser")]
    sync_cloud_session_for_platform(&state, pool, &input.profile_id, platform).await?;
    let session = ensure_cloud_session(pool, &input.profile_id, platform).await?;
    let config = NorthflankConfig::from_env()?;
    let search_run_id = create_search_run(pool, &input).await?;
    let (northflank_run_id, northflank_run_name) =
        trigger_and_record_failure(pool, &config, &search_run_id).await?;
    Ok(CloudRunReceipt {
        profile_id: input.profile_id,
        session_revision: session.revision,
        search_run_id,
        northflank_run_id,
        northflank_run_name,
    })
}

#[cfg(feature = "real-browser")]
async fn sync_cloud_session_for_platform(
    state: &crate::AppState,
    pool: &sqlx::PgPool,
    profile_id: &str,
    platform: Option<&str>,
) -> Result<BrowserSessionMetadata, String> {
    use crate::storage::paths::automation_profile_dir;

    let Some(lock) = postgres::try_lock_profile(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err("browser session is busy".to_owned());
    };
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, profile_id)
        .to_string_lossy()
        .into_owned();
    let result = match cloud_auth_platform(platform) {
        Some(site) => sync_locked_for_sites(state, pool, profile_id, &user_data_dir, &[site]).await,
        None => sync_locked(state, pool, profile_id, &user_data_dir).await,
    };
    release_lock(lock, result).await
}

fn cloud_auth_platform(platform: Option<&str>) -> Option<&'static str> {
    match platform {
        Some("linkedin_posts") | Some("linkedin") => Some("linkedin"),
        Some("catho") => Some("catho"),
        Some("indeed") => Some("indeed"),
        Some("gupy") => Some("gupy"),
        _ => None,
    }
}

fn target_session_status<'a>(
    global_status: &'a str,
    platform_status: &'a Value,
    platform: Option<&str>,
) -> &'a str {
    let Some(platform) = (match platform {
        Some("linkedin_posts") => Some("linkedin"),
        Some("linkedin" | "catho" | "indeed" | "gupy") => platform,
        _ => None,
    }) else {
        return global_status;
    };
    platform_status
        .get(platform)
        .and_then(Value::as_str)
        .unwrap_or("unknown")
}

async fn ensure_cloud_session(
    pool: &sqlx::PgPool,
    profile_id: &str,
    platform: Option<&str>,
) -> Result<BrowserSessionMetadata, String> {
    let profile_id = validated_profile_id(profile_id)?;
    let session = postgres::get_browser_session_metadata(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "cloud browser session is not synchronized".to_owned())?;
    validate_cloud_session(&session, profile_id, platform)?;
    Ok(session)
}

fn validate_cloud_session(
    session: &BrowserSessionMetadata,
    profile_id: &str,
    platform: Option<&str>,
) -> Result<(), String> {
    let profile_id = validated_profile_id(profile_id)?;
    if session.profile_id != profile_id {
        return Err("cloud browser session profile mismatch".to_owned());
    }
    if session.encrypted_state_bytes <= 0 {
        return Err("cloud browser session has no encrypted state".to_owned());
    }
    if session.encryption_version != crate::storage::session_crypto::ENCRYPTION_VERSION {
        return Err(format!(
            "unsupported session encryption version: {}",
            session.encryption_version
        ));
    }
    if session.state_format_version != STORAGE_STATE_VERSION {
        return Err(format!(
            "unsupported storage state version: {}",
            session.state_format_version
        ));
    }
    let status = target_session_status(&session.status, &session.platform_status, platform);
    if status != "valid" {
        return Err(format!(
            "cloud browser session is not valid for {}: {}",
            platform.unwrap_or("requested platform"),
            status
        ));
    }
    Ok(())
}

struct NorthflankConfig {
    token: String,
    project_id: String,
    job_id: String,
    base_url: String,
}

impl NorthflankConfig {
    fn from_env() -> Result<Self, String> {
        let base_url = std::env::var("NORTHFLANK_API_BASE_URL")
            .unwrap_or_else(|_| "https://api.northflank.com/v1".to_owned())
            .trim_end_matches('/')
            .to_owned();
        if !base_url.starts_with("https://") {
            return Err("NORTHFLANK_API_BASE_URL must use HTTPS".to_owned());
        }
        Ok(Self {
            token: required_env("NORTHFLANK_API_TOKEN")?,
            project_id: required_env("NORTHFLANK_PROJECT_ID")?,
            job_id: required_env("NORTHFLANK_JOB_ID")?,
            base_url,
        })
    }
}

async fn create_search_run(pool: &sqlx::PgPool, input: &CloudRunInput) -> Result<String, String> {
    let search_run_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO search_runs (id, profile_id, intent, query_plan, status)
         VALUES ($1, $2, $3, $4, 'started')",
    )
    .bind(&search_run_id)
    .bind(&input.profile_id)
    .bind(&input.intent)
    .bind(sqlx::types::Json(input.query_plan.clone()))
    .execute(pool)
    .await
    .map_err(|error| format!("create search run: {error}"))?;
    Ok(search_run_id)
}

async fn trigger_and_record_failure(
    pool: &sqlx::PgPool,
    config: &NorthflankConfig,
    search_run_id: &str,
) -> Result<(String, String), String> {
    match trigger_northflank(config, search_run_id).await {
        Ok(result) => Ok(result),
        Err(error) => {
            mark_run_failed(pool, search_run_id, &error).await;
            Err(error)
        }
    }
}

async fn trigger_northflank(
    config: &NorthflankConfig,
    search_run_id: &str,
) -> Result<(String, String), String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/projects/{}/jobs/{}/runs",
            config.base_url, config.project_id, config.job_id
        ))
        .bearer_auth(&config.token)
        .json(&json!({ "runtimeEnvironment": { "HIREMEOPS_RUN_ID": search_run_id } }))
        .send()
        .await
        .map_err(|_| "Northflank request failed".to_owned())?;
    if !response.status().is_success() {
        return Err("Northflank job trigger failed".to_owned());
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "Northflank response parse failed".to_owned())?;
    let Some(data) = payload.get("data").and_then(Value::as_object) else {
        return Err("Northflank response missing run data".to_owned());
    };
    let Some(northflank_run_id) = data.get("id").and_then(Value::as_str) else {
        return Err("Northflank response missing run id".to_owned());
    };
    let Some(northflank_run_name) = data.get("runName").and_then(Value::as_str) else {
        return Err("Northflank response missing run name".to_owned());
    };
    Ok((northflank_run_id.to_owned(), northflank_run_name.to_owned()))
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

async fn mark_run_failed(pool: &sqlx::PgPool, run_id: &str, error: &str) {
    let _ = sqlx::query(
        "UPDATE search_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1",
    )
    .bind(run_id)
    .bind(error)
    .execute(pool)
    .await;
}

#[cfg(test)]
#[path = "../tests/commands_browser_sessions_tests.rs"]
mod tests;
