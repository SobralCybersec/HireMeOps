use super::*;

/// Scrape GeekHunter (geekhunter.com.br/pt/vagas), a Brazilian tech-jobs SPA.
/// View-only (no apply). `remote_only` maps to the `workModality=remote` facet;
/// cards hydrate client-side so the worker waits for them before scraping.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeekhunterSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    remote_only: Option<bool>,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_geekhunter_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: GeekhunterSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let GeekhunterSearchInput {
            profile_id,
            search_query_id,
            query,
            remote_only,
            max_pages,
        } = input;
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "geekhunter_search").await;

        let result = state
            .playwright
            .search_geekhunter_jobs(
                &dir,
                &query,
                remote_only.unwrap_or(false),
                max_pages.unwrap_or(5),
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
                platform: "geekhunter",
                source: "geekhunter_search",
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
        let GeekhunterSearchInput {
            profile_id,
            search_query_id,
            query,
            remote_only,
            max_pages,
        } = input;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfojobsSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    location: Option<String>,
    work_models: Option<Vec<String>>,
    last_days: Option<i64>,
    max_pages: Option<u32>,
}

#[cfg(not(feature = "real-browser"))]
impl InfojobsSearchInput {
    fn discard(self) {
        let Self {
            profile_id,
            search_query_id,
            query,
            location,
            work_models,
            last_days,
            max_pages,
        } = self;
        let _ = (
            profile_id,
            search_query_id,
            query,
            location,
            work_models,
            last_days,
            max_pages,
        );
    }
}

#[tauri::command]
pub async fn run_infojobs_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: InfojobsSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let InfojobsSearchInput {
            profile_id,
            search_query_id,
            query,
            location,
            work_models,
            last_days,
            max_pages,
        } = input;
        use crate::browser::playwright::InfojobsSearchOptions;
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "infojobs_search").await;
        let work_models = work_models.unwrap_or_default();

        let result = state
            .playwright
            .search_infojobs_jobs(InfojobsSearchOptions {
                user_data_dir: &dir,
                query: &query,
                location: location.as_deref().unwrap_or(""),
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
                platform: "infojobs",
                source: "infojobs_search",
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
pub struct GupySearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    remote_only: Option<bool>,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_gupy_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: GupySearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        let GupySearchInput {
            profile_id,
            search_query_id,
            query,
            remote_only,
            max_pages,
        } = input;
        let search_query_id =
            validated_search_query(&state.db, &profile_id, search_query_id).await?;
        let (dir, headless) = search_runtime(&state, &profile_id, "gupy_search").await;

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

        let (ingested, skipped_duplicates) = ingest_cards(
            &IngestContext {
                app: &app,
                db: &state.db,
                profile_id: &profile_id,
                search_query_id: &search_query_id,
                platform: "gupy",
                source: "gupy_search",
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
        let GupySearchInput {
            profile_id,
            search_query_id,
            query,
            remote_only,
            max_pages,
        } = input;
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
