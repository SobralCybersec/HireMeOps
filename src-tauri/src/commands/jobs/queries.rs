use super::*;
use crate::domain::ids::{JobId, ProfileId};
use crate::domain::jobs::{fts_query, JobSearchService, JobSearchServiceImpl};
use crate::jobs::{build_queries, canonicalize, check_dedupe, DedupeOutcome, SearchQueryInput};
use crate::util::now_iso;
use crate::AppState;
use tauri::State;
use uuid::Uuid;

const DEFAULT_JOB_PAGE_SIZE: i64 = 50;
const MAX_JOB_PAGE_SIZE: i64 = 200;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListJobPostsInput {
    profile_id: String,
    status_filter: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    cursor_discovered_at: Option<String>,
    cursor_id: Option<String>,
    search: Option<String>,
}

const JOB_LIST_SELECT: &str = "SELECT id, profile_id, platform, external_id,
        url, canonical_url, title, company,
        location, remote_mode,
        substr(COALESCE(summary, description), 1, 320) AS description,
        substr(summary, 1, 320) AS summary,
        seniority, salary_min, salary_max, currency,
        employment_type, discovered_at, status,
        search_query_id, discovery_source, contact_email";

const JOB_SEARCH_SELECT: &str = "SELECT jp.id, jp.profile_id, jp.platform, jp.external_id,
        jp.url, jp.canonical_url, jp.title, jp.company,
        jp.location, jp.remote_mode,
        substr(COALESCE(jp.summary, jp.description), 1, 320) AS description,
        substr(jp.summary, 1, 320) AS summary,
        jp.seniority, jp.salary_min, jp.salary_max, jp.currency,
        jp.employment_type, jp.discovered_at, jp.status,
        jp.search_query_id, jp.discovery_source, jp.contact_email";

#[tauri::command]
pub async fn list_job_preferences(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<JobPreferenceDto>, String> {
    sqlx::query_as::<_, PrefRow>(
        "SELECT id, profile_id, name, target_roles_json,
                seniority_json, locations_json, remote_modes_json,
                min_salary, salary_currency,
                required_skills_json, preferred_skills_json,
                excluded_keywords_json, blocked_companies_json,
                auto_apply_enabled, auto_submit_enabled,
                auto_submit_min_score, needs_review_confidence_threshold,
                retry_failed_enabled, retry_limit,
                daily_application_limit, daily_connection_limit,
                created_at, updated_at
         FROM job_preferences
         WHERE profile_id = ?1
         ORDER BY created_at ASC",
    )
    .bind(&profile_id)
    .fetch_all(&state.db)
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_job_preference(
    state: State<'_, AppState>,
    input: CreateJobPreferenceInput,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let auto_apply = input.auto_apply_enabled.unwrap_or(true) as i64;
    let auto_submit = input.auto_submit_enabled.unwrap_or(true) as i64;
    let min_score = input.auto_submit_min_score.unwrap_or(60);
    let review_threshold = input.needs_review_confidence_threshold.unwrap_or(50);
    let retry_enabled = input.retry_failed_enabled.unwrap_or(true) as i64;
    let retry_limit = input.retry_limit.unwrap_or(10);

    sqlx::query(
        "INSERT INTO job_preferences (
            id, profile_id, name, target_roles_json,
            seniority_json, locations_json, remote_modes_json,
            min_salary, salary_currency,
            required_skills_json, preferred_skills_json,
            excluded_keywords_json, blocked_companies_json,
            auto_apply_enabled, auto_submit_enabled,
            auto_submit_min_score, needs_review_confidence_threshold,
            retry_failed_enabled, retry_limit,
            daily_application_limit, daily_connection_limit,
            created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
        )",
    )
    .bind(&id)
    .bind(&input.profile_id)
    .bind(&input.name)
    .bind(&input.target_roles_json)
    .bind(&input.seniority_json)
    .bind(&input.locations_json)
    .bind(&input.remote_modes_json)
    .bind(input.min_salary)
    .bind(&input.salary_currency)
    .bind(&input.required_skills_json)
    .bind(&input.preferred_skills_json)
    .bind(&input.excluded_keywords_json)
    .bind(&input.blocked_companies_json)
    .bind(auto_apply)
    .bind(auto_submit)
    .bind(min_score)
    .bind(review_threshold)
    .bind(retry_enabled)
    .bind(retry_limit)
    .bind(input.daily_application_limit)
    .bind(input.daily_connection_limit)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn list_search_queries(
    state: State<'_, AppState>,
    profile_id: String,
    preference_id: Option<String>,
) -> Result<Vec<SearchQueryDto>, String> {
    let rows: Vec<SqRow> = if let Some(ref pref_id) = preference_id {
        sqlx::query_as::<_, SqRow>(
            "SELECT id, profile_id, preference_id, platform, query, query_type,
                    enabled, last_run_at, created_at
             FROM search_queries
             WHERE profile_id = ?1 AND preference_id = ?2
             ORDER BY created_at ASC",
        )
        .bind(&profile_id)
        .bind(pref_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, SqRow>(
            "SELECT id, profile_id, preference_id, platform, query, query_type,
                    enabled, last_run_at, created_at
             FROM search_queries
             WHERE profile_id = ?1
             ORDER BY created_at ASC",
        )
        .bind(&profile_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    };

    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn generate_search_queries(
    state: State<'_, AppState>,
    input: SearchQueryInput,
) -> Result<Vec<String>, String> {
    sqlx::query("DELETE FROM search_queries WHERE profile_id = ?1 AND preference_id IS ?2")
        .bind(&input.profile_id)
        .bind(&input.preference_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let built = build_queries(&input);
    let now = now_iso();
    let mut ids = Vec::with_capacity(built.len());

    for q in built {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO search_queries
                (id, profile_id, preference_id, platform, query, query_type, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        )
        .bind(&id)
        .bind(&input.profile_id)
        .bind(&input.preference_id)
        .bind(&q.platform)
        .bind(&q.query_string)
        .bind(&q.query_type)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
        ids.push(id);
    }

    Ok(ids)
}

#[tauri::command]
pub async fn delete_search_query(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM search_queries WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

struct JobPostInsert<'a> {
    id: &'a str,
    input: &'a IngestJobPostInput,
    canonical: &'a str,
    remote_mode: &'a Option<String>,
    now: &'a str,
    status: &'a str,
}

async fn insert_job_post(db: &sqlx::SqlitePool, record: JobPostInsert<'_>) -> Result<(), String> {
    let input = record.input;
    sqlx::query(
        "INSERT INTO job_posts (
            id, profile_id, platform, external_id,
            url, canonical_url, title, company,
            location, remote_mode, description, summary,
            salary_min, salary_max, currency,
            seniority, employment_type, posted_at,
            discovered_at, last_seen_at, discovery_source,
            search_query_id, status
        ) VALUES (
            ?1,  ?2,  ?3,  ?4,
            ?5,  ?6,  ?7,  ?8,
            ?9,  ?10, ?11, ?12,
            ?13, ?14, ?15,
            ?16, ?17, ?18,
            ?19, ?19, ?20,
            ?21, ?22
        )",
    )
    .bind(record.id)
    .bind(&input.profile_id)
    .bind(&input.platform)
    .bind(&input.external_id)
    .bind(&input.url)
    .bind(record.canonical)
    .bind(&input.title)
    .bind(&input.company)
    .bind(&input.location)
    .bind(record.remote_mode)
    .bind(&input.description)
    .bind(&input.summary)
    .bind(input.salary_min)
    .bind(input.salary_max)
    .bind(&input.currency)
    .bind(&input.seniority)
    .bind(&input.employment_type)
    .bind(&input.posted_at)
    .bind(record.now)
    .bind(&input.discovery_source)
    .bind(&input.search_query_id)
    .bind(record.status)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ingest_job_post(
    state: State<'_, AppState>,
    input: IngestJobPostInput,
) -> Result<IngestJobPostResult, String> {
    let canonical = canonicalize(&input.url);
    let dedupe = check_dedupe(&state.db, &input.profile_id, &input.platform, &canonical)
        .await
        .map_err(|e| e.to_string())?;

    let (is_dup, dup_of, status) = match &dedupe {
        DedupeOutcome::Unique => (false, None, "discovered"),
        DedupeOutcome::Duplicate { existing_id } => {
            (true, Some(existing_id.clone()), "skipped_duplicate_url")
        }
    };

    let id = Uuid::new_v4().to_string();
    let now = now_iso();

    let remote_mode = crate::matching::scorer::classify_work_model(&format!(
        "{} {} {}",
        input.title,
        input.location.as_deref().unwrap_or(""),
        input.description
    ))
    .map(str::to_string)
    .or_else(|| input.remote_mode.clone());

    insert_job_post(
        &state.db,
        JobPostInsert {
            id: &id,
            input: &input,
            canonical: &canonical,
            remote_mode: &remote_mode,
            now: &now,
            status,
        },
    )
    .await?;

    Ok(IngestJobPostResult {
        id,
        canonical_url: canonical,
        is_duplicate: is_dup,
        duplicate_of: dup_of,
        status: status.to_owned(),
    })
}

async fn search_job_posts(
    db: &sqlx::SqlitePool,
    profile_id: &str,
    status_filter: Option<&str>,
    term: &str,
    limit: i64,
) -> Result<Vec<JobPostDto>, String> {
    let match_expr = fts_query(term);
    if match_expr.is_empty() {
        return Ok(Vec::new());
    }
    let mut sql = format!(
        "{JOB_SEARCH_SELECT}
         FROM job_posts_fts
         JOIN job_posts jp ON jp.rowid = job_posts_fts.rowid
         WHERE job_posts_fts MATCH ?1 AND jp.profile_id = ?2"
    );
    if status_filter.is_some() {
        sql.push_str(" AND jp.status = ?3");
    }
    let limit_param = if status_filter.is_some() { 4 } else { 3 };
    sql.push_str(&format!(
        " ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?{limit_param}"
    ));
    let mut query = sqlx::query_as::<_, JobRow>(sqlx::AssertSqlSafe(sql))
        .bind(match_expr)
        .bind(profile_id);
    if let Some(status) = status_filter {
        query = query.bind(status);
    }
    query = query.bind(limit);
    query
        .fetch_all(db)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

struct RecentJobPosts<'a> {
    profile_id: &'a str,
    status_filter: Option<&'a str>,
    limit: i64,
    offset: i64,
    cursor_discovered_at: Option<&'a str>,
    cursor_id: Option<&'a str>,
}

async fn list_recent_job_posts(
    db: &sqlx::SqlitePool,
    options: RecentJobPosts<'_>,
) -> Result<Vec<JobPostDto>, String> {
    let RecentJobPosts {
        profile_id,
        status_filter,
        limit,
        offset,
        cursor_discovered_at,
        cursor_id,
    } = options;
    let use_cursor = cursor_discovered_at.is_some() && cursor_id.is_some();
    let use_offset = !use_cursor && offset > 0;
    let mut sql = format!("{JOB_LIST_SELECT} FROM job_posts WHERE profile_id = ?1");
    if status_filter.is_some() {
        sql.push_str(" AND status = ?2");
    }
    let mut next_param = if status_filter.is_some() { 3 } else { 2 };
    if use_cursor {
        sql.push_str(&format!(
            " AND (discovered_at < ?{next_param} OR (discovered_at = ?{next_param} AND id < ?{}))",
            next_param + 1
        ));
        next_param += 2;
    }
    sql.push_str(&format!(
        " ORDER BY discovered_at DESC, id DESC LIMIT ?{next_param}"
    ));
    if use_offset {
        sql.push_str(&format!(" OFFSET ?{}", next_param + 1));
    }

    let mut query = sqlx::query_as::<_, JobRow>(sqlx::AssertSqlSafe(sql)).bind(profile_id);
    if let Some(status) = status_filter {
        query = query.bind(status);
    }
    if use_cursor {
        query = query.bind(cursor_discovered_at).bind(cursor_id);
    }
    query = query.bind(limit);
    if use_offset {
        query = query.bind(offset);
    }
    query
        .fetch_all(db)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

// Tauri named IPC parameters are intentionally kept flat for existing clients;
// the cursor added two fields to this boundary without changing its wire shape.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn list_job_posts(
    state: State<'_, AppState>,
    input: ListJobPostsInput,
) -> Result<Vec<JobPostDto>, String> {
    let ListJobPostsInput {
        profile_id,
        status_filter,
        limit,
        offset,
        cursor_discovered_at,
        cursor_id,
        search,
    } = input;
    let lim = limit
        .unwrap_or(DEFAULT_JOB_PAGE_SIZE)
        .clamp(1, MAX_JOB_PAGE_SIZE);
    let off = offset.unwrap_or(0).max(0);

    /* Full-text branch: a non-empty search term ranks by FTS5 relevance instead
    of recency. Status applies; cursor pagination is reserved for recency lists
    because relevance order has no discovered_at keyset. */
    if let Some(term) = search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return search_job_posts(&state.db, &profile_id, status_filter.as_deref(), term, lim).await;
    }
    list_recent_job_posts(
        &state.db,
        RecentJobPosts {
            profile_id: &profile_id,
            status_filter: status_filter.as_deref(),
            limit: lim,
            offset: off,
            cursor_discovered_at: cursor_discovered_at.as_deref(),
            cursor_id: cursor_id.as_deref(),
        },
    )
    .await
}

#[tauri::command]
pub async fn get_job_post(
    state: State<'_, AppState>,
    profile_id: String,
    job_id: String,
) -> Result<JobPostDto, String> {
    sqlx::query_as::<_, JobRow>(
        "SELECT id, profile_id, platform, external_id,
                url, canonical_url, title, company,
                location, remote_mode, description, summary,
                seniority, salary_min, salary_max, currency,
                employment_type, discovered_at, status,
                search_query_id, discovery_source, contact_email
         FROM job_posts WHERE id = ?1 AND profile_id = ?2",
    )
    .bind(&job_id)
    .bind(&profile_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .map(Into::into)
    .ok_or_else(|| format!("job post {job_id} not found"))
}

#[tauri::command]
pub async fn update_job_status(
    state: State<'_, AppState>,
    job_id: String,
    status: String,
) -> Result<(), String> {
    const VALID: &[&str] = &[
        "discovered",
        "matched",
        "rejected",
        "queued",
        "applied",
        "failed",
        "needs_review",
        "saved",
        "ignored",
        "skipped_duplicate_url",
    ];
    if !VALID.contains(&status.as_str()) {
        return Err(format!("invalid status '{status}'"));
    }
    sqlx::query("UPDATE job_posts SET status = ?1 WHERE id = ?2")
        .bind(&status)
        .bind(&job_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_search(
    state: State<'_, AppState>,
    search_query_id: String,
) -> Result<u32, String> {
    JobSearchServiceImpl::new(state.db.clone())
        .run_search(&search_query_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn optimize_job_search_index(state: State<'_, AppState>) -> Result<(), String> {
    JobSearchServiceImpl::new(state.db.clone())
        .optimize_search_index()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_old_scans(
    state: State<'_, AppState>,
    profile_id: String,
    days_old: i64,
) -> Result<u32, String> {
    JobSearchServiceImpl::new(state.db.clone())
        .delete_old_scans(&profile_id, days_old)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn score_job_match(
    state: State<'_, AppState>,
    job_id: String,
    profile_id: String,
    preference_id: Option<String>,
) -> Result<JobMatchDto, String> {
    let match_id = JobSearchServiceImpl::new(state.db.clone())
        .score_match_with_preference(
            &JobId::from(job_id.as_str()),
            &ProfileId::from(profile_id.as_str()),
            preference_id.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query_as::<_, MatchRow>(
        "SELECT id, job_id, profile_id, preference_id,
                score, role_score, skill_score, seniority_score,
                location_score, salary_score,
                matched_skills_json, missing_skills_json, risk_flags_json,
                recommendation, explanation,
                model_provider, model_name, created_at
         FROM job_matches WHERE id = ?1",
    )
    .bind(&match_id)
    .fetch_one(&state.db)
    .await
    .map(Into::into)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_job_matches(
    state: State<'_, AppState>,
    profile_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<JobMatchDto>, String> {
    let lim = limit.unwrap_or(1000).min(10000);
    let off = offset.unwrap_or(0).max(0);

    sqlx::query_as::<_, MatchRow>(
        "SELECT id, job_id, profile_id, preference_id,
                score, role_score, skill_score, seniority_score,
                location_score, salary_score,
                matched_skills_json, missing_skills_json, risk_flags_json,
                recommendation, explanation,
                model_provider, model_name, created_at
         FROM job_matches
         WHERE profile_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2 OFFSET ?3",
    )
    .bind(&profile_id)
    .bind(lim)
    .bind(off)
    .fetch_all(&state.db)
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .map_err(|e| e.to_string())
}
