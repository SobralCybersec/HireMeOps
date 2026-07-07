//! Tauri commands — jobs, preferences, search queries, matches.
//!
//! Ingest flow:
//!   1. Frontend/automation calls `ingest_job_post` with raw URL + metadata.
//!   2. Canonicalize URL (strip tracking params, lowercase host, sort query).
//!   3. Dedupe check: same canonical URL for this profile+platform → insert with
//!      status='skipped_duplicate_url' (history preserved, caller knows).
//!   4. Row inserted; id returned.
//!
//! Scoring is deterministic and rule-based (see `crate::matching`); Phase 4 may
//! later augment `explanation`/`model_*`, but the baseline works offline.
//!
//! Wide queries use `#[derive(sqlx::FromRow)]` structs — tuple FromRow
//! is capped at 16 columns in sqlx 0.9.

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::jobs::{build_queries, canonicalize, check_dedupe, DedupeOutcome, SearchQueryInput};
use crate::util::now_iso;
use crate::AppState;

// ── Internal FromRow row types ───────────────────────────────────────────────

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

// ── Public DTOs (serialised to the frontend) ─────────────────────────────────

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
            summary: r.summary,
            seniority: r.seniority,
            employment_type: r.employment_type,
            salary_min: r.salary_min,
            salary_max: r.salary_max,
            currency: r.currency,
            posted_at: None, // not fetched in list; use a detail command when needed
            discovered_at: r.discovered_at,
            status: r.status,
            search_query_id: r.search_query_id,
            discovery_source: r.discovery_source,
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

// ── Commands: Job Preferences ────────────────────────────────────────────────

/// List all job preferences for a profile.
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

/// Create a new job preference; returns the new row's id.
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

// ── Commands: Search Queries ─────────────────────────────────────────────────

/// List search queries for a profile (optionally filtered by preference).
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

/// Generate and persist search queries from a `SearchQueryInput`.
/// Returns the list of newly-created row ids.
#[tauri::command]
pub async fn generate_search_queries(
    state: State<'_, AppState>,
    input: SearchQueryInput,
) -> Result<Vec<String>, String> {
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

// ── Commands: Job Posts ──────────────────────────────────────────────────────

/// Ingest a single job post.
///
/// Always inserts a new row — duplicates are NOT merged.  When the canonical
/// URL already exists the status is `skipped_duplicate_url` so history and
/// the collision info are both preserved.
#[tauri::command]
pub async fn ingest_job_post(
    state: State<'_, AppState>,
    input: IngestJobPostInput,
) -> Result<IngestJobPostResult, String> {
    let canonical = canonicalize(&input.url);
    let dedupe =
        check_dedupe(&state.db, &input.profile_id, &input.platform, &canonical)
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
    .bind(&input.remote_mode)
    .bind(&input.description)
    .bind(&input.summary)
    .bind(input.salary_min)
    .bind(input.salary_max)
    .bind(&input.currency)
    .bind(&input.seniority)
    .bind(&input.employment_type)
    .bind(&input.posted_at)
    .bind(&now)                    // discovered_at AND last_seen_at (bound twice as ?19)
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

/// List job posts for a profile (optional status filter, paginated).
#[tauri::command]
pub async fn list_job_posts(
    state: State<'_, AppState>,
    profile_id: String,
    status_filter: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<JobPostDto>, String> {
    let lim = limit.unwrap_or(50).min(200);
    let off = offset.unwrap_or(0).max(0);

    let rows: Vec<JobRow> = if let Some(ref sf) = status_filter {
        sqlx::query_as::<_, JobRow>(
            "SELECT id, profile_id, platform, external_id,
                    url, canonical_url, title, company,
                    location, remote_mode, summary,
                    seniority, salary_min, salary_max, currency,
                    employment_type, discovered_at, status,
                    search_query_id, discovery_source
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
                    location, remote_mode, summary,
                    seniority, salary_min, salary_max, currency,
                    employment_type, discovered_at, status,
                    search_query_id, discovery_source
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

/// Update job post status (e.g. 'saved', 'ignored', 'queued').
#[tauri::command]
pub async fn update_job_status(
    state: State<'_, AppState>,
    job_id: String,
    status: String,
) -> Result<(), String> {
    const VALID: &[&str] = &[
        "discovered", "matched", "rejected", "queued", "applied",
        "failed", "needs_review", "saved", "ignored", "skipped_duplicate_url",
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

// ── Commands: Job Matches ────────────────────────────────────────────────────

/// Scoring-relevant columns of a job post.
#[derive(sqlx::FromRow)]
struct ScoreJobRow {
    title: String,
    company: String,
    description: String,
    summary: Option<String>,
    location: Option<String>,
    remote_mode: Option<String>,
    seniority: Option<String>,
    salary_min: Option<i64>,
    salary_max: Option<i64>,
}

/// Scoring-relevant columns of a job preference.
#[derive(sqlx::FromRow)]
struct ScorePrefRow {
    id: String,
    target_roles_json: String,
    seniority_json: Option<String>,
    locations_json: Option<String>,
    remote_modes_json: Option<String>,
    min_salary: Option<i64>,
    required_skills_json: Option<String>,
    preferred_skills_json: Option<String>,
    excluded_keywords_json: Option<String>,
    blocked_companies_json: Option<String>,
    auto_submit_min_score: i64,
    needs_review_confidence_threshold: i64,
}

/// A profile variant, as a best-CV candidate.
#[derive(sqlx::FromRow)]
struct VariantRow {
    id: String,
    target_title: String,
    keywords_json: Option<String>,
    preferred_cv_document_id: Option<String>,
}

/// Parse a JSON string-array column into a `Vec<String>`; tolerant of NULL and
/// malformed JSON (both yield an empty vec).
fn parse_json_array(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

/// Score a job against a profile + preference — deterministic, rule-based.
///
/// Per SPEC §7.5 this is the *match scoring* stage (Phase 3): it computes five
/// sub-scores from the job post and the saved preference, selects the best-fit
/// profile variant / CV, and writes a full `job_matches` row. No AI is used —
/// Phase 4's providers may later augment `explanation`/`model_*`, but this
/// deterministic baseline always works offline.
#[tauri::command]
pub async fn score_job_match(
    state: State<'_, AppState>,
    job_id: String,
    profile_id: String,
    preference_id: Option<String>,
) -> Result<JobMatchDto, String> {
    use crate::matching::{
        build_explanation, score_job, select_best_cv, MatchInput, Recommendation,
        VariantCandidate, AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
    };

    let id = Uuid::new_v4().to_string();
    let now = now_iso();

    // ── Load the job post ──
    let job = sqlx::query_as::<_, ScoreJobRow>(
        "SELECT title, company, description, summary, location, remote_mode,
                seniority, salary_min, salary_max
         FROM job_posts WHERE id = ?1",
    )
    .bind(&job_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("job post {job_id} not found"))?;

    // ── Load the preference: explicit id, else the profile's most recent ──
    let pref = match &preference_id {
        Some(pid) => sqlx::query_as::<_, ScorePrefRow>(
            "SELECT id, target_roles_json, seniority_json, locations_json,
                    remote_modes_json, min_salary, required_skills_json,
                    preferred_skills_json, excluded_keywords_json, blocked_companies_json,
                    auto_submit_min_score, needs_review_confidence_threshold
             FROM job_preferences WHERE id = ?1",
        )
        .bind(pid)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?,
        None => sqlx::query_as::<_, ScorePrefRow>(
            "SELECT id, target_roles_json, seniority_json, locations_json,
                    remote_modes_json, min_salary, required_skills_json,
                    preferred_skills_json, excluded_keywords_json, blocked_companies_json,
                    auto_submit_min_score, needs_review_confidence_threshold
             FROM job_preferences WHERE profile_id = ?1
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&profile_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?,
    };

    let job_text = format!("{} {}", job.description, job.summary.clone().unwrap_or_default());

    // ── Assemble the scorer input ──
    let input = match &pref {
        Some(p) => MatchInput {
            job_title: job.title.clone(),
            job_text,
            job_company: job.company.clone(),
            job_seniority: job.seniority.clone(),
            job_location: job.location.clone(),
            job_remote_mode: job.remote_mode.clone(),
            job_salary_min: job.salary_min,
            job_salary_max: job.salary_max,
            target_roles: parse_json_array(&Some(p.target_roles_json.clone())),
            pref_seniority: parse_json_array(&p.seniority_json),
            pref_locations: parse_json_array(&p.locations_json),
            pref_remote_modes: parse_json_array(&p.remote_modes_json),
            required_skills: parse_json_array(&p.required_skills_json),
            preferred_skills: parse_json_array(&p.preferred_skills_json),
            excluded_keywords: parse_json_array(&p.excluded_keywords_json),
            blocked_companies: parse_json_array(&p.blocked_companies_json),
            min_salary: p.min_salary,
            auto_submit_min_score: p.auto_submit_min_score.clamp(0, 100) as u8,
            needs_review_threshold: p.needs_review_confidence_threshold.clamp(0, 100) as u8,
        },
        // No preference on file → neutral scoring, default thresholds.
        None => MatchInput {
            job_title: job.title.clone(),
            job_text,
            job_company: job.company.clone(),
            job_seniority: job.seniority.clone(),
            job_location: job.location.clone(),
            job_remote_mode: job.remote_mode.clone(),
            job_salary_min: job.salary_min,
            job_salary_max: job.salary_max,
            auto_submit_min_score: AUTO_SUBMIT_DEFAULT,
            needs_review_threshold: NEEDS_REVIEW_DEFAULT,
            ..Default::default()
        },
    };

    let scored = score_job(&input);
    let explanation = build_explanation(&scored);

    // ── Best-CV selection via best-fitting profile variant ──
    let candidates: Vec<VariantCandidate> = sqlx::query_as::<_, VariantRow>(
        "SELECT id, target_title, keywords_json, preferred_cv_document_id
         FROM profile_variants WHERE profile_id = ?1",
    )
    .bind(&profile_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|v| VariantCandidate {
        variant_id: v.id,
        target_title: v.target_title,
        keywords: parse_json_array(&v.keywords_json),
        preferred_cv_document_id: v.preferred_cv_document_id,
    })
    .collect();

    let selection = select_best_cv(&input.job_title, &input.job_text, &candidates);
    let cv_document_id = selection.as_ref().and_then(|s| s.cv_document_id.clone());
    let role_variant_id = selection.as_ref().map(|s| s.variant_id.clone());

    // ── Persist the match row ──
    let matched_json = serde_json::to_string(&scored.matched_skills).ok();
    let missing_json = serde_json::to_string(&scored.missing_skills).ok();
    let risk_json = serde_json::to_string(&scored.risk_flags).ok();
    let effective_pref_id = pref.as_ref().map(|p| p.id.clone());

    sqlx::query(
        "INSERT INTO job_matches (
            id, job_id, profile_id, preference_id, cv_document_id, role_variant_id,
            score, role_score, skill_score, seniority_score, location_score, salary_score,
            matched_skills_json, missing_skills_json, risk_flags_json,
            recommendation, explanation, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
    )
    .bind(&id)
    .bind(&job_id)
    .bind(&profile_id)
    .bind(&effective_pref_id)
    .bind(&cv_document_id)
    .bind(&role_variant_id)
    .bind(scored.score as i64)
    .bind(scored.role_score as i64)
    .bind(scored.skill_score as i64)
    .bind(scored.seniority_score as i64)
    .bind(scored.location_score as i64)
    .bind(scored.salary_score as i64)
    .bind(&matched_json)
    .bind(&missing_json)
    .bind(&risk_json)
    .bind(scored.recommendation.as_str())
    .bind(&explanation)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // ── Route the job's lifecycle status from the recommendation ──
    let new_status = match scored.recommendation {
        Recommendation::AutoApply => "matched",
        Recommendation::ReviewFirst => "needs_review",
        Recommendation::SaveForLater => "saved",
        Recommendation::Skip => "rejected",
    };
    sqlx::query("UPDATE job_posts SET status = ?1 WHERE id = ?2 AND status = 'discovered'")
        .bind(new_status)
        .bind(&job_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(JobMatchDto {
        id,
        job_id,
        profile_id,
        preference_id: effective_pref_id,
        score: scored.score as i64,
        role_score: Some(scored.role_score as i64),
        skill_score: Some(scored.skill_score as i64),
        seniority_score: Some(scored.seniority_score as i64),
        location_score: Some(scored.location_score as i64),
        salary_score: Some(scored.salary_score as i64),
        matched_skills_json: matched_json,
        missing_skills_json: missing_json,
        risk_flags_json: risk_json,
        recommendation: scored.recommendation.as_str().to_string(),
        explanation: Some(explanation),
        model_provider: None,
        model_name: None,
        created_at: now,
    })
}

/// List matches for a profile, newest first.
#[tauri::command]
pub async fn list_job_matches(
    state: State<'_, AppState>,
    profile_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<JobMatchDto>, String> {
    let lim = limit.unwrap_or(50).min(200);
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
