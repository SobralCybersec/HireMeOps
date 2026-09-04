use super::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    location: Option<String>,
    page_index: Option<u32>,
    easy_apply_only: Option<bool>,
    remote_only: Option<bool>,
    date_posted: Option<String>,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_linkedin_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: LinkedInSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        run_linkedin_search_real(state.inner(), &app, input).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let LinkedInSearchInput {
            profile_id,
            search_query_id,
            keywords,
            location,
            page_index,
            easy_apply_only,
            remote_only,
            date_posted,
            max_pages,
        } = input;
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

#[cfg(feature = "real-browser")]
struct LinkedInPageContext<'a> {
    state: &'a AppState,
    app: &'a AppHandle,
    handle: &'a str,
    profile_id: &'a str,
    search_query_id: &'a Option<String>,
    location: &'a str,
    easy_apply_only: bool,
    remote_only: bool,
    date_posted: Option<String>,
    start_page: u32,
    max_pages: u32,
    variants: &'a [String],
}

#[cfg(feature = "real-browser")]
fn linkedin_variants(keywords: &str) -> Vec<String> {
    let words: Vec<String> = keywords
        .replace(['(', ')', '"'], " ")
        .split_whitespace()
        .filter(|token| !matches!(token.to_ascii_uppercase().as_str(), "AND" | "OR" | "NOT"))
        .map(str::to_string)
        .fold(Vec::new(), |mut words, word| {
            if !words.iter().any(|item| item.eq_ignore_ascii_case(&word)) {
                words.push(word);
            }
            words
        });
    let mut variants = vec![keywords.to_string()];
    if words.len() > 1 {
        variants.push(
            words
                .iter()
                .map(|word| format!("\"{word}\""))
                .collect::<Vec<_>>()
                .join(" AND "),
        );
        variants.extend(words.iter().map(|word| format!("\"{word}\"")));
    }
    variants.dedup();
    variants
}

#[cfg(feature = "real-browser")]
async fn scrape_linkedin_pages(
    ctx: &LinkedInPageContext<'_>,
) -> Result<LinkedInSearchResult, String> {
    use crate::domain::automation::{BrowserDriver, SearchJobsInput};

    let mut result = LinkedInSearchResult {
        ingested: 0,
        skipped_duplicates: 0,
        has_next_page: false,
        pages_scraped: 0,
    };
    for variant_kw in ctx.variants {
        'pages: for page_offset in 0..ctx.max_pages {
            let raw = ctx
                .state
                .playwright
                .search_jobs(
                    ctx.handle,
                    &SearchJobsInput {
                        keywords: variant_kw.clone(),
                        location: ctx.location.to_string(),
                        page_index: ctx.start_page + page_offset,
                        easy_apply_only: ctx.easy_apply_only,
                        remote_only: ctx.remote_only,
                        date_posted: ctx.date_posted.clone(),
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
            result.has_next_page = raw.has_next_page;
            result.pages_scraped += 1;
            let (new_count, duplicate_count) = ingest_cards(
                &IngestContext {
                    app: ctx.app,
                    db: &ctx.state.db,
                    profile_id: ctx.profile_id,
                    search_query_id: ctx.search_query_id,
                    platform: "linkedin",
                    source: "linkedin_search",
                    remote_fallback: false,
                    extract_contact_email: true,
                },
                &raw.jobs,
            )
            .await?;
            result.ingested += new_count;
            result.skipped_duplicates += duplicate_count;
            if raw.jobs.is_empty() {
                break 'pages;
            }
        }
    }
    Ok(result)
}

#[cfg(feature = "real-browser")]
async fn run_linkedin_search_real(
    state: &AppState,
    app: &AppHandle,
    input: LinkedInSearchInput,
) -> Result<LinkedInSearchResult, String> {
    use crate::domain::automation::{BrowserDriver, SessionSpec};
    use crate::storage::paths::automation_profile_dir;

    let LinkedInSearchInput {
        profile_id,
        search_query_id,
        keywords,
        location,
        page_index,
        easy_apply_only,
        remote_only,
        date_posted,
        max_pages,
    } = input;
    let search_query_id = validated_search_query(&state.db, &profile_id, search_query_id).await?;
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
    let location = location.unwrap_or_default();
    let easy_apply_only = easy_apply_only.unwrap_or(true);
    let remote_only = remote_only.unwrap_or(false);
    let max_pages = max_pages.unwrap_or(40).min(40);
    let result = scrape_linkedin_pages(&LinkedInPageContext {
        state,
        app,
        handle: &handle,
        profile_id: &profile_id,
        search_query_id: &search_query_id,
        location: &location,
        easy_apply_only,
        remote_only,
        date_posted,
        start_page: page_index.unwrap_or(0),
        max_pages,
        variants: &linkedin_variants(&keywords),
    })
    .await;
    state.playwright.close_session(&handle).await;
    result
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    query: String,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_google_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: GoogleSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        run_google_search_real(state.inner(), &app, input).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let GoogleSearchInput {
            profile_id,
            search_query_id,
            query,
            max_pages,
        } = input;
        let _ = (app, state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(feature = "real-browser")]
struct GooglePageContext<'a> {
    state: &'a AppState,
    app: &'a AppHandle,
    handle: &'a str,
    profile_id: &'a str,
    search_query_id: &'a Option<String>,
    queries: &'a [String],
    max_pages: u32,
}

#[cfg(feature = "real-browser")]
fn google_queries(query: &str) -> Vec<String> {
    vec![
        query.to_string(),
        format!(
            r#"{query} ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "enviar currículo" OR "assunto")"#
        ),
        format!(
            r#"site:linkedin.com/posts {query} ("envie currículo" OR "@gmail.com" OR "talentos@")"#
        ),
    ]
}

#[cfg(feature = "real-browser")]
async fn insert_google_result(
    ctx: &GooglePageContext<'_>,
    result: &crate::domain::automation::GoogleResult,
) -> Result<bool, String> {
    let canonical = canonicalize(&result.url);
    let dedupe = check_dedupe(&ctx.state.db, ctx.profile_id, "google", &canonical)
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
    let contact_email = result
        .email
        .clone()
        .or_else(|| extract_email(&result.snippet));
    sqlx::query(INSERT_JOB_POST_SQL)
        .bind(&id)
        .bind(ctx.profile_id)
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
        .bind(ctx.search_query_id)
        .bind(status)
        .bind(&contact_email)
        .execute(&ctx.state.db)
        .await
        .map_err(|e| e.to_string())?;
    if !is_duplicate {
        emit_job_found(ctx.app, &ctx.state.db, ctx.profile_id, &id).await;
    }
    Ok(is_duplicate)
}

#[cfg(feature = "real-browser")]
async fn scrape_google_pages(ctx: &GooglePageContext<'_>) -> Result<LinkedInSearchResult, String> {
    let mut result = LinkedInSearchResult {
        ingested: 0,
        skipped_duplicates: 0,
        has_next_page: false,
        pages_scraped: 0,
    };
    for query in ctx.queries {
        for page_index in 0..ctx.max_pages {
            let raw = ctx
                .state
                .playwright
                .search_google(ctx.handle, query, page_index)
                .await
                .map_err(|e| e.to_string())?;
            if raw.blocked {
                return Err(
                    "Google blocked the search (captcha / unusual traffic). Try again later or run headed."
                        .to_string(),
                );
            }
            result.has_next_page = raw.has_next_page;
            result.pages_scraped += 1;
            for item in &raw.results {
                if insert_google_result(ctx, item).await? {
                    result.skipped_duplicates += 1;
                } else {
                    result.ingested += 1;
                }
            }
            if raw.results.is_empty() || !raw.has_next_page {
                break;
            }
        }
    }
    Ok(result)
}

#[cfg(feature = "real-browser")]
async fn run_google_search_real(
    state: &AppState,
    app: &AppHandle,
    input: GoogleSearchInput,
) -> Result<LinkedInSearchResult, String> {
    use crate::domain::automation::{BrowserDriver, SessionSpec};

    let GoogleSearchInput {
        profile_id,
        search_query_id,
        query,
        max_pages,
    } = input;
    let search_query_id = validated_search_query(&state.db, &profile_id, search_query_id).await?;
    let (profile_dir, headless) = search_runtime(state, &profile_id, "google_search").await;
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
    let queries = google_queries(&query);
    let result = scrape_google_pages(&GooglePageContext {
        state,
        app,
        handle: &handle,
        profile_id: &profile_id,
        search_query_id: &search_query_id,
        queries: &queries,
        max_pages: max_pages.unwrap_or(10).min(20),
    })
    .await;
    state.playwright.close_session(&handle).await;
    result
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInPostsSearchInput {
    profile_id: String,
    search_query_id: Option<String>,
    keywords: String,
    max_pages: Option<u32>,
}

#[tauri::command]
pub async fn run_linkedin_posts_search(
    state: State<'_, AppState>,
    app: AppHandle,
    input: LinkedInPostsSearchInput,
) -> Result<LinkedInSearchResult, String> {
    #[cfg(feature = "real-browser")]
    {
        run_linkedin_posts_search_real(state.inner(), &app, input).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let LinkedInPostsSearchInput {
            profile_id,
            search_query_id,
            keywords,
            max_pages,
        } = input;
        let _ = (app, state, profile_id, search_query_id, keywords, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(feature = "real-browser")]
struct LinkedInPostsPageContext<'a> {
    state: &'a AppState,
    app: &'a AppHandle,
    handle: &'a str,
    profile_id: &'a str,
    search_query_id: &'a Option<String>,
    queries: &'a [String],
    max_pages: u32,
}

#[cfg(feature = "real-browser")]
fn linkedin_post_queries(keywords: &str) -> Vec<String> {
    let terms: Vec<String> = keywords
        .split([',', '|'])
        .map(|term| term.trim().to_string())
        .filter(|term| !term.is_empty())
        .collect();
    let mut queries = Vec::new();
    let first = terms.first().cloned();
    if let Some(role) = &first {
        let skills: Vec<&str> = terms.iter().skip(1).take(6).map(String::as_str).collect();
        if !skills.is_empty() {
            let joined = skills.join(" ");
            queries.push(format!("{role} vaga {joined}"));
            queries.push(format!("{role} {joined} hiring"));
        }
    }
    if let Some(role) = &first {
        for skill in terms.iter().skip(1).take(4) {
            queries.extend([
                format!("{role} {skill} vaga"),
                format!("{role} {skill} hiring"),
                format!("{role} {skill} remoto"),
            ]);
        }
    }
    for term in terms.iter().take(4) {
        queries.extend([
            format!("{term} vaga"),
            format!("{term} hiring"),
            format!("{term} remoto"),
        ]);
    }
    if let Some(role) = &first {
        queries.extend([
            format!("{role} apply"),
            format!("currículo {role}"),
            format!("talentos {role}"),
        ]);
    }
    queries.push("envie currículo".into());
    queries.dedup();
    queries.truncate(18);
    queries
}

#[cfg(feature = "real-browser")]
fn linkedin_post_url(post: &crate::domain::automation::LinkedInPost) -> String {
    if let Some(url) = post.url.as_deref().filter(|url| !url.is_empty()) {
        return url.to_string();
    }
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    post.text.trim().hash(&mut hasher);
    format!(
        "https://www.linkedin.com/feed/hiring-post/{:016x}",
        hasher.finish()
    )
}

#[cfg(feature = "real-browser")]
fn linkedin_post_title(post: &crate::domain::automation::LinkedInPost) -> String {
    let first_line = post.text.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return format!("Post by {}", post.author.as_deref().unwrap_or("unknown"));
    }
    let end = first_line
        .char_indices()
        .nth(80)
        .map(|(index, _)| index)
        .unwrap_or(first_line.len());
    first_line[..end].to_string()
}

#[cfg(feature = "real-browser")]
async fn insert_linkedin_post(
    ctx: &LinkedInPostsPageContext<'_>,
    post: &crate::domain::automation::LinkedInPost,
) -> Result<bool, String> {
    let url = linkedin_post_url(post);
    let canonical = canonicalize(&url);
    let dedupe = check_dedupe(&ctx.state.db, ctx.profile_id, "linkedin_post", &canonical)
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
    let title = linkedin_post_title(post);
    let company = post.author.as_deref().unwrap_or("");
    let contact_email = post.email.clone().or_else(|| extract_email(&post.text));
    sqlx::query(INSERT_JOB_POST_SQL)
        .bind(&id)
        .bind(ctx.profile_id)
        .bind("linkedin_post")
        .bind::<Option<String>>(None)
        .bind(&url)
        .bind(&canonical)
        .bind(&title)
        .bind(company)
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
        .bind(ctx.search_query_id)
        .bind(status)
        .bind(&contact_email)
        .execute(&ctx.state.db)
        .await
        .map_err(|e| e.to_string())?;
    if !is_duplicate {
        emit_job_found(ctx.app, &ctx.state.db, ctx.profile_id, &id).await;
    }
    Ok(is_duplicate)
}

#[cfg(feature = "real-browser")]
async fn scrape_linkedin_posts_pages(
    ctx: &LinkedInPostsPageContext<'_>,
) -> Result<LinkedInSearchResult, String> {
    let mut result = LinkedInSearchResult {
        ingested: 0,
        skipped_duplicates: 0,
        has_next_page: false,
        pages_scraped: 0,
    };
    for query in ctx.queries {
        for page_index in 0..ctx.max_pages {
            let raw = ctx
                .state
                .playwright
                .search_linkedin_posts(ctx.handle, query, page_index)
                .await
                .map_err(|e| e.to_string())?;
            result.has_next_page = raw.has_next_page;
            result.pages_scraped += 1;
            for post in &raw.posts {
                if insert_linkedin_post(ctx, post).await? {
                    result.skipped_duplicates += 1;
                } else {
                    result.ingested += 1;
                }
            }
            if raw.posts.is_empty() {
                break;
            }
        }
    }
    Ok(result)
}

#[cfg(feature = "real-browser")]
async fn run_linkedin_posts_search_real(
    state: &AppState,
    app: &AppHandle,
    input: LinkedInPostsSearchInput,
) -> Result<LinkedInSearchResult, String> {
    use crate::domain::automation::{BrowserDriver, SessionSpec};

    let LinkedInPostsSearchInput {
        profile_id,
        search_query_id,
        keywords,
        max_pages,
    } = input;
    let search_query_id = validated_search_query(&state.db, &profile_id, search_query_id).await?;
    let (profile_dir, headless) = search_runtime(state, &profile_id, "linkedin_posts").await;
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
    let queries = linkedin_post_queries(&keywords);
    let result = scrape_linkedin_posts_pages(&LinkedInPostsPageContext {
        state,
        app,
        handle: &handle,
        profile_id: &profile_id,
        search_query_id: &search_query_id,
        queries: &queries,
        max_pages: max_pages.unwrap_or(1).min(2),
    })
    .await;
    state.playwright.close_session(&handle).await;
    result
}
