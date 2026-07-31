//! Job search + matching service: scores job posts against profile preferences and routes their lifecycle status.
//! Key: JobSearchService — trait: run_search, score_match
//! Key: JobSearchServiceImpl::score_match_with_preference — scores a job post against a preference, persists job_matches, routes job_posts.status
//! Key: JobSearchServiceImpl::delete_old_scans — deletes unacted job_posts, sparing drafts/runs (age-based) or only runs (clear-all)
//! Key: parse_json_array — tolerant JSON string-array column parser

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::matching::{
    build_explanation, score_job, select_best_cv, MatchInput, Recommendation, VariantCandidate,
    AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
};
use crate::util::now_iso;

#[allow(async_fn_in_trait)]
pub trait JobSearchService: Send + Sync {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32>;
    async fn score_match(&self, job_post_id: &str, profile_id: &str) -> DomainResult<String>;
}

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

#[derive(sqlx::FromRow)]
struct VariantRow {
    id: String,
    target_title: String,
    keywords_json: Option<String>,
    preferred_cv_document_id: Option<String>,
}

fn parse_json_array(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

pub struct JobSearchServiceImpl {
    db: SqlitePool,
}

impl JobSearchServiceImpl {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
    }

    pub async fn score_match_with_preference(
        &self,
        job_post_id: &str,
        profile_id: &str,
        preference_id: Option<&str>,
    ) -> DomainResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();

        let job = sqlx::query_as::<_, ScoreJobRow>(
            "SELECT title, company, description, summary, location, remote_mode,
                    seniority, salary_min, salary_max
             FROM job_posts WHERE id = ?1",
        )
        .bind(job_post_id)
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| DomainError::InvalidInput(format!("job post {job_post_id} not found")))?;

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
            sqlx::query(
                "DELETE FROM job_posts
                 WHERE profile_id = ?1
                   AND id NOT IN (SELECT job_id FROM application_runs WHERE job_id IS NOT NULL)",
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
                "DELETE FROM job_posts
                 WHERE profile_id = ?1
                   AND discovered_at < ?2
                   AND id NOT IN (SELECT job_id FROM application_runs WHERE job_id IS NOT NULL)
                   AND id NOT IN (SELECT job_id FROM application_drafts WHERE job_id IS NOT NULL)",
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
        let profile_id: String =
            sqlx::query_scalar("SELECT profile_id FROM search_queries WHERE id = ?1")
                .bind(search_query_id)
                .fetch_optional(&self.db)
                .await?
                .ok_or_else(|| {
                    DomainError::InvalidInput(format!("search query {search_query_id} not found"))
                })?;

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

        let lra: Option<String> =
            sqlx::query_scalar("SELECT last_run_at FROM search_queries WHERE id = 'sq1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(lra.is_some());

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

        let (rec, pref_id): (String, Option<String>) =
            sqlx::query_as("SELECT recommendation, preference_id FROM job_matches WHERE id = ?1")
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

        sqlx::query("UPDATE job_posts SET status = 'needs_review' WHERE id = 'j1'")
            .execute(&pool)
            .await
            .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        svc.score_match("j1", "p1").await.unwrap();

        let status: String = sqlx::query_scalar("SELECT status FROM job_posts WHERE id = 'j1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status, "needs_review",
            "non-discovered status must not be overwritten"
        );
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
        assert!(
            lra.is_some(),
            "last_run_at must be stamped even when 0 posts scored"
        );
    }

    #[tokio::test]
    async fn delete_old_scans_removes_only_stale_unacted_jobs() {
        use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

        let pool = mem_pool().await;
        let now = now_iso();
        let old_ts = (OffsetDateTime::now_utc() - Duration::days(31))
            .format(&Rfc3339)
            .unwrap();

        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p_del', 'Del Test', ?1, ?1, 1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_stale', 'p_del', 'linkedin', 'https://x/stale', 'Stale Job', 'ACME', 'desc', ?1)",
        )
        .bind(&old_ts)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_drafted', 'p_del', 'linkedin', 'https://x/drafted', 'Draft Job', 'ACME', 'desc', ?1)",
        )
        .bind(&old_ts)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO application_drafts
               (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
             VALUES ('d_del', 'j_drafted', 'p_del', 'Dear team', '[]', 'draft', ?1, ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_fresh', 'p_del', 'linkedin', 'https://x/fresh', 'Fresh Job', 'ACME', 'desc', ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        let deleted = svc.delete_old_scans("p_del", 30).await.unwrap();
        assert_eq!(deleted, 1, "only the stale+unacted job should be deleted");

        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM job_posts WHERE profile_id = 'p_del'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining, 2, "j_drafted and j_fresh must survive");
    }

    #[tokio::test]
    async fn delete_old_scans_zero_deletes_all_unacted() {
        let pool = mem_pool().await;
        let now = now_iso();

        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p_zero', 'Zero Test', ?1, ?1, 1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_recent_unacted', 'p_zero', 'linkedin', 'https://x/ru',
                     'New Job', 'ACME', 'desc', ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_drafted_only', 'p_zero', 'linkedin', 'https://x/do',
                     'Drafted Job', 'ACME', 'desc', ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO application_drafts
               (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
             VALUES ('d_zero', 'j_drafted_only', 'p_zero', 'cover', '[]', 'draft', ?1, ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO job_posts
               (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j_applied', 'p_zero', 'linkedin', 'https://x/ap',
                     'Applied Job', 'ACME', 'desc', ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO application_drafts
               (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
             VALUES ('d_applied', 'j_applied', 'p_zero', 'cover', '[]', 'draft', ?1, ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO application_runs
               (id, draft_id, job_id, profile_id, platform, mode, status, started_at)
             VALUES ('r_applied', 'd_applied', 'j_applied', 'p_zero', 'linkedin',
                     'auto_submit', 'completed', ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let svc = JobSearchServiceImpl::new(pool.clone());
        let deleted = svc.delete_old_scans("p_zero", 0).await.unwrap();
        assert_eq!(deleted, 2, "clear-all deletes the unacted job AND the draft-only job");

        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM job_posts WHERE profile_id = 'p_zero'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining, 1, "the applied job must survive");
    }
}
