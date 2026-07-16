//! Job search + matching service (Phase 3+).
//!
//! `score_match` is the deterministic, rule-based scoring stage (SPEC §7.5): it
//! loads a job post + the profile's preference, runs the pure `matching` core,
//! picks the best-fit profile variant / CV, writes a full `job_matches` row, and
//! routes the job post's lifecycle status. No AI is involved — Phase 4 providers
//! may later augment `explanation`/`model_*`, but this baseline works offline.
//!
//! `run_search` is the orchestration layer: it scores every still-`discovered`
//! job post ingested under a saved `search_queries` row against that query's
//! profile, then stamps the query's `last_run_at`. Actual network/browser
//! fetching that *produces* those job posts lands with the sidecar (Phase 5);
//! here we wire the deterministic scoring half end to end.

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::matching::{
    build_explanation, score_job, select_best_cv, MatchInput, Recommendation, VariantCandidate,
    AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
};
use crate::util::now_iso;

/// Runs saved `search_queries`, ingests `job_posts` (keeping duplicates as
/// separate rows), and scores `job_matches` against the active profile.
#[allow(async_fn_in_trait)]
pub trait JobSearchService: Send + Sync {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32>;
    async fn score_match(&self, job_post_id: &str, profile_id: &str) -> DomainResult<String>;
}

/// Placeholder implementation (kept for reference / early Phase-1 wiring).
pub struct JobSearchServiceStub;

impl JobSearchService for JobSearchServiceStub {
    async fn run_search(&self, _search_query_id: &str) -> DomainResult<u32> {
        Err(DomainError::NotImplemented("JobSearchService::run_search"))
    }
    async fn score_match(&self, _job_post_id: &str, _profile_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("JobSearchService::score_match"))
    }
}

// ── Internal FromRow helpers ─────────────────────────────────────────────────

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

/// Concrete `JobSearchService` backed by the SQLite pool. The `matching` core it
/// calls is pure and unit-tested in isolation; this layer only does I/O.
pub struct JobSearchServiceImpl {
    db: SqlitePool,
}

impl JobSearchServiceImpl {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
    }

    /// Score `job_post_id` against `profile_id`, using an explicit preference when
    /// `preference_id` is `Some`, otherwise the profile's most-recently-updated
    /// preference. Writes a `job_matches` row and routes the post's status.
    /// Returns the new `job_matches.id`.
    pub async fn score_match_with_preference(
        &self,
        job_post_id: &str,
        profile_id: &str,
        preference_id: Option<&str>,
    ) -> DomainResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();

        // ── Load the job post ──
        let job = sqlx::query_as::<_, ScoreJobRow>(
            "SELECT title, company, description, summary, location, remote_mode,
                    seniority, salary_min, salary_max
             FROM job_posts WHERE id = ?1",
        )
        .bind(job_post_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("job post {job_post_id} not found")))?;

        // ── Load the preference: explicit id, else the profile's most recent ──
        let pref = match preference_id {
            Some(pid) => {
                sqlx::query_as::<_, ScorePrefRow>(
                    "SELECT id, target_roles_json, seniority_json, locations_json,
                        remote_modes_json, min_salary, required_skills_json,
                        preferred_skills_json, excluded_keywords_json, blocked_companies_json,
                        auto_submit_min_score, needs_review_confidence_threshold
                 FROM job_preferences WHERE id = ?1",
                )
                .bind(pid)
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

        let job_text = format!(
            "{} {}",
            job.description,
            job.summary.clone().unwrap_or_default()
        );

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
        .bind(profile_id)
        .fetch_all(&self.db)
        .await?
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

        // ── Persist the match row (history-preserving: never overwritten) ──
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

        // ── Route the job's lifecycle status from the recommendation ──
        // Only advance a still-`discovered` post; never clobber a later state.
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
}

impl JobSearchService for JobSearchServiceImpl {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32> {
        // Resolve the query → owning profile.
        let profile_id: String =
            sqlx::query_scalar("SELECT profile_id FROM search_queries WHERE id = ?1")
                .bind(search_query_id)
                .fetch_optional(&self.db)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("search query {search_query_id} not found"))
                })?;

        // Score every still-unscored (discovered) post ingested under this query.
        let job_ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM job_posts
             WHERE search_query_id = ?1 AND status = 'discovered'
             ORDER BY discovered_at ASC",
        )
        .bind(search_query_id)
        .fetch_all(&self.db)
        .await?;

        let mut scored = 0u32;
        for job_id in &job_ids {
            self.score_match(job_id, &profile_id).await?;
            scored += 1;
        }

        // Stamp the run even when nothing was pending — records the attempt.
        sqlx::query("UPDATE search_queries SET last_run_at = ?1 WHERE id = ?2")
            .bind(now_iso())
            .bind(search_query_id)
            .execute(&self.db)
            .await?;

        Ok(scored)
    }

    async fn score_match(&self, job_post_id: &str, profile_id: &str) -> DomainResult<String> {
        self.score_match_with_preference(job_post_id, profile_id, None)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    /// In-memory pool with the real migrations applied. `max_connections(1)` so
    /// every query sees the same in-memory database (memory DBs are per-conn).
    async fn mem_pool() -> SqlitePool {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    /// Seed one profile + a strong-matching preference, search query, and a
    /// `discovered` job post wired to that query. Mirrors the scorer's `base()`
    /// fixture so the deterministic result is a high-scoring auto-apply.
    async fn seed(pool: &SqlitePool) {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1', 'Test', ?1, ?1, 1)",
        )
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_preferences (
                id, profile_id, name, target_roles_json,
                seniority_json, locations_json, remote_modes_json, min_salary,
                required_skills_json, preferred_skills_json,
                excluded_keywords_json, blocked_companies_json,
                created_at, updated_at
             ) VALUES (
                'pref1', 'p1', 'Backend', '[\"Backend Engineer\",\"Rust Engineer\"]',
                '[\"senior\"]', '[\"Berlin\"]', '[\"remote\"]', 80000,
                '[\"Rust\",\"PostgreSQL\"]', '[\"Kubernetes\",\"Tokio\"]',
                '[\"unpaid\"]', '[\"EvilCorp\"]',
                ?1, ?1
             )",
        )
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO search_queries
                (id, profile_id, preference_id, platform, query, query_type, enabled, created_at)
             VALUES ('sq1', 'p1', 'pref1', 'linkedin', 'rust backend', 'linkedin_search', 1, ?1)",
        )
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts (
                id, profile_id, platform, url, title, company,
                location, remote_mode, description, seniority,
                salary_min, salary_max, discovered_at, last_seen_at,
                search_query_id, status
             ) VALUES (
                'j1', 'p1', 'linkedin', 'https://x/1',
                'Senior Rust Backend Engineer', 'Acme',
                'Berlin, Germany', 'remote',
                'We use Rust, Tokio, PostgreSQL and Kubernetes to build services', 'senior',
                90000, 120000, ?1, ?1, 'sq1', 'discovered'
             )",
        )
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn score_match_persists_row_and_routes_status() {
        let pool = mem_pool().await;
        seed(&pool).await;
        let svc = JobSearchServiceImpl::new(pool.clone());

        let match_id = svc.score_match("j1", "p1").await.unwrap();

        let (score, rec): (i64, String) =
            sqlx::query_as("SELECT score, recommendation FROM job_matches WHERE id = ?1")
                .bind(&match_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(score >= 85, "expected strong score, got {score}");
        assert_eq!(rec, "auto_apply");

        // The discovered post is advanced to 'matched' by the recommendation.
        let status: String = sqlx::query_scalar("SELECT status FROM job_posts WHERE id = 'j1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "matched");
    }

    #[tokio::test]
    async fn run_search_scores_discovered_posts_then_stamps_run() {
        let pool = mem_pool().await;
        seed(&pool).await;
        let svc = JobSearchServiceImpl::new(pool.clone());

        let n = svc.run_search("sq1").await.unwrap();
        assert_eq!(n, 1);

        // last_run_at is stamped.
        let lra: Option<String> =
            sqlx::query_scalar("SELECT last_run_at FROM search_queries WHERE id = 'sq1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(lra.is_some());

        // The post is no longer 'discovered', so a second run scores nothing.
        let n2 = svc.run_search("sq1").await.unwrap();
        assert_eq!(n2, 0);
    }

    #[tokio::test]
    async fn score_match_missing_job_is_invalid_input() {
        let pool = mem_pool().await;
        let svc = JobSearchServiceImpl::new(pool);
        let err = svc.score_match("nope", "p1").await.unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn run_search_missing_query_is_invalid_input() {
        let pool = mem_pool().await;
        let svc = JobSearchServiceImpl::new(pool);
        let err = svc.run_search("nope").await.unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn score_match_with_explicit_preference_id() {
        let pool = mem_pool().await;
        seed(&pool).await;
        let svc = JobSearchServiceImpl::new(pool.clone());

        let match_id = svc
            .score_match_with_preference("j1", "p1", Some("pref1"))
            .await
            .unwrap();

        let (rec, pref_id): (String, Option<String>) = sqlx::query_as(
            "SELECT recommendation, preference_id FROM job_matches WHERE id = ?1",
        )
        .bind(&match_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(rec, "auto_apply");
        assert_eq!(pref_id.as_deref(), Some("pref1"));
    }

    #[tokio::test]
    async fn score_match_no_preference_uses_neutral_defaults() {
        let pool = mem_pool().await;
        let now = now_iso();

        // Profile with no preference row at all.
        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p2', 'NoPref', ?1, ?1, 1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO job_posts (
                 id, profile_id, platform, url, title, company,
                 description, discovered_at, last_seen_at, status
             ) VALUES (
                 'j2', 'p2', 'linkedin', 'https://x/2',
                 'DevOps Engineer', 'Widgets',
                 'Terraform, Docker, CI/CD pipelines', ?1, ?1, 'discovered'
             )",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        let match_id = svc.score_match("j2", "p2").await.unwrap();

        // Neutral defaults must produce a non-zero score and a persisted row.
        let (score, pref_id): (i64, Option<String>) =
            sqlx::query_as("SELECT score, preference_id FROM job_matches WHERE id = ?1")
                .bind(&match_id)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert!(score > 0, "neutral scoring should not yield 0, got {score}");
        assert!(pref_id.is_none(), "no preference → preference_id NULL");
    }

    #[tokio::test]
    async fn score_match_does_not_overwrite_non_discovered_status() {
        let pool = mem_pool().await;
        seed(&pool).await;

        // Advance the post beyond 'discovered' before re-scoring.
        sqlx::query("UPDATE job_posts SET status = 'needs_review' WHERE id = 'j1'")
            .execute(&pool)
            .await
            .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        svc.score_match("j1", "p1").await.unwrap();

        // The UPDATE in score_match has `AND status = 'discovered'` guard.
        let status: String = sqlx::query_scalar("SELECT status FROM job_posts WHERE id = 'j1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "needs_review", "non-discovered status must not be overwritten");
    }

    #[tokio::test]
    async fn run_search_stamps_last_run_even_with_zero_posts() {
        let pool = mem_pool().await;
        let now = now_iso();

        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p3', 'Empty', ?1, ?1, 1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO search_queries
                 (id, profile_id, platform, query, query_type, enabled, created_at)
             VALUES ('sq_empty', 'p3', 'linkedin', 'rust', 'linkedin_search', 1, ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        let n = svc.run_search("sq_empty").await.unwrap();
        assert_eq!(n, 0, "no discovered posts → 0 scored");

        let lra: Option<String> =
            sqlx::query_scalar("SELECT last_run_at FROM search_queries WHERE id = 'sq_empty'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(lra.is_some(), "last_run_at must be stamped even when 0 posts scored");
    }
}
