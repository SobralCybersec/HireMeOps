use super::*;
#[cfg(feature = "real-browser")]
use crate::domain::automation::JobCard;
use crate::AppState;
use tauri::{AppHandle, State};
// Ingest-side helpers are only exercised by the real-browser scraper bodies;
// the lean stubs just return an error, so gate them to avoid unused-import lints.
#[cfg(feature = "real-browser")]
use crate::events::{AppEvent, AppEventType, EventEmitter};
#[cfg(feature = "real-browser")]
use crate::jobs::{canonicalize, check_dedupe, extract_email, DedupeOutcome};
#[cfg(feature = "real-browser")]
use crate::util::now_iso;
#[cfg(feature = "real-browser")]
use uuid::Uuid;

/* Stream a just-ingested job to the frontend (SSE scrape streaming). Re-selects
the row so the payload matches `list_job_posts` exactly; best-effort (a failed
emit must never abort a scrape). */
#[cfg(feature = "real-browser")]
async fn emit_job_found(app: &AppHandle, db: &sqlx::SqlitePool, profile_id: &str, job_id: &str) {
    let row = sqlx::query_as::<_, JobRow>(
        "SELECT id, profile_id, platform, external_id,
                url, canonical_url, title, company,
                location, remote_mode, description, summary,
                seniority, salary_min, salary_max, currency,
                employment_type, discovered_at, status,
                search_query_id, discovery_source, contact_email
         FROM job_posts WHERE id = ?1",
    )
    .bind(job_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    if let Some(row) = row {
        let payload =
            serde_json::to_value(JobPostDto::from(row)).unwrap_or(serde_json::Value::Null);
        app.emit_app_event(
            AppEvent::new(AppEventType::JobSearchItemFound, payload).with_profile(profile_id),
        );
    }
}

/// The one canonical job-post INSERT, shared by every scraper. The 24 columns
/// bind positionally (`?1`..`?23`), and `?19` is reused for both `discovered_at`
/// and `last_seen_at` (a fresh row's last-seen IS its discovery). Each scraper
/// keeps its own `.bind(..)` chain — the values legitimately differ per platform
/// (real vs None salary/contact_email/etc.) — but the schema-coupled SQL lives
/// here ONCE so a column change is a single edit, not nine.
#[cfg(feature = "real-browser")]
const INSERT_JOB_POST_SQL: &str = "INSERT INTO job_posts (
    id, profile_id, platform, external_id,
    url, canonical_url, title, company,
    location, remote_mode, description, summary,
    salary_min, salary_max, currency,
    seniority, employment_type, posted_at,
    discovered_at, last_seen_at, discovery_source,
    search_query_id, status, contact_email
) VALUES (
    ?1,  ?2,  ?3,  ?4,
    ?5,  ?6,  ?7,  ?8,
    ?9,  ?10, ?11, ?12,
    ?13, ?14, ?15,
    ?16, ?17, ?18,
    ?19, ?19, ?20,
    ?21, ?22, ?23
)";

#[cfg(feature = "real-browser")]
async fn validated_search_query(
    db: &sqlx::SqlitePool,
    profile_id: &str,
    requested: Option<String>,
) -> Result<Option<String>, String> {
    let profile_exists: i64 =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
            .bind(profile_id)
            .fetch_one(db)
            .await
            .map_err(|e| e.to_string())?;
    if profile_exists == 0 {
        return Err(format!(
            "unknown profile '{profile_id}' — select an active profile first"
        ));
    }
    let Some(id) = requested else { return Ok(None) };
    let exists: i64 =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
            .bind(&id)
            .fetch_one(db)
            .await
            .map_err(|e| e.to_string())?;
    Ok(exists.ne(&0).then_some(id))
}

#[cfg(feature = "real-browser")]
async fn search_runtime(state: &AppState, profile_id: &str, operation: &str) -> (String, bool) {
    let dir = crate::storage::paths::automation_profile_dir(&state.paths.data_dir, profile_id)
        .to_string_lossy()
        .into_owned();
    let global = crate::storage::settings::read_automation_headless(&state.db).await;
    let headless =
        crate::storage::settings::read_automation_headless_for(&state.db, operation, global).await;
    (dir, headless)
}

#[cfg(feature = "real-browser")]
struct IngestContext<'a> {
    app: &'a AppHandle,
    db: &'a sqlx::SqlitePool,
    profile_id: &'a str,
    search_query_id: &'a Option<String>,
    platform: &'a str,
    source: &'a str,
    remote_fallback: bool,
    extract_contact_email: bool,
}

#[cfg(feature = "real-browser")]
async fn ingest_cards(ctx: &IngestContext<'_>, cards: &[JobCard]) -> Result<(u32, u32), String> {
    let mut ingested = 0;
    let mut skipped_duplicates = 0;
    for card in cards {
        let Some(url) = card.apply_url.as_deref().filter(|url| !url.is_empty()) else {
            continue;
        };
        match ingest_card(ctx, card, url).await? {
            true => skipped_duplicates += 1,
            false => ingested += 1,
        }
    }
    Ok((ingested, skipped_duplicates))
}

#[cfg(feature = "real-browser")]
async fn ingest_card(ctx: &IngestContext<'_>, card: &JobCard, url: &str) -> Result<bool, String> {
    let canonical = canonicalize(url);
    let dedupe = check_dedupe(ctx.db, ctx.profile_id, ctx.platform, &canonical)
        .await
        .map_err(|e| e.to_string())?;
    let is_duplicate = matches!(dedupe, DedupeOutcome::Duplicate { .. });
    let status = if is_duplicate {
        "skipped_duplicate_url"
    } else {
        "discovered"
    };
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let remote_mode = card_remote_mode(card, ctx.platform, ctx.remote_fallback);
    sqlx::query(INSERT_JOB_POST_SQL)
        .bind(&id)
        .bind(ctx.profile_id)
        .bind(ctx.platform)
        .bind(&card.job_id)
        .bind(url)
        .bind(&canonical)
        .bind(card.title.as_deref().unwrap_or(""))
        .bind(card.company.as_deref().unwrap_or(""))
        .bind(&card.location)
        .bind(remote_mode)
        .bind(card.description.as_deref().unwrap_or(""))
        .bind::<Option<String>>(None)
        .bind::<Option<i64>>(None)
        .bind::<Option<i64>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind(&now)
        .bind(ctx.source)
        .bind(ctx.search_query_id)
        .bind(status)
        .bind(if ctx.extract_contact_email {
            extract_email(card.description.as_deref().unwrap_or(""))
        } else {
            None
        })
        .execute(ctx.db)
        .await
        .map_err(|e| e.to_string())?;
    if !is_duplicate {
        emit_job_found(ctx.app, ctx.db, ctx.profile_id, &id).await;
    }
    Ok(is_duplicate)
}

#[cfg(feature = "real-browser")]
fn card_remote_mode(card: &JobCard, platform: &str, fallback: bool) -> Option<String> {
    let haystack = match platform {
        "indeed" => format!(
            "{} {}",
            card.title.as_deref().unwrap_or(""),
            card.location.as_deref().unwrap_or("")
        ),
        "linkedin" => format!(
            "{} {} {}",
            card.title.as_deref().unwrap_or(""),
            card.location.as_deref().unwrap_or(""),
            card.description.as_deref().unwrap_or("")
        ),
        _ => format!(
            "{} {}",
            card.title.as_deref().unwrap_or(""),
            card.description.as_deref().unwrap_or("")
        ),
    };
    crate::matching::scorer::classify_work_model(&haystack.to_lowercase())
        .map(str::to_string)
        .or_else(|| fallback.then_some("remote".to_string()))
}

#[path = "scrapers_apply.rs"]
mod scrapers_apply;
#[path = "scrapers_boards.rs"]
mod scrapers_boards;
#[path = "scrapers_login.rs"]
mod scrapers_login;
#[path = "scrapers_network.rs"]
mod scrapers_network;
#[path = "scrapers_platform.rs"]
mod scrapers_platform;

pub use scrapers_apply::*;
pub use scrapers_boards::*;
pub use scrapers_login::*;
pub use scrapers_network::*;
pub use scrapers_platform::*;
