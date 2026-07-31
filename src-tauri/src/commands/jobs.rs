//! Tauri commands for job discovery, search, and matching: preferences, search queries, ingest, scoring, and per-platform scrape/apply.
//! Key: ingest_job_post — canonicalizes + dedupes a job post, inserts into job_posts.
//! Key: run_search — scores every discovered post under a saved search query.
//! Key: score_job_match — deterministic rule-based scoring via JobSearchServiceImpl.
//! Key: run_linkedin_search / run_indeed_search / run_catho_search / run_upwork_search / run_freelas99_search / run_infojobs_search / run_gupy_search / run_google_search / run_linkedin_posts_search — per-platform scrape + ingest.
//! Key: catho_apply / infojobs_apply — per-offer, user-triggered CV submission.
//! Key: linkedin_job_login / linkedin_job_login_status — persistent LinkedIn browser session login and auth check.

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::domain::jobs::{JobSearchService, JobSearchServiceImpl};
use crate::jobs::{build_queries, canonicalize, check_dedupe, DedupeOutcome, SearchQueryInput};
use crate::util::now_iso;
use crate::AppState;

#[cfg(feature = "real-browser")]
use crate::jobs::extract_email;


#[derive(sqlx::FromRow)]
struct PrefRow {
    id: String,
    profile_id: String,
    name: String,
    target_roles_json: String,
    seniority_json: Option<String>,
    locations_json: Option<String>,
    remote_modes_json: Option<String>,
    min_salary: Option<i64>,
    salary_currency: Option<String>,
    required_skills_json: Option<String>,
    preferred_skills_json: Option<String>,
    excluded_keywords_json: Option<String>,
    blocked_companies_json: Option<String>,
    auto_apply_enabled: i64,
    auto_submit_enabled: i64,
    auto_submit_min_score: i64,
    needs_review_confidence_threshold: i64,
    retry_failed_enabled: i64,
    retry_limit: i64,
    daily_application_limit: Option<i64>,
    daily_connection_limit: Option<i64>,
    created_at: String,
    updated_at: String,
}

#[derive(sqlx::FromRow)]
struct SqRow {
    id: String,
    profile_id: String,
    preference_id: Option<String>,
    platform: String,
    query: String,
    query_type: String,
    enabled: i64,
    last_run_at: Option<String>,
    created_at: String,
}

#[derive(sqlx::FromRow)]
struct JobRow {
    id: String,
    profile_id: Option<String>,
    platform: String,
    external_id: Option<String>,
    url: String,
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
    status: String,
    search_query_id: Option<String>,
    discovery_source: Option<String>,
    contact_email: Option<String>,
}

#[derive(sqlx::FromRow)]
struct MatchRow {
    id: String,
    job_id: String,
    profile_id: String,
    preference_id: Option<String>,
    score: i64,
    role_score: Option<i64>,
    skill_score: Option<i64>,
    seniority_score: Option<i64>,
    location_score: Option<i64>,
    salary_score: Option<i64>,
    matched_skills_json: Option<String>,
    missing_skills_json: Option<String>,
    risk_flags_json: Option<String>,
    recommendation: String,
    explanation: Option<String>,
    model_provider: Option<String>,
    model_name: Option<String>,
    created_at: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPreferenceDto {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub target_roles_json: String,
    pub seniority_json: Option<String>,
    pub locations_json: Option<String>,
    pub remote_modes_json: Option<String>,
    pub min_salary: Option<i64>,
    pub salary_currency: Option<String>,
    pub required_skills_json: Option<String>,
    pub preferred_skills_json: Option<String>,
    pub excluded_keywords_json: Option<String>,
    pub blocked_companies_json: Option<String>,
    pub auto_apply_enabled: bool,
    pub auto_submit_enabled: bool,
    pub auto_submit_min_score: i64,
    pub needs_review_confidence_threshold: i64,
    pub retry_failed_enabled: bool,
    pub retry_limit: i64,
    pub daily_application_limit: Option<i64>,
    pub daily_connection_limit: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<PrefRow> for JobPreferenceDto {
    fn from(r: PrefRow) -> Self {
        Self {
            id: r.id,
            profile_id: r.profile_id,
            name: r.name,
            target_roles_json: r.target_roles_json,
            seniority_json: r.seniority_json,
            locations_json: r.locations_json,
            remote_modes_json: r.remote_modes_json,
            min_salary: r.min_salary,
            salary_currency: r.salary_currency,
            required_skills_json: r.required_skills_json,
            preferred_skills_json: r.preferred_skills_json,
            excluded_keywords_json: r.excluded_keywords_json,
            blocked_companies_json: r.blocked_companies_json,
            auto_apply_enabled: r.auto_apply_enabled != 0,
            auto_submit_enabled: r.auto_submit_enabled != 0,
            auto_submit_min_score: r.auto_submit_min_score,
            needs_review_confidence_threshold: r.needs_review_confidence_threshold,
            retry_failed_enabled: r.retry_failed_enabled != 0,
            retry_limit: r.retry_limit,
            daily_application_limit: r.daily_application_limit,
            daily_connection_limit: r.daily_connection_limit,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobPreferenceInput {
    pub profile_id: String,
    pub name: String,
    pub target_roles_json: String,
    pub seniority_json: Option<String>,
    pub locations_json: Option<String>,
    pub remote_modes_json: Option<String>,
    pub min_salary: Option<i64>,
    pub salary_currency: Option<String>,
    pub required_skills_json: Option<String>,
    pub preferred_skills_json: Option<String>,
    pub excluded_keywords_json: Option<String>,
    pub blocked_companies_json: Option<String>,
    pub auto_apply_enabled: Option<bool>,
    pub auto_submit_enabled: Option<bool>,
    pub auto_submit_min_score: Option<i64>,
    pub needs_review_confidence_threshold: Option<i64>,
    pub retry_failed_enabled: Option<bool>,
    pub retry_limit: Option<i64>,
    pub daily_application_limit: Option<i64>,
    pub daily_connection_limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryDto {
    pub id: String,
    pub profile_id: String,
    pub preference_id: Option<String>,
    pub platform: String,
    pub query: String,
    pub query_type: String,
    pub enabled: bool,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

impl From<SqRow> for SearchQueryDto {
    fn from(r: SqRow) -> Self {
        Self {
            id: r.id,
            profile_id: r.profile_id,
            preference_id: r.preference_id,
            platform: r.platform,
            query: r.query,
            query_type: r.query_type,
            enabled: r.enabled != 0,
            last_run_at: r.last_run_at,
            created_at: r.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestJobPostInput {
    pub profile_id: String,
    pub platform: String,
    pub url: String,
    pub title: String,
    pub company: String,
    pub description: String,
    pub external_id: Option<String>,
    pub location: Option<String>,
    pub remote_mode: Option<String>,
    pub summary: Option<String>,
    pub salary_min: Option<i64>,
    pub salary_max: Option<i64>,
    pub currency: Option<String>,
    pub seniority: Option<String>,
    pub employment_type: Option<String>,
    pub posted_at: Option<String>,
    pub search_query_id: Option<String>,
    pub discovery_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestJobPostResult {
    pub id: String,
    pub canonical_url: String,
    pub is_duplicate: bool,
    pub duplicate_of: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInSearchResult {
    pub ingested: u32,
    pub skipped_duplicates: u32,
    pub has_next_page: bool,
    pub pages_scraped: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPostDto {
    pub id: String,
    pub profile_id: Option<String>,
    pub platform: String,
    pub external_id: Option<String>,
    pub url: String,
    pub canonical_url: Option<String>,
    pub title: String,
    pub company: String,
    pub location: Option<String>,
    pub remote_mode: Option<String>,
    pub description: Option<String>,
    pub summary: Option<String>,
    pub seniority: Option<String>,
    pub employment_type: Option<String>,
    pub salary_min: Option<i64>,
    pub salary_max: Option<i64>,
    pub currency: Option<String>,
    pub posted_at: Option<String>,
    pub discovered_at: String,
    pub status: String,
    pub search_query_id: Option<String>,
    pub discovery_source: Option<String>,
    pub contact_email: Option<String>,
}

impl From<JobRow> for JobPostDto {
    fn from(r: JobRow) -> Self {
        Self {
            id: r.id,
            profile_id: r.profile_id,
            platform: r.platform,
            external_id: r.external_id,
            url: r.url,
            canonical_url: r.canonical_url,
            title: r.title,
            company: r.company,
            location: r.location,
            remote_mode: r.remote_mode,
            description: if r.description.is_empty() {
                None
            } else {
                Some(r.description)
            },
            summary: r.summary,
            seniority: r.seniority,
            employment_type: r.employment_type,
            salary_min: r.salary_min,
            salary_max: r.salary_max,
            currency: r.currency,
            posted_at: None,
            discovered_at: r.discovered_at,
            status: r.status,
            search_query_id: r.search_query_id,
            discovery_source: r.discovery_source,
            contact_email: r.contact_email,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMatchDto {
    pub id: String,
    pub job_id: String,
    pub profile_id: String,
    pub preference_id: Option<String>,
    pub score: i64,
    pub role_score: Option<i64>,
    pub skill_score: Option<i64>,
    pub seniority_score: Option<i64>,
    pub location_score: Option<i64>,
    pub salary_score: Option<i64>,
    pub matched_skills_json: Option<String>,
    pub missing_skills_json: Option<String>,
    pub risk_flags_json: Option<String>,
    pub recommendation: String,
    pub explanation: Option<String>,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub created_at: String,
}

impl From<MatchRow> for JobMatchDto {
    fn from(r: MatchRow) -> Self {
        Self {
            id: r.id,
            job_id: r.job_id,
            profile_id: r.profile_id,
            preference_id: r.preference_id,
            score: r.score,
            role_score: r.role_score,
            skill_score: r.skill_score,
            seniority_score: r.seniority_score,
            location_score: r.location_score,
            salary_score: r.salary_score,
            matched_skills_json: r.matched_skills_json,
            missing_skills_json: r.missing_skills_json,
            risk_flags_json: r.risk_flags_json,
            recommendation: r.recommendation,
            explanation: r.explanation,
            model_provider: r.model_provider,
            model_name: r.model_name,
            created_at: r.created_at,
        }
    }
}


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
    .bind(&id)
    .bind(&input.profile_id)
    .bind(&input.platform)
    .bind(&input.external_id)
    .bind(&input.url)
    .bind(&canonical)
    .bind(&input.title)
    .bind(&input.company)
    .bind(&input.location)
    .bind(&remote_mode)
    .bind(&input.description)
    .bind(&input.summary)
    .bind(input.salary_min)
    .bind(input.salary_max)
    .bind(&input.currency)
    .bind(&input.seniority)
    .bind(&input.employment_type)
    .bind(&input.posted_at)
    .bind(&now)
    .bind(&input.discovery_source)
    .bind(&input.search_query_id)
    .bind(status)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(IngestJobPostResult {
        id,
        canonical_url: canonical,
        is_duplicate: is_dup,
        duplicate_of: dup_of,
        status: status.to_owned(),
    })
}

#[tauri::command]
pub async fn list_job_posts(
    state: State<'_, AppState>,
    profile_id: String,
    status_filter: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<JobPostDto>, String> {
    let lim = limit.unwrap_or(1000).min(10000);
    let off = offset.unwrap_or(0).max(0);

    let rows: Vec<JobRow> = if let Some(ref sf) = status_filter {
        sqlx::query_as::<_, JobRow>(
            "SELECT id, profile_id, platform, external_id,
                    url, canonical_url, title, company,
                    location, remote_mode, description, summary,
                    seniority, salary_min, salary_max, currency,
                    employment_type, discovered_at, status,
                    search_query_id, discovery_source, contact_email
             FROM job_posts
             WHERE profile_id = ?1 AND status = ?2
             ORDER BY discovered_at DESC
             LIMIT ?3 OFFSET ?4",
        )
        .bind(&profile_id)
        .bind(sf)
        .bind(lim)
        .bind(off)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, JobRow>(
            "SELECT id, profile_id, platform, external_id,
                    url, canonical_url, title, company,
                    location, remote_mode, description, summary,
                    seniority, salary_min, salary_max, currency,
                    employment_type, discovered_at, status,
                    search_query_id, discovery_source, contact_email
             FROM job_posts
             WHERE profile_id = ?1
             ORDER BY discovered_at DESC
             LIMIT ?2 OFFSET ?3",
        )
        .bind(&profile_id)
        .bind(lim)
        .bind(off)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    };

    Ok(rows.into_iter().map(Into::into).collect())
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
        .score_match_with_preference(&job_id, &profile_id, preference_id.as_deref())
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

#[tauri::command]
pub async fn run_indeed_search(
    state: State<'_, AppState>,
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
                    sqlx::query(
                        "INSERT INTO job_posts (
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
                        )",
                    )
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

#[tauri::command]
pub async fn run_catho_search(
    state: State<'_, AppState>,
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
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "catho_search", global)
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

            sqlx::query(
                "INSERT INTO job_posts (
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
                )",
            )
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
            let remote_mode =
                crate::matching::scorer::classify_work_model(&hay).or(Some("remote"));

            sqlx::query(
                "INSERT INTO job_posts (
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
                )",
            )
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
        let _ = (state, profile_id, search_query_id, query, sort, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_freelas99_search(
    state: State<'_, AppState>,
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

            sqlx::query(
                "INSERT INTO job_posts (
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
                )",
            )
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
        let _ = (state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_infojobs_search(
    state: State<'_, AppState>,
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

            sqlx::query(
                "INSERT INTO job_posts (
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
                )",
            )
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
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "gupy_search", global)
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

            sqlx::query(
                "INSERT INTO job_posts (
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
                )",
            )
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
        let _ = (state, profile_id, search_query_id, query, remote_only, max_pages);
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
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "infojobs_apply", false)
                .await;
        state
            .playwright
            .infojobs_apply(&dir, &offer_id, &apply_url, headless)
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
pub async fn run_linkedin_search(
    state: State<'_, AppState>,
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

                    let raw = state.playwright.search_jobs(&handle, &page_input).await;
                    if raw.is_err() {
                        state.playwright.close_session(&handle).await;
                        return Err(raw.unwrap_err().to_string());
                    }
                    let raw = raw.unwrap();

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

                        sqlx::query(
                            "INSERT INTO job_posts (
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
                        )",
                        )
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
                let raw = state.playwright.search_google(&handle, q_str, page_index).await;
                if raw.is_err() {
                    state.playwright.close_session(&handle).await;
                    return Err(raw.unwrap_err().to_string());
                }
                let raw = raw.unwrap();

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
                        "INSERT INTO job_posts (
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
                        )",
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
        let _ = (state, profile_id, search_query_id, query, max_pages);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn run_linkedin_posts_search(
    state: State<'_, AppState>,
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
                    let raw = state
                        .playwright
                        .search_linkedin_posts(&handle, q, page_index)
                        .await;
                    if raw.is_err() {
                        state.playwright.close_session(&handle).await;
                        return Err(raw.unwrap_err().to_string());
                    }
                    let raw = raw.unwrap();

                    has_next = raw.has_next_page;
                    pages_scraped += 1;

                    for post in &raw.posts {
                        let url = match &post.url {
                            Some(u) if !u.is_empty() => u.clone(),
                            _ => {
                                use std::hash::{Hash, Hasher};
                                let mut h =
                                    std::collections::hash_map::DefaultHasher::new();
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

                        sqlx::query(
                            "INSERT INTO job_posts (
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
                        )",
                        )
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
        let _ = (state, profile_id, search_query_id, keywords, max_pages);
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

