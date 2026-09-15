//! Cloud browser-session commands. Plain storage state stays inside Rust long
//! enough to encrypt it; the frontend receives metadata only.

use serde_json::{json, Value};

#[cfg(any(test, feature = "real-browser"))]
use serde_json::Map;

use crate::storage::postgres::{self, BrowserSessionMetadata};

#[cfg(feature = "real-browser")]
use crate::storage::session_crypto;

#[cfg(any(test, feature = "real-browser"))]
const STORAGE_STATE_VERSION: i32 = 1;

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

#[cfg(any(test, feature = "real-browser"))]
async fn release_lock(
    lock: postgres::ProfileSessionLock,
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
    postgres::get_browser_session_metadata(shared_db(&state)?, &profile_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_browser_session(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<BrowserSessionMetadata, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let pool = shared_db(&state)?;
        let Some(lock) = postgres::try_lock_profile(pool, &profile_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            return Err("browser session is busy".to_owned());
        };
        let user_data_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let result = sync_locked(&state, pool, &profile_id, &user_data_dir).await;
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
    let handle = login_handle(state, profile_id).await?;
    let (status, platforms) = validated_platforms(state, user_data_dir).await?;
    let (state_version, storage_state) = exported_state(state, &handle).await?;
    let encrypted =
        session_crypto::encrypt_json(&storage_state).map_err(|error| error.to_string())?;
    let expected_revision = current_revision(pool, profile_id).await?;
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
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let pool = shared_db(&state)?;
        let Some(lock) = postgres::try_lock_profile(pool, &profile_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            return Err("browser session is busy".to_owned());
        };
        let user_data_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let result = validate_locked(&state, pool, &profile_id, &user_data_dir).await;
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
async fn validated_platforms(
    state: &crate::AppState,
    user_data_dir: &str,
) -> Result<(&'static str, Value), String> {
    let checked = state
        .playwright
        .check_logins_detailed(user_data_dir)
        .await
        .map_err(|error| error.to_string())?;
    let platforms = platform_status(&checked);
    let status = summarize_status(&platforms);
    if status != "valid" {
        return Err(format!("browser session validation status: {status}"));
    }
    Ok((status, platforms))
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

#[cfg(feature = "real-browser")]
async fn current_revision(pool: &sqlx::PgPool, profile_id: &str) -> Result<Option<i64>, String> {
    postgres::get_browser_session_metadata(pool, profile_id)
        .await
        .map(|metadata| metadata.map(|value| value.revision))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn revoke_browser_session(
    state: tauri::State<'_, crate::AppState>,
    profile_id: String,
) -> Result<Option<BrowserSessionMetadata>, String> {
    let pool = shared_db(&state)?;
    let Some(lock) = postgres::try_lock_profile(pool, &profile_id)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err("browser session is busy".to_owned());
    };
    let result = postgres::revoke_browser_session(pool, &profile_id)
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
    pub search_run_id: String,
    pub northflank_run_id: String,
    pub northflank_run_name: String,
}

#[tauri::command]
pub async fn trigger_cloud_run(
    state: tauri::State<'_, crate::AppState>,
    input: CloudRunInput,
) -> Result<CloudRunReceipt, String> {
    let pool = shared_db(&state)?;
    ensure_cloud_session(pool, &input.profile_id).await?;
    let config = NorthflankConfig::from_env()?;
    let search_run_id = create_search_run(pool, &input).await?;
    let (northflank_run_id, northflank_run_name) =
        trigger_and_record_failure(pool, &config, &search_run_id).await?;
    Ok(CloudRunReceipt {
        search_run_id,
        northflank_run_id,
        northflank_run_name,
    })
}

async fn ensure_cloud_session(pool: &sqlx::PgPool, profile_id: &str) -> Result<(), String> {
    let session = postgres::get_browser_session_metadata(pool, profile_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "cloud browser session is not synchronized".to_owned())?;
    if session.status != "valid" {
        return Err(format!(
            "cloud browser session is not valid: {}",
            session.status
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
mod tests {
    use super::*;

    #[test]
    fn status_summary_prioritizes_challenge_and_validity() {
        assert_eq!(
            summarize_status(&json!({ "site": "challenged" })),
            "challenged"
        );
        assert_eq!(
            summarize_status(&json!({ "site": "valid", "other": "login_required" })),
            "valid"
        );
        assert_eq!(
            summarize_status(&json!({ "site": "login_required" })),
            "login_required"
        );
        assert_eq!(summarize_status(&json!({})), "unknown");
    }

    #[test]
    fn session_bridge_ignores_infojobs_login_status() {
        let reply = json!({
            "platform_status": {
                "linkedin": "valid",
                "infojobs": "login_required"
            }
        });
        let filtered = platform_status(reply.as_object().unwrap());
        assert_eq!(filtered, json!({ "linkedin": "valid" }));
        assert_eq!(summarize_status(&filtered), "valid");
    }
}
