//! Job search + matching service: scores job posts against profile preferences and routes their lifecycle status.
//! Key: JobSearchService — trait: run_search, score_match
//! Key: JobSearchServiceImpl::score_match_with_preference — scores a job post against a preference, persists job_matches, routes job_posts.status
//! Key: JobSearchServiceImpl::delete_old_scans — deletes scans, sparing drafts/runs (age-based) or only applied jobs (clear-all)
//! Key: parse_json_array — tolerant JSON string-array column parser

use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use super::ids::{JobId, ProfileId};
use super::{DomainError, DomainResult};
use crate::matching::scorer::MatchScore;
use crate::matching::{
    build_explanation, score_job, select_best_cv, MatchInput, Recommendation, VariantCandidate,
    AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
};
use crate::util::now_iso;

#[allow(async_fn_in_trait)]
pub trait JobSearchService: Send + Sync {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32>;
    async fn score_match(
        &self,
        job_post_id: &JobId,
        profile_id: &ProfileId,
    ) -> DomainResult<String>;
}

#[derive(Clone, sqlx::FromRow)]
struct ScoreJobRow {
    id: String,
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

#[derive(Clone, sqlx::FromRow)]
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

#[derive(Clone, sqlx::FromRow)]
struct VariantRow {
    id: String,
    target_title: String,
    keywords_json: Option<String>,
    preferred_cv_document_id: Option<String>,
}

struct PreparedMatch {
    job: ScoreJobRow,
    scored: MatchScore,
    explanation: String,
    cv_document_id: Option<String>,
    role_variant_id: Option<String>,
}

fn parse_json_array(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

/* Turn free user text into a safe FTS5 MATCH expression: each whitespace token
becomes a quoted prefix term joined by implicit AND. Quoting neutralizes FTS5
operators so stray punctuation can never raise a query syntax error. */
pub fn fts_query(term: &str) -> String {
    term.split_whitespace()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_match_input(job: &ScoreJobRow, pref: Option<&ScorePrefRow>) -> MatchInput {
    let job_text = format!(
        "{} {}",
        job.description,
        job.summary.clone().unwrap_or_default()
    );
    let base = MatchInput {
        job_title: job.title.clone(),
        job_text,
        job_company: job.company.clone(),
        job_seniority: job.seniority.clone(),
        job_location: job.location.clone(),
        job_remote_mode: job.remote_mode.clone(),
        job_salary_min: job.salary_min,
        job_salary_max: job.salary_max,
        ..Default::default()
    };
    match pref {
        Some(p) => MatchInput {
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
            ..base
        },
        None => MatchInput {
            auto_submit_min_score: AUTO_SUBMIT_DEFAULT,
            needs_review_threshold: NEEDS_REVIEW_DEFAULT,
            ..base
        },
    }
}

fn variant_candidates(rows: Vec<VariantRow>) -> Vec<VariantCandidate> {
    rows.into_iter()
        .map(|v| VariantCandidate {
            variant_id: v.id,
            target_title: v.target_title,
            keywords: parse_json_array(&v.keywords_json),
            preferred_cv_document_id: v.preferred_cv_document_id,
        })
        .collect()
}

fn prepare_matches(
    jobs: Vec<ScoreJobRow>,
    preference: Option<&ScorePrefRow>,
    candidates: &[VariantCandidate],
) -> Vec<PreparedMatch> {
    jobs.into_iter()
        .map(|job| {
            let input = build_match_input(&job, preference);
            let scored = score_job(&input);
            let explanation = build_explanation(&scored);
            let selection = select_best_cv(&input.job_title, &input.job_text, candidates);
            PreparedMatch {
                cv_document_id: selection.as_ref().and_then(|s| s.cv_document_id.clone()),
                role_variant_id: selection.as_ref().map(|s| s.variant_id.clone()),
                job,
                scored,
                explanation,
            }
        })
        .collect()
}

fn recommendation_status(recommendation: Recommendation) -> &'static str {
    match recommendation {
        Recommendation::AutoApply => "matched",
        Recommendation::ReviewFirst => "needs_review",
        Recommendation::SaveForLater => "saved",
        Recommendation::Skip => "rejected",
    }
}

async fn persist_prepared_match(
    tx: &mut Transaction<'_, Sqlite>,
    profile_id: &str,
    preference_id: Option<&str>,
    prepared: PreparedMatch,
) -> DomainResult<()> {
    let match_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let matched_json = serde_json::to_string(&prepared.scored.matched_skills).ok();
    let missing_json = serde_json::to_string(&prepared.scored.missing_skills).ok();
    let risk_json = serde_json::to_string(&prepared.scored.risk_flags).ok();
    sqlx::query(
        "INSERT INTO job_matches (
            id, job_id, profile_id, preference_id, cv_document_id, role_variant_id,
            score, role_score, skill_score, seniority_score, location_score, salary_score,
            matched_skills_json, missing_skills_json, risk_flags_json,
            recommendation, explanation, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
    )
    .bind(&match_id)
    .bind(&prepared.job.id)
    .bind(profile_id)
    .bind(preference_id)
    .bind(&prepared.cv_document_id)
    .bind(&prepared.role_variant_id)
    .bind(prepared.scored.score as i64)
    .bind(prepared.scored.role_score as i64)
    .bind(prepared.scored.skill_score as i64)
    .bind(prepared.scored.seniority_score as i64)
    .bind(prepared.scored.location_score as i64)
    .bind(prepared.scored.salary_score as i64)
    .bind(&matched_json)
    .bind(&missing_json)
    .bind(&risk_json)
    .bind(prepared.scored.recommendation.as_str())
    .bind(&prepared.explanation)
    .bind(&now)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE job_posts SET status = ?1 WHERE id = ?2 AND status = 'discovered'")
        .bind(recommendation_status(prepared.scored.recommendation))
        .bind(&prepared.job.id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub struct JobSearchServiceImpl {
    db: SqlitePool,
}

impl JobSearchServiceImpl {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
    }

    async fn load_preference(
        &self,
        profile_id: &str,
        preference_id: Option<&str>,
    ) -> DomainResult<Option<ScorePrefRow>> {
        let row = match preference_id {
            Some(id) => {
                sqlx::query_as::<_, ScorePrefRow>(
                    "SELECT id, target_roles_json, seniority_json, locations_json,
                        remote_modes_json, min_salary, required_skills_json,
                        preferred_skills_json, excluded_keywords_json, blocked_companies_json,
                        auto_submit_min_score, needs_review_confidence_threshold
                     FROM job_preferences WHERE id = ?1",
                )
                .bind(id)
                .fetch_optional(&self.db)
                .await?
            }
            None => {
                sqlx::query_as::<_, ScorePrefRow>(
                    "SELECT id, target_roles_json, seniority_json, locations_json,
                        remote_modes_json, min_salary, required_skills_json,
                        preferred_skills_json, excluded_keywords_json, blocked_companies_json,
                        auto_submit_min_score, needs_review_confidence_threshold
                     FROM job_preferences WHERE profile_id = ?1
                     ORDER BY updated_at DESC LIMIT 1",
                )
                .bind(profile_id)
                .fetch_optional(&self.db)
                .await?
            }
        };
        Ok(row)
    }

    async fn load_variants(&self, profile_id: &str) -> DomainResult<Vec<VariantCandidate>> {
        let rows = sqlx::query_as::<_, VariantRow>(
            "SELECT id, target_title, keywords_json, preferred_cv_document_id
             FROM profile_variants WHERE profile_id = ?1",
        )
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?;
        Ok(variant_candidates(rows))
    }

    pub async fn optimize_search_index(&self) -> DomainResult<()> {
        sqlx::query("INSERT INTO job_posts_fts(job_posts_fts) VALUES ('optimize')")
            .execute(&self.db)
            .await?;
        Ok(())
    }

    async fn run_search_batch(&self, search_query_id: &str) -> DomainResult<u32> {
        let profile_id = self.load_search_profile(search_query_id).await?;
        let preference = self.load_preference(&profile_id, None).await?;
        let candidates = self.load_variants(&profile_id).await?;
        let jobs = self.load_discovered_jobs(search_query_id).await?;
        let prepared = prepare_matches(jobs, preference.as_ref(), &candidates);
        self.persist_search_batch(search_query_id, &profile_id, preference.as_ref(), prepared)
            .await
    }

    async fn load_search_profile(&self, search_query_id: &str) -> DomainResult<String> {
        sqlx::query_scalar("SELECT profile_id FROM search_queries WHERE id = ?1")
            .bind(search_query_id)
            .fetch_optional(&self.db)
            .await?
            .ok_or_else(|| {
                DomainError::InvalidInput(format!("search query {search_query_id} not found"))
            })
    }

    async fn load_discovered_jobs(&self, search_query_id: &str) -> DomainResult<Vec<ScoreJobRow>> {
        Ok(sqlx::query_as::<_, ScoreJobRow>(
            "SELECT id, title, company, description, summary, location, remote_mode,
                    seniority, salary_min, salary_max
             FROM job_posts
             WHERE search_query_id = ?1 AND status = 'discovered'
             ORDER BY discovered_at ASC, id ASC",
        )
        .bind(search_query_id)
        .fetch_all(&self.db)
        .await?)
    }

    async fn persist_search_batch(
        &self,
        search_query_id: &str,
        profile_id: &str,
        preference: Option<&ScorePrefRow>,
        prepared: Vec<PreparedMatch>,
    ) -> DomainResult<u32> {
        // Do CPU scoring before opening write transaction. SQLite then holds
        // its single-writer lock only while prepared rows are persisted.
        let mut tx = self.db.begin().await?;
        let preference_id = preference.map(|p| p.id.as_str());
        let mut scored_count = 0u32;
        for prepared_match in prepared {
            persist_prepared_match(&mut tx, profile_id, preference_id, prepared_match).await?;
            scored_count = scored_count.saturating_add(1);
        }
        sqlx::query("UPDATE search_queries SET last_run_at = ?1 WHERE id = ?2")
            .bind(now_iso())
            .bind(search_query_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        if let Err(error) = self.optimize_search_index().await {
            tracing::warn!(%error, "fts optimize skipped");
        }
        Ok(scored_count)
    }

    /* Full-text search over job_posts via the FTS5 index, ranked by bm25 relevance
    (title weighted highest). Returns matching job-post ids in best-first order. */
    pub async fn search_job_posts(
        &self,
        profile_id: &ProfileId, /* restrict hits to this profile's posts */
        term: &str,             /* raw user text, sanitized into an FTS5 match expression */
        limit: i64,             /* hard cap on returned hits */
    ) -> DomainResult<Vec<String>> {
        let profile_id = profile_id.as_str();
        let match_expr = fts_query(term);
        if match_expr.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT jp.id
             FROM job_posts_fts
             JOIN job_posts jp ON jp.rowid = job_posts_fts.rowid
             WHERE job_posts_fts MATCH ?1 AND jp.profile_id = ?2
             ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC
             LIMIT ?3",
        )
        .bind(match_expr) /* ?1 sanitized FTS query (title company location description summary weights) */
        .bind(profile_id) /* ?2 owning profile */
        .bind(limit.clamp(1, 500)) /* ?3 capped hit count */
        .fetch_all(&self.db)
        .await?;
        Ok(ids)
    }

    pub async fn score_match_with_preference(
        &self,
        job_post_id: &JobId,
        profile_id: &ProfileId,
        preference_id: Option<&str>,
    ) -> DomainResult<String> {
        let job_post_id = job_post_id.as_str();
        let profile_id = profile_id.as_str();
        let (id, now) = (Uuid::new_v4().to_string(), now_iso());

        let job = sqlx::query_as::<_, ScoreJobRow>(
            "SELECT id, title, company, description, summary, location, remote_mode,
                    seniority, salary_min, salary_max
             FROM job_posts WHERE id = ?1",
        )
        .bind(job_post_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("job post {job_post_id} not found")))?;

        let pref = self.load_preference(profile_id, preference_id).await?;
        let input = build_match_input(&job, pref.as_ref());

        let scored = score_job(&input);
        let explanation = build_explanation(&scored);

        let candidates = self.load_variants(profile_id).await?;

        let selection = select_best_cv(&input.job_title, &input.job_text, &candidates);
        let cv_document_id = selection.as_ref().and_then(|s| s.cv_document_id.clone());
        let role_variant_id = selection.as_ref().map(|s| s.variant_id.clone());

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
        .bind(job_post_id)
        .bind(profile_id)
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
        .execute(&self.db)
        .await?;

        let new_status = match scored.recommendation {
            Recommendation::AutoApply => "matched",
            Recommendation::ReviewFirst => "needs_review",
            Recommendation::SaveForLater => "saved",
            Recommendation::Skip => "rejected",
        };
        sqlx::query("UPDATE job_posts SET status = ?1 WHERE id = ?2 AND status = 'discovered'")
            .bind(new_status)
            .bind(job_post_id)
            .execute(&self.db)
            .await?;

        Ok(id)
    }

    pub async fn delete_old_scans(&self, profile_id: &str, days_old: i64) -> DomainResult<u32> {
        let result = if days_old <= 0 {
            // Clear-all = "delete every scan not yet applied to" (the confirm dialog's words).
            // We spare ONLY genuinely-applied jobs (job_posts.status = 'applied', set when a run
            // submits). The old `id NOT IN application_runs` guard wrongly spared *queued* jobs too:
            // enqueuing (submit) inserts an application_run, so queued scans carried a run row and
            // survived. Keying on the applied status deletes queued AND ignored as LO expects.
            sqlx::query(
                "DELETE FROM job_posts
                 WHERE profile_id = ?1
                   AND status <> 'applied'",
            )
            .bind(profile_id)
            .execute(&self.db)
            .await?
        } else {
            use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
            let cutoff = (OffsetDateTime::now_utc() - Duration::days(days_old))
                .format(&Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
            sqlx::query(
                "DELETE FROM job_posts AS j
                 WHERE j.profile_id = ?1
                   AND j.discovered_at < ?2
                   AND NOT EXISTS (
                       SELECT 1 FROM application_runs ar WHERE ar.job_id = j.id
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM application_drafts ad WHERE ad.job_id = j.id
                   )",
            )
            .bind(profile_id)
            .bind(&cutoff)
            .execute(&self.db)
            .await?
        };

        Ok(result.rows_affected() as u32)
    }
}

impl JobSearchService for JobSearchServiceImpl {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32> {
        self.run_search_batch(search_query_id).await
    }

    async fn score_match(
        &self,
        job_post_id: &JobId,
        profile_id: &ProfileId,
    ) -> DomainResult<String> {
        self.score_match_with_preference(job_post_id, profile_id, None)
            .await
    }
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
