//! Tauri commands for job discovery, search, and matching: preferences, search queries, ingest, scoring, and per-platform scrape/apply.
//! Key: ingest_job_post — canonicalizes + dedupes a job post, inserts into job_posts.
//! Key: run_search — scores every discovered post under a saved search query.
//! Key: score_job_match — deterministic rule-based scoring via JobSearchServiceImpl.
//! Key: run_linkedin_search / run_indeed_search / run_catho_search / run_upwork_search / run_freelas99_search / run_infojobs_search / run_gupy_search / run_google_search / run_linkedin_posts_search — per-platform scrape + ingest.
//! Key: catho_apply / infojobs_apply — per-offer, user-triggered CV submission.
//! Key: linkedin_job_login / linkedin_job_login_status — persistent LinkedIn browser session login and auth check.

use serde::{Deserialize, Serialize};

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

pub mod queries;
pub mod scrapers;

pub use queries::*;
pub use scrapers::*;
