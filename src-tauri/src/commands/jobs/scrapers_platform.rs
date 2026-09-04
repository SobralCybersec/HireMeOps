use super::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndeedSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    location: Option<String>,
    remote_only: Option<bool>,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_indeed_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: IndeedSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let IndeedSearchInput {
            profile_id,
            search_query_id,
            keywords,
            location,
            remote_only,
            max_pages,
        } = input;
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (user_data_dir, headless) =
            search_runtime(&state, &profile_id, "linkedin_search").await;
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

        let outcome = search_indeed_pages(&IndeedSearchContext {
            state: &state,
            app: &app,
            handle: &handle,
            profile_id: &profile_id,
            search_query_id: &search_query_id,
            keywords: &keywords,
            location: &loc,
            remote,
            max,
        })
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let IndeedSearchInput {
            profile_id,
            search_query_id,
            keywords,
            location,
            remote_only,
            max_pages,
        } = input;
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

#[cfg(feature = "real-browser")]
struct IndeedSearchContext<'a> {
    state: &'a AppState,
    app: &'a AppHandle,
    handle: &'a str,
    profile_id: &'a str,
    search_query_id: &'a Option<String>,
    keywords: &'a str,
    location: &'a str,
    remote: bool,
    max: u32,
}

#[cfg(feature = "real-browser")]
async fn search_indeed_pages(
    ctx: &IndeedSearchContext<'_>,
) -> Result<LinkedInSearchResult, String> {
    let mut ingested = 0;
    let mut skipped_duplicates = 0;
    let mut pages_scraped = 0;
    let mut has_next = false;
    for page in 0..ctx.max {
        let raw = ctx
            .state
            .playwright
            .search_indeed_jobs(ctx.handle, ctx.keywords, ctx.location, page, ctx.remote)
            .await
            .map_err(|e| e.to_string())?;
        has_next = raw.has_next_page;
        pages_scraped += 1;
        let (new_count, duplicate_count) = ingest_cards(
            &IngestContext {
                app: ctx.app,
                db: &ctx.state.db,
                profile_id: ctx.profile_id,
                search_query_id: ctx.search_query_id,
                platform: "indeed",
                source: "indeed_search",
                remote_fallback: ctx.remote,
                extract_contact_email: false,
            },
            &raw.jobs,
        )
        .await?;
        ingested += new_count;
        skipped_duplicates += duplicate_count;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CathoSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    area_ids: Option<Vec<i64>>,
    work_models: Option<Vec<String>>,
    last_days: Option<i64>,
    max_pages: Option<u32>,
}

#[cfg(not(feature = "real-browser"))]
impl CathoSearchInput {
    fn discard(self) {
        let Self {
            profile_id,
            search_query_id,
            query,
            area_ids,
            work_models,
            last_days,
            max_pages,
        } = self;
        let _ = (
            profile_id,
            search_query_id,
            query,
            area_ids,
            work_models,
            last_days,
            max_pages,
        );
    }
}

#[tauri::command]
pub async fn run_catho_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CathoSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let CathoSearchInput {
            profile_id,
            search_query_id,
            query,
            area_ids,
            work_models,
            last_days,
            max_pages,
        } = input;
        use crate::browser::playwright::CathoSearchOptions;
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "catho_search").await;
        let area_ids = area_ids.unwrap_or_default();
        let work_models = work_models.unwrap_or_default();

        let result = state
            .playwright
            .search_catho_jobs(CathoSearchOptions {
                user_data_dir: &dir,
                query: &query,
                area_ids: &area_ids,
                work_models: &work_models,
                last_days,
                max_pages: max_pages.unwrap_or(3),
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let (ingested, skipped_duplicates) = ingest_cards(
            &IngestContext {
                app: &app,
                db: &state.db,
                profile_id: &profile_id,
                search_query_id: &search_query_id,
                platform: "catho",
                source: "catho_search",
                remote_fallback: false,
                extract_contact_email: false,
            },
            &result.jobs,
        )
        .await?;

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        input.discard();
        let _ = (app, state);
        Err("real-browser feature not enabled".to_string())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpworkSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    sort: Option<String>,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_upwork_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: UpworkSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let UpworkSearchInput {
            profile_id,
            search_query_id,
            query,
            sort,
            max_pages,
        } = input;
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "upwork_search").await;

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

        let (ingested, skipped_duplicates) = ingest_cards(
            &IngestContext {
                app: &app,
                db: &state.db,
                profile_id: &profile_id,
                search_query_id: &search_query_id,
                platform: "upwork",
                source: "upwork_search",
                remote_fallback: true,
                extract_contact_email: false,
            },
            &result.jobs,
        )
        .await?;

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(3),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let UpworkSearchInput {
            profile_id,
            search_query_id,
            query,
            sort,
            max_pages,
        } = input;
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
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "freelas99_search").await;

        let result = state
            .playwright
            .search_freelas99_jobs(&dir, &query, max_pages.unwrap_or(3), headless)
            .await
            .map_err(|e| e.to_string())?;

        let (ingested, skipped_duplicates) = ingest_cards(
            &IngestContext {
                app: &app,
                db: &state.db,
                profile_id: &profile_id,
                search_query_id: &search_query_id,
                platform: "99freelas",
                source: "freelas99_search",
                remote_fallback: false,
                extract_contact_email: false,
            },
            &result.jobs,
        )
        .await?;

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

/// Scrape ProgramaThor (programathor.com.br/jobs), a curated Brazilian dev-jobs
/// board. View-only (no apply); server-rendered so no anti-bot dance. A query
/// that maps to a known skill narrows the list; otherwise the recent list is
/// ingested and the CV scorer filters it downstream.
#[tauri::command]
pub async fn run_programathor_search(
    state: State<'_, AppState>,
    app: AppHandle,
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    max_pages: Option<u32>,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "programathor_search").await;

        let result = state
            .playwright
            .search_programathor_jobs(&dir, &query, max_pages.unwrap_or(5), headless)
            .await
            .map_err(|e| e.to_string())?;

        let (ingested, skipped_duplicates) = ingest_cards(
            &IngestContext {
                app: &app,
                db: &state.db,
                profile_id: &profile_id,
                search_query_id: &search_query_id,
                platform: "programathor",
                source: "programathor_search",
                remote_fallback: false,
                extract_contact_email: false,
            },
            &result.jobs,
        )
        .await?;

        Ok(LinkedInSearchResult {
            ingested,
            skipped_duplicates,
            has_next_page: result.has_next_page,
            pages_scraped: max_pages.unwrap_or(5),
        })
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (app, state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}
