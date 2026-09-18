//! Durable PostgreSQL search events projected into local SQLite and Tauri events.

use serde_json::{json, Value};
use sqlx::{postgres::PgListener, FromRow, PgPool, SqlitePool};
use std::time::Duration;
use tauri::AppHandle;

use crate::events::{AppEvent, AppEventType, EventEmitter};

const CHANNEL: &str = "hiremeops_realtime";
const CONSUMER: &str = "desktop";

#[derive(Debug, FromRow)]
struct EventRow {
    seq: i64,
    id: String,
    search_run_id: String,
    profile_id: Option<String>,
    kind: String,
    payload: sqlx::types::Json<Value>,
    created_at: String,
}

#[derive(Debug, FromRow)]
struct SharedJobRow {
    id: String,
    profile_id: Option<String>,
    platform: String,
    canonical_url: Option<String>,
    title: String,
    company: String,
    location: Option<String>,
    remote_mode: Option<String>,
    description: String,
    summary: Option<String>,
    seniority: Option<String>,
    salary_min: Option<i64>,
    salary_max: Option<i64>,
    currency: Option<String>,
    employment_type: Option<String>,
    discovered_at: String,
}

pub fn start(app: AppHandle, shared_db: PgPool, local_db: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = ensure_cursor_table(&local_db).await {
            tracing::warn!(%error, "realtime cursor unavailable");
            return;
        }
        loop {
            match listen_once(&app, &shared_db, &local_db).await {
                Ok(()) => tracing::warn!("realtime listener stopped; reconnecting"),
                Err(error) => tracing::warn!(%error, "realtime listener disconnected"),
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

async fn ensure_cursor_table(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS realtime_event_cursors (
            consumer TEXT PRIMARY KEY,
            last_seq INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(db)
    .await
    .map(|_| ())
}

async fn listen_once(
    app: &AppHandle,
    shared_db: &PgPool,
    local_db: &SqlitePool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut listener = PgListener::connect_with(shared_db).await?;
    listener.listen(CHANNEL).await?;
    catch_up(app, shared_db, local_db).await?;
    loop {
        listener.recv().await?;
        catch_up(app, shared_db, local_db).await?;
    }
}

async fn cursor(db: &SqlitePool) -> Result<i64, sqlx::Error> {
    Ok(
        sqlx::query_scalar("SELECT last_seq FROM realtime_event_cursors WHERE consumer = ?1")
            .bind(CONSUMER)
            .fetch_optional(db)
            .await?
            .unwrap_or(0),
    )
}

async fn save_cursor(db: &SqlitePool, seq: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO realtime_event_cursors (consumer, last_seq)
         VALUES (?1, ?2)
         ON CONFLICT(consumer) DO UPDATE SET last_seq = excluded.last_seq",
    )
    .bind(CONSUMER)
    .bind(seq)
    .execute(db)
    .await
    .map(|_| ())
}

async fn catch_up(
    app: &AppHandle,
    shared_db: &PgPool,
    local_db: &SqlitePool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut after = cursor(local_db).await?;
    let mut replayed = 0;
    loop {
        let events = sqlx::query_as::<_, EventRow>(
            "SELECT seq, id, search_run_id, profile_id, kind, payload,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at
             FROM search_run_events
             WHERE seq > $1
             ORDER BY seq ASC
             LIMIT 500",
        )
        .bind(after)
        .fetch_all(shared_db)
        .await?;
        if events.is_empty() {
            break;
        }
        for event in &events {
            dispatch_event(app, shared_db, local_db, event).await?;
            save_cursor(local_db, event.seq).await?;
            after = event.seq;
        }
        replayed += events.len();
        if events.len() < 500 {
            break;
        }
    }
    if replayed > 0 {
        tracing::debug!(
            last_seq = after,
            count = replayed,
            "realtime events replayed"
        );
    }
    Ok(())
}

async fn dispatch_event(
    app: &AppHandle,
    shared_db: &PgPool,
    local_db: &SqlitePool,
    event: &EventRow,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(kind) = event_kind(&event.kind) else {
        return Ok(());
    };
    let mut payload = event.payload.0.clone();
    if let Some(object) = payload.as_object_mut() {
        object.insert("seq".to_owned(), json!(event.seq));
        object
            .entry("runId".to_owned())
            .or_insert_with(|| json!(event.search_run_id.clone()));
        if let Some(profile_id) = &event.profile_id {
            object
                .entry("profileId".to_owned())
                .or_insert_with(|| json!(profile_id));
        }
    }
    if matches!(
        kind,
        AppEventType::JobSearchItemFound | AppEventType::JobSearchItemUpdated
    ) {
        let job_id = payload
            .get("jobId")
            .and_then(Value::as_str)
            .ok_or("search event missing jobId")?;
        let mut job = project_shared_job(shared_db, local_db, job_id).await?;
        if let (Some(job_object), Some(event_object)) = (job.as_object_mut(), payload.as_object()) {
            for key in ["runId", "profileId", "origin", "seq"] {
                if let Some(value) = event_object.get(key) {
                    job_object.insert(key.to_owned(), value.clone());
                }
            }
        }
        payload = job;
    }
    app.emit_app_event(AppEvent {
        id: event.id.clone(),
        kind,
        profile_id: event.profile_id.clone(),
        task_id: Some(event.search_run_id.clone()),
        payload,
        created_at: event.created_at.clone(),
    });
    Ok(())
}

fn event_kind(kind: &str) -> Option<AppEventType> {
    Some(match kind {
        "job.search.started" => AppEventType::JobSearchStarted,
        "job.search.phase" => AppEventType::JobSearchPhase,
        "job.search.progress" => AppEventType::JobSearchProgress,
        "job.search.item_found" => AppEventType::JobSearchItemFound,
        "job.search.item_updated" => AppEventType::JobSearchItemUpdated,
        "job.search.completed" => AppEventType::JobSearchCompleted,
        "job.search.failed" => AppEventType::JobSearchFailed,
        "browser.session.status" => AppEventType::BrowserSessionStatus,
        _ => return None,
    })
}

async fn project_shared_job(
    shared_db: &PgPool,
    local_db: &SqlitePool,
    job_id: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let row = sqlx::query_as::<_, SharedJobRow>(
        "SELECT id, profile_id, platform, canonical_url, title, company, location,
                remote_mode, description, summary, seniority, salary_min, salary_max,
                currency, employment_type,
                to_char(discovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS discovered_at
         FROM shared_jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_one(shared_db)
    .await?;
    let url = row
        .canonical_url
        .clone()
        .unwrap_or_else(|| format!("cloud://{job_id}"));
    sqlx::query(
        "INSERT INTO job_posts (
            id, profile_id, platform, external_id, url, canonical_url, title, company,
            location, remote_mode, description, summary, salary_min, salary_max, currency,
            seniority, employment_type, posted_at, discovered_at, last_seen_at,
            discovery_source, search_query_id, status, contact_email
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                   ?15, ?16, ?17, NULL, ?18, ?18, 'cloud', NULL, 'discovered', NULL)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, company = excluded.company,
           location = COALESCE(excluded.location, job_posts.location),
           remote_mode = COALESCE(excluded.remote_mode, job_posts.remote_mode),
           description = excluded.description, summary = excluded.summary,
           salary_min = COALESCE(excluded.salary_min, job_posts.salary_min),
           salary_max = COALESCE(excluded.salary_max, job_posts.salary_max),
           currency = COALESCE(excluded.currency, job_posts.currency),
           seniority = COALESCE(excluded.seniority, job_posts.seniority),
           employment_type = COALESCE(excluded.employment_type, job_posts.employment_type),
           last_seen_at = excluded.last_seen_at",
    )
    .bind(&row.id)
    .bind(&row.profile_id)
    .bind(&row.platform)
    .bind(Option::<String>::None)
    .bind(&url)
    .bind(&row.canonical_url)
    .bind(&row.title)
    .bind(&row.company)
    .bind(&row.location)
    .bind(&row.remote_mode)
    .bind(&row.description)
    .bind(&row.summary)
    .bind(row.salary_min)
    .bind(row.salary_max)
    .bind(&row.currency)
    .bind(&row.seniority)
    .bind(&row.employment_type)
    .bind(&row.discovered_at)
    .execute(local_db)
    .await?;
    Ok(json!({
        "id": row.id,
        "profileId": row.profile_id,
        "platform": row.platform,
        "externalId": null,
        "url": url,
        "canonicalUrl": row.canonical_url,
        "title": row.title,
        "company": row.company,
        "location": row.location,
        "remoteMode": row.remote_mode,
        "description": row.description,
        "summary": row.summary,
        "seniority": row.seniority,
        "employmentType": row.employment_type,
        "salaryMin": row.salary_min,
        "salaryMax": row.salary_max,
        "currency": row.currency,
        "postedAt": null,
        "discoveredAt": row.discovered_at,
        "status": "discovered",
        "searchQueryId": null,
        "discoverySource": "cloud",
        "contactEmail": null,
    }))
}

#[cfg(test)]
#[path = "../tests/realtime_tests.rs"]
mod tests;
