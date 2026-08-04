use super::*;
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

#[allow(clippy::too_many_arguments)] // IPC arg list is the frontend contract
#[tauri::command]
pub async fn run_indeed_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    location: Option<String>,
    remote_only: Option<bool>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let user_data_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "linkedin_search",
            global,
        )
        .await;
        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "indeed".into(),
                user_data_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let loc = location.unwrap_or_else(|| "Brasil".to_string());
        let remote = remote_only.unwrap_or(false);
        let max = max_pages.unwrap_or(3);

        let outcome: Result<LinkedInSearchResult, String> = async {
            let mut ingested = 0u32;
            let mut skipped_duplicates = 0u32;
            let mut pages_scraped = 0u32;
            let mut has_next = false;

            for page in 0..max {
                let raw = state
                    .playwright
                    .search_indeed_jobs(&handle, &keywords, &loc, page, remote)
                    .await
                    .map_err(|e| e.to_string())?;
                has_next = raw.has_next_page;
                pages_scraped += 1;

                for card in &raw.jobs {
                    let url = match &card.apply_url {
                        Some(u) if !u.is_empty() => u.clone(),
                        _ => continue,
                    };
                    let canonical = canonicalize(&url);
                    let dedupe = check_dedupe(&state.db, &profile_id, "indeed", &canonical)
                        .await
                        .map_err(|e| e.to_string())?;
                    let (is_dup, status) = match &dedupe {
                        DedupeOutcome::Unique => (false, "discovered"),
                        DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
                    };

                    let hay = format!(
                        "{} {}",
                        card.title.as_deref().unwrap_or(""),
                        card.location.as_deref().unwrap_or("")
                    )
                    .to_lowercase();
                    let remote_mode: Option<&str> =
                        crate::matching::scorer::classify_work_model(&hay)
                            .or_else(|| remote.then_some("remote"));

                    let id = Uuid::new_v4().to_string();
                    let now = now_iso();
                    sqlx::query(INSERT_JOB_POST_SQL)
                        .bind(&id)
                        .bind(&profile_id)
                        .bind("indeed")
                        .bind(&card.job_id)
                        .bind(&url)
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
                        .bind("indeed_search")
                        .bind(&search_query_id)
                        .bind(status)
                        .bind::<Option<String>>(None)
                        .execute(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;

                    if is_dup {
                        skipped_duplicates += 1;
                    } else {
                        ingested += 1;
                        emit_job_found(&app, &state.db, &profile_id, &id).await;
                    }
                }

                if raw.jobs.is_empty() || !raw.has_next_page {
                    break;
                }
            }

            Ok(LinkedInSearchResult {
                ingested,
                skipped_duplicates,
                has_next_page: has_next,
                pages_scraped,
            })
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            keywords,
            location,
            remote_only,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[allow(clippy::too_many_arguments)] // IPC arg list is the frontend contract
#[tauri::command]
pub async fn run_catho_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    area_ids: Option<Vec<i64>>,
    work_models: Option<Vec<String>>,
    last_days: Option<i64>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "catho_search",
            global,
        )
        .await;

        let result = state
            .playwright
            .search_catho_jobs(
                &dir,
                &query,
                &area_ids.unwrap_or_default(),
                &work_models.unwrap_or_default(),
                last_days,
                max_pages.unwrap_or(3),
                headless,
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        for card in &result.jobs {
            let url = match &card.apply_url {
                Some(u) if !u.is_empty() => u.clone(),
                _ => continue,
            };
            let canonical = canonicalize(&url);
            let dedupe = check_dedupe(&state.db, &profile_id, "catho", &canonical)
                .await
                .map_err(|e| e.to_string())?;
            let (is_dup, status) = match &dedupe {
                DedupeOutcome::Unique => (false, "discovered"),
                DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
            };

            let id = Uuid::new_v4().to_string();
            let now = now_iso();

            let hay = format!(
                "{} {}",
                card.title.as_deref().unwrap_or(""),
                card.description.as_deref().unwrap_or("")
            )
            .to_lowercase();
            let remote_mode = crate::matching::scorer::classify_work_model(&hay);

            sqlx::query(INSERT_JOB_POST_SQL)
                .bind(&id)
                .bind(&profile_id)
                .bind("catho")
                .bind(&card.job_id)
                .bind(&url)
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
                .bind("catho_search")
                .bind(&search_query_id)
                .bind(status)
                .bind::<Option<String>>(None)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

            if is_dup {
                skipped_duplicates += 1;
            } else {
                ingested += 1;
                emit_job_found(&app, &state.db, &profile_id, &id).await;
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            query,
            area_ids,
            work_models,
            last_days,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_upwork_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    sort: Option<String>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "upwork_search",
            global,
        )
        .await;

        let result = state
            .playwright
            .search_upwork_jobs(
                &dir,
                &query,
                sort.as_deref().unwrap_or("recency"),
                max_pages.unwrap_or(3),
                headless,
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        for card in &result.jobs {
            let url = match &card.apply_url {
                Some(u) if !u.is_empty() => u.clone(),
                _ => continue,
            };
            let canonical = canonicalize(&url);
            let dedupe = check_dedupe(&state.db, &profile_id, "upwork", &canonical)
                .await
                .map_err(|e| e.to_string())?;
            let (is_dup, status) = match &dedupe {
                DedupeOutcome::Unique => (false, "discovered"),
                DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
            };

            let id = Uuid::new_v4().to_string();
            let now = now_iso();

            let hay = format!(
                "{} {}",
                card.title.as_deref().unwrap_or(""),
                card.description.as_deref().unwrap_or("")
            )
            .to_lowercase();
            let remote_mode = crate::matching::scorer::classify_work_model(&hay).or(Some("remote"));

            sqlx::query(INSERT_JOB_POST_SQL)
                .bind(&id)
                .bind(&profile_id)
                .bind("upwork")
                .bind(&card.job_id)
                .bind(&url)
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
                .bind("upwork_search")
                .bind(&search_query_id)
                .bind(status)
                .bind::<Option<String>>(None)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

            if is_dup {
                skipped_duplicates += 1;
            } else {
                ingested += 1;
                emit_job_found(&app, &state.db, &profile_id, &id).await;
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            query,
            sort,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_freelas99_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "freelas99_search",
            global,
        )
        .await;

        let result = state
            .playwright
            .search_freelas99_jobs(&dir, &query, max_pages.unwrap_or(3), headless)
            .await
            .map_err(|e| e.to_string())?;

        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        for card in &result.jobs {
            let url = match &card.apply_url {
                Some(u) if !u.is_empty() => u.clone(),
                _ => continue,
            };
            let canonical = canonicalize(&url);
            let dedupe = check_dedupe(&state.db, &profile_id, "99freelas", &canonical)
                .await
                .map_err(|e| e.to_string())?;
            let (is_dup, status) = match &dedupe {
                DedupeOutcome::Unique => (false, "discovered"),
                DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
            };

            let id = Uuid::new_v4().to_string();
            let now = now_iso();

            let hay = format!(
                "{} {}",
                card.title.as_deref().unwrap_or(""),
                card.description.as_deref().unwrap_or("")
            )
            .to_lowercase();
            let remote_mode = crate::matching::scorer::classify_work_model(&hay);

            sqlx::query(INSERT_JOB_POST_SQL)
                .bind(&id)
                .bind(&profile_id)
                .bind("99freelas")
                .bind(&card.job_id)
                .bind(&url)
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
                .bind("freelas99_search")
                .bind(&search_query_id)
                .bind(status)
                .bind::<Option<String>>(None)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

            if is_dup {
                skipped_duplicates += 1;
            } else {
                ingested += 1;
                emit_job_found(&app, &state.db, &profile_id, &id).await;
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[allow(clippy::too_many_arguments)] // IPC arg list is the frontend contract
#[tauri::command]
pub async fn run_infojobs_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    location: Option<String>,
    work_models: Option<Vec<String>>,
    last_days: Option<i64>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "infojobs_search",
            global,
        )
        .await;

        let result = state
            .playwright
            .search_infojobs_jobs(
                &dir,
                &query,
                location.as_deref().unwrap_or(""),
                &work_models.unwrap_or_default(),
                last_days,
                max_pages.unwrap_or(3),
                headless,
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        for card in &result.jobs {
            let url = match &card.apply_url {
                Some(u) if !u.is_empty() => u.clone(),
                _ => continue,
            };
            let canonical = canonicalize(&url);
            let dedupe = check_dedupe(&state.db, &profile_id, "infojobs", &canonical)
                .await
                .map_err(|e| e.to_string())?;
            let (is_dup, status) = match &dedupe {
                DedupeOutcome::Unique => (false, "discovered"),
                DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
            };

            let id = Uuid::new_v4().to_string();
            let now = now_iso();

            let hay = format!(
                "{} {}",
                card.title.as_deref().unwrap_or(""),
                card.description.as_deref().unwrap_or("")
            )
            .to_lowercase();
            let remote_mode = crate::matching::scorer::classify_work_model(&hay);

            sqlx::query(INSERT_JOB_POST_SQL)
                .bind(&id)
                .bind(&profile_id)
                .bind("infojobs")
                .bind(&card.job_id)
                .bind(&url)
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
                .bind("infojobs_search")
                .bind(&search_query_id)
                .bind(status)
                .bind::<Option<String>>(None)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

            if is_dup {
                skipped_duplicates += 1;
            } else {
                ingested += 1;
                emit_job_found(&app, &state.db, &profile_id, &id).await;
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            query,
            location,
            work_models,
            last_days,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_gupy_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    remote_only: Option<bool>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                exists.ne(&0).then_some(id)
            }
            None => None,
        };

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let global = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "gupy_search",
            global,
        )
        .await;

        let result = state
            .playwright
            .search_gupy_jobs(
                &dir,
                &query,
                remote_only.unwrap_or(false),
                max_pages.unwrap_or(3),
                headless,
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        for card in &result.jobs {
            let url = match &card.apply_url {
                Some(u) if !u.is_empty() => u.clone(),
                _ => continue,
            };
            let canonical = canonicalize(&url);
            let dedupe = check_dedupe(&state.db, &profile_id, "gupy", &canonical)
                .await
                .map_err(|e| e.to_string())?;
            let (is_dup, status) = match &dedupe {
                DedupeOutcome::Unique => (false, "discovered"),
                DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
            };

            let id = Uuid::new_v4().to_string();
            let now = now_iso();

            let hay = format!(
                "{} {}",
                card.title.as_deref().unwrap_or(""),
                card.description.as_deref().unwrap_or("")
            )
            .to_lowercase();
            let remote_mode = crate::matching::scorer::classify_work_model(&hay);

            sqlx::query(INSERT_JOB_POST_SQL)
                .bind(&id)
                .bind(&profile_id)
                .bind("gupy")
                .bind(&card.job_id)
                .bind(&url)
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
                .bind("gupy_search")
                .bind(&search_query_id)
                .bind(status)
                .bind::<Option<String>>(None)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

            if is_dup {
                skipped_duplicates += 1;
            } else {
                ingested += 1;
                emit_job_found(&app, &state.db, &profile_id, &id).await;
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            query,
            remote_only,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn catho_apply(
    state: State<'_, AppState>,
    profile_id: String,
    offer_id: String,
    apply_url: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "catho_apply", false)
                .await;
        state
            .playwright
            .catho_apply(&dir, &offer_id, &apply_url, headless)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, offer_id, apply_url);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn infojobs_apply(
    state: State<'_, AppState>,
    profile_id: String,
    offer_id: String,
    apply_url: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "infojobs_apply",
            false,
        )
        .await;

        // Phase 1: apply. If InfoJobs blocks on a killer-questions form, the worker returns the
        // questions instead of submitting.
        let first = state
            .playwright
            .infojobs_apply(&dir, &offer_id, &apply_url, None, headless)
            .await
            .map_err(|e| e.to_string())?;

        if first.get("status").and_then(serde_json::Value::as_str) != Some("needs_answers") {
            return Ok(first);
        }
        let questions = match first.get("questions").and_then(|v| v.as_array()) {
            Some(q) if !q.is_empty() => q.clone(),
            _ => return Ok(first),
        };

        // Reuse the SAME AI form-answering the LinkedIn Easy Apply flow uses: draft answers from
        // the CV/profile, then refill + submit. If the AI can't answer, return the questions so
        // the (visible) window stays parked for a human.
        match crate::domain::automation::generate_form_answers(&state.db, &profile_id, &questions)
            .await
        {
            Ok((answers, _needs_human)) if !answers.is_empty() => {
                let answers = serde_json::Value::Object(answers);
                state
                    .playwright
                    .infojobs_apply(&dir, &offer_id, &apply_url, Some(&answers), headless)
                    .await
                    .map_err(|e| e.to_string())
            }
            _ => Ok(first),
        }
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, offer_id, apply_url);
        Err("real-browser feature not enabled".to_string())
    }
}

#[allow(clippy::too_many_arguments)] // IPC arg list is the frontend contract
#[tauri::command]
pub async fn run_linkedin_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    location: Option<String>,
    page_index: Option<u32>,
    easy_apply_only: Option<bool>,
    remote_only: Option<bool>,
    date_posted: Option<String>,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SearchJobsInput, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                if exists != 0 {
                    Some(id)
                } else {
                    tracing::warn!(search_query_id = %id, "run_linkedin_search: search_query_id not found, storing NULL");
                    None
                }
            }
            None => None,
        };

        let linkedin_profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "linkedin_search",
            global_headless,
        )
        .await;

        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "linkedin".into(),
                user_data_dir: linkedin_profile_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let start_page = page_index.unwrap_or(0);
        let max = max_pages.unwrap_or(40).min(40);
        let base_input = (
            keywords,
            location.unwrap_or_default(),
            easy_apply_only.unwrap_or(true),
            remote_only.unwrap_or(false),
            date_posted,
        );

        let mut words: Vec<String> = Vec::new();
        for tok in base_input
            .0
            .replace(['(', ')', '"'], " ")
            .split_whitespace()
        {
            if matches!(tok.to_ascii_uppercase().as_str(), "AND" | "OR" | "NOT") {
                continue;
            }
            if !words.iter().any(|w| w.eq_ignore_ascii_case(tok)) {
                words.push(tok.to_string());
            }
        }
        let mut variants: Vec<String> = vec![base_input.0.clone()];
        if words.len() > 1 {
            variants.push(
                words
                    .iter()
                    .map(|w| format!("\"{w}\""))
                    .collect::<Vec<_>>()
                    .join(" AND "),
            );
            for w in &words {
                variants.push(format!("\"{w}\""));
            }
        }
        variants.dedup();

        let outcome: Result<LinkedInSearchResult, String> = async {
            let mut ingested = 0u32;
            let mut skipped_duplicates = 0u32;
            let mut pages_scraped = 0u32;
            let mut has_next = false;

            for variant_kw in &variants {
                'pages: for page_offset in 0..max {
                    let page_input = SearchJobsInput {
                        keywords: variant_kw.clone(),
                        location: base_input.1.clone(),
                        page_index: start_page + page_offset,
                        easy_apply_only: base_input.2,
                        remote_only: base_input.3,
                        date_posted: base_input.4.clone(),
                    };

                    let raw = match state.playwright.search_jobs(&handle, &page_input).await {
                        Ok(v) => v,
                        Err(e) => {
                            state.playwright.close_session(&handle).await;
                            return Err(e.to_string());
                        }
                    };

                    has_next = raw.has_next_page;
                    pages_scraped += 1;

                    for card in &raw.jobs {
                        let url = match &card.apply_url {
                            Some(u) if !u.is_empty() => u.clone(),
                            _ => continue,
                        };
                        let canonical = canonicalize(&url);
                        let dedupe = check_dedupe(&state.db, &profile_id, "linkedin", &canonical)
                            .await
                            .map_err(|e| e.to_string())?;

                        let (is_dup, status) = match &dedupe {
                            DedupeOutcome::Unique => (false, "discovered"),
                            DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
                        };

                        let id = Uuid::new_v4().to_string();
                        let now = now_iso();

                        sqlx::query(INSERT_JOB_POST_SQL)
                            .bind(&id)
                            .bind(&profile_id)
                            .bind("linkedin")
                            .bind(&card.job_id)
                            .bind(&url)
                            .bind(&canonical)
                            .bind(card.title.as_deref().unwrap_or(""))
                            .bind(card.company.as_deref().unwrap_or(""))
                            .bind(&card.location)
                            .bind(
                                crate::matching::scorer::classify_work_model(&format!(
                                    "{} {} {}",
                                    card.title.as_deref().unwrap_or(""),
                                    card.location.as_deref().unwrap_or(""),
                                    card.description.as_deref().unwrap_or("")
                                ))
                                .map(str::to_string),
                            )
                            .bind(card.description.as_deref().unwrap_or(""))
                            .bind::<Option<String>>(None)
                            .bind::<Option<i64>>(None)
                            .bind::<Option<i64>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind(&now)
                            .bind("linkedin_search")
                            .bind(&search_query_id)
                            .bind(status)
                            .bind(extract_email(card.description.as_deref().unwrap_or("")))
                            .execute(&state.db)
                            .await
                            .map_err(|e| e.to_string())?;

                        if is_dup {
                            skipped_duplicates += 1;
                        } else {
                            ingested += 1;
                            emit_job_found(&app, &state.db, &profile_id, &id).await;
                        }
                    }

                    if raw.jobs.is_empty() {
                        break 'pages;
                    }
                }
            }

            Ok(LinkedInSearchResult {
                ingested,
                skipped_duplicates,
                has_next_page: has_next,
                pages_scraped,
            })
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (
            app,
            state,
            profile_id,
            search_query_id,
            keywords,
            location,
            page_index,
            easy_apply_only,
            remote_only,
            date_posted,
            max_pages,
        );
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_google_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                if exists != 0 {
                    Some(id)
                } else {
                    tracing::warn!(search_query_id = %id, "run_google_search: search_query_id not found, storing NULL");
                    None
                }
            }
            None => None,
        };

        let profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "google_search",
            global_headless,
        )
        .await;

        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "google".into(),
                user_data_dir: profile_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let max = max_pages.unwrap_or(10).min(20);

        let email_q = format!(
            r#"{query} ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "enviar currículo" OR "assunto")"#
        );
        let linkedin_posts_q = format!(
            r#"site:linkedin.com/posts {query} ("envie currículo" OR "@gmail.com" OR "talentos@")"#
        );

        let outcome: Result<LinkedInSearchResult, String> = async {
        let mut ingested = 0u32;
        let mut skipped_duplicates = 0u32;
        let mut pages_scraped = 0u32;
        let mut has_next = false;

        for q_str in [query.as_str(), email_q.as_str(), linkedin_posts_q.as_str()] {
            for page_index in 0..max {
                let raw = match state.playwright.search_google(&handle, q_str, page_index).await {
                    Ok(v) => v,
                    Err(e) => {
                        state.playwright.close_session(&handle).await;
                        return Err(e.to_string());
                    }
                };

                if raw.blocked {
                    state.playwright.close_session(&handle).await;
                    return Err(
                        "Google blocked the search (captcha / unusual traffic). Try again later or run headed."
                            .to_string(),
                    );
                }

                has_next = raw.has_next_page;
                pages_scraped += 1;

                for result in &raw.results {
                    let canonical = canonicalize(&result.url);
                    let dedupe = check_dedupe(&state.db, &profile_id, "google", &canonical)
                        .await
                        .map_err(|e| e.to_string())?;

                    let (is_dup, status) = match &dedupe {
                        DedupeOutcome::Unique => (false, "discovered"),
                        DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
                    };

                    let id = Uuid::new_v4().to_string();
                    let now = now_iso();
                    let contact_email = result
                        .email
                        .clone()
                        .or_else(|| extract_email(&result.snippet));

                    sqlx::query(
                        INSERT_JOB_POST_SQL,
                    )
                    .bind(&id)
                    .bind(&profile_id)
                    .bind("google")
                    .bind::<Option<String>>(None)
                    .bind(&result.url)
                    .bind(&canonical)
                    .bind(&result.title)
                    .bind("")
                    .bind::<Option<String>>(None)
                    .bind::<Option<String>>(None)
                    .bind(&result.snippet)
                    .bind::<Option<String>>(None)
                    .bind::<Option<i64>>(None)
                    .bind::<Option<i64>>(None)
                    .bind::<Option<String>>(None)
                    .bind::<Option<String>>(None)
                    .bind::<Option<String>>(None)
                    .bind::<Option<String>>(None)
                    .bind(&now)
                    .bind("google_dork")
                    .bind(&search_query_id)
                    .bind(status)
                    .bind(&contact_email)
                    .execute(&state.db)
                    .await
                    .map_err(|e| e.to_string())?;

                    if is_dup {
                        skipped_duplicates += 1;
                    } else {
                        ingested += 1;
                        emit_job_found(&app, &state.db, &profile_id, &id).await;
                    }
                }

                if raw.results.is_empty() || !raw.has_next_page {
                    break;
                }
            }
        }

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: has_next,
            pages_scraped,
        })
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_linkedin_posts_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let profile_exists: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)")
                .bind(&profile_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if profile_exists == 0 {
            return Err(format!(
                "unknown profile '{profile_id}' — select an active profile first"
            ));
        }

        let search_query_id: Option<String> = match search_query_id {
            Some(id) => {
                let exists: i64 =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_queries WHERE id = ?1)")
                        .bind(&id)
                        .fetch_one(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                if exists != 0 {
                    Some(id)
                } else {
                    tracing::warn!(search_query_id = %id, "run_linkedin_posts_search: search_query_id not found, storing NULL");
                    None
                }
            }
            None => None,
        };

        let profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "linkedin_posts",
            global_headless,
        )
        .await;

        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "linkedin".into(),
                user_data_dir: profile_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let max = max_pages.unwrap_or(1).min(2);

        let terms: Vec<String> = keywords
            .split([',', '|'])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let mut queries: Vec<String> = Vec::new();
        let first = terms.first().cloned();
        if let Some(role) = &first {
            let skills: Vec<&str> = terms.iter().skip(1).take(6).map(|s| s.as_str()).collect();
            if !skills.is_empty() {
                let joined = skills.join(" ");
                queries.push(format!("{role} vaga {joined}"));
                queries.push(format!("{role} {joined} hiring"));
            }
        }
        if let Some(role) = &first {
            for skill in terms.iter().skip(1).take(4) {
                queries.push(format!("{role} {skill} vaga"));
                queries.push(format!("{role} {skill} hiring"));
                queries.push(format!("{role} {skill} remoto"));
            }
        }
        for t in terms.iter().take(4) {
            queries.push(format!("{t} vaga"));
            queries.push(format!("{t} hiring"));
            queries.push(format!("{t} remoto"));
        }
        if let Some(role) = &first {
            queries.push(format!("{role} apply"));
            queries.push(format!("currículo {role}"));
            queries.push(format!("talentos {role}"));
        }
        queries.push("envie currículo".into());
        queries.dedup();
        queries.truncate(18);

        let outcome: Result<LinkedInSearchResult, String> = async {
            let mut ingested = 0u32;
            let mut skipped_duplicates = 0u32;
            let mut pages_scraped = 0u32;
            let mut has_next = false;

            for q in &queries {
                for page_index in 0..max {
                    let raw = match state
                        .playwright
                        .search_linkedin_posts(&handle, q, page_index)
                        .await
                    {
                        Ok(v) => v,
                        Err(e) => {
                            state.playwright.close_session(&handle).await;
                            return Err(e.to_string());
                        }
                    };

                    has_next = raw.has_next_page;
                    pages_scraped += 1;

                    for post in &raw.posts {
                        let url = match &post.url {
                            Some(u) if !u.is_empty() => u.clone(),
                            _ => {
                                use std::hash::{Hash, Hasher};
                                let mut h = std::collections::hash_map::DefaultHasher::new();
                                post.text.trim().hash(&mut h);
                                format!(
                                    "https://www.linkedin.com/feed/hiring-post/{:016x}",
                                    h.finish()
                                )
                            }
                        };
                        let canonical = canonicalize(&url);
                        let dedupe =
                            check_dedupe(&state.db, &profile_id, "linkedin_post", &canonical)
                                .await
                                .map_err(|e| e.to_string())?;

                        let (is_dup, status) = match &dedupe {
                            DedupeOutcome::Unique => (false, "discovered"),
                            DedupeOutcome::Duplicate { .. } => (true, "skipped_duplicate_url"),
                        };

                        let id = Uuid::new_v4().to_string();
                        let now = now_iso();

                        let title = {
                            let first_line = post.text.lines().next().unwrap_or("").trim();
                            if first_line.is_empty() {
                                format!("Post by {}", post.author.as_deref().unwrap_or("unknown"))
                            } else {
                                let end = first_line
                                    .char_indices()
                                    .nth(80)
                                    .map(|(i, _)| i)
                                    .unwrap_or(first_line.len());
                                first_line[..end].to_string()
                            }
                        };
                        let company = post.author.as_deref().unwrap_or("").to_string();
                        let contact_email =
                            post.email.clone().or_else(|| extract_email(&post.text));

                        sqlx::query(INSERT_JOB_POST_SQL)
                            .bind(&id)
                            .bind(&profile_id)
                            .bind("linkedin_post")
                            .bind::<Option<String>>(None)
                            .bind(&url)
                            .bind(&canonical)
                            .bind(&title)
                            .bind(&company)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind(&post.text)
                            .bind::<Option<String>>(None)
                            .bind::<Option<i64>>(None)
                            .bind::<Option<i64>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind::<Option<String>>(None)
                            .bind(&now)
                            .bind("linkedin_feed")
                            .bind(&search_query_id)
                            .bind(status)
                            .bind(&contact_email)
                            .execute(&state.db)
                            .await
                            .map_err(|e| e.to_string())?;

                        if is_dup {
                            skipped_duplicates += 1;
                        } else {
                            ingested += 1;
                            emit_job_found(&app, &state.db, &profile_id, &id).await;
                        }
                    }

                    if raw.posts.is_empty() {
                        break;
                    }
                }
            }

            Ok(LinkedInSearchResult {
                ingested,
                skipped_duplicates,
                has_next_page: has_next,
                pages_scraped,
            })
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state, profile_id, search_query_id, keywords, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn gmail_send_application(
    state: State<'_, AppState>,
    profile_id: String,
    to: String,
    subject: String,
    body: String,
    cv_document_id: Option<String>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let cv_path: Option<String> = if let Some(ref doc_id) = cv_document_id {
            sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                .bind(doc_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| e.to_string())?
        } else {
            None
        };

        let profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "gmail_send",
            global_headless,
        )
        .await;

        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "gmail".into(),
                user_data_dir: profile_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let outcome: Result<(), String> = async {
            state
                .playwright
                .gmail_send(&handle, &to, &subject, &body, cv_path.as_deref())
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, to, subject, body, cv_document_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn linkedin_job_login(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let linkedin_profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "linkedin".into(),
                user_data_dir: linkedin_profile_dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .navigate(&handle, "https://www.linkedin.com/login")
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn linkedin_job_login_status(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<bool, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        state
            .playwright
            .check_login(&dir)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}
