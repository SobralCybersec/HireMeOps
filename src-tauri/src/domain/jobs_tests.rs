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

    let match_id = svc
        .score_match(&JobId::from("j1"), &ProfileId::from("p1"))
        .await
        .unwrap();

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
    let err = svc
        .score_match(&JobId::from("nope"), &ProfileId::from("p1"))
        .await
        .unwrap_err();
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
        .score_match_with_preference(&JobId::from("j1"), &ProfileId::from("p1"), Some("pref1"))
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
    let match_id = svc
        .score_match(&JobId::from("j2"), &ProfileId::from("p2"))
        .await
        .unwrap();

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
    svc.score_match(&JobId::from("j1"), &ProfileId::from("p1"))
        .await
        .unwrap();

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

struct ScanJob<'a> {
    id: &'a str,
    title: &'a str,
    status: &'a str,
}

impl<'a> ScanJob<'a> {
    fn new(id: &'a str, title: &'a str, status: Option<&'a str>) -> Self {
        Self {
            id,
            title,
            status: status.unwrap_or("discovered"),
        }
    }
}

struct RunSeed<'a> {
    id: &'a str,
    draft_id: &'a str,
    job_id: &'a str,
    mode: &'a str,
    status: &'a str,
}

async fn insert_profile(pool: &SqlitePool, id: &str, now: &str) {
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES (?1, 'Zero Test', ?2, ?2, 1)",
    )
    .bind(id)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_scan_job(pool: &SqlitePool, now: &str, job: ScanJob<'_>) {
    sqlx::query(
        "INSERT INTO job_posts
           (id, profile_id, platform, url, title, company, description, status, discovered_at)
         VALUES (?1, 'p_zero', 'linkedin', ?2, ?3, 'ACME', 'desc', ?4, ?5)",
    )
    .bind(job.id)
    .bind(format!("https://x/{}", job.id))
    .bind(job.title)
    .bind(job.status)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_draft(pool: &SqlitePool, now: &str, draft_id: &str, job_id: &str) {
    sqlx::query(
        "INSERT INTO application_drafts
           (id, job_id, profile_id, cover_letter, form_answers_json, status, created_at, updated_at)
         VALUES (?1, ?2, 'p_zero', 'cover', '[]', 'draft', ?3, ?3)",
    )
    .bind(draft_id)
    .bind(job_id)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_run(pool: &SqlitePool, now: &str, run: RunSeed<'_>) {
    sqlx::query(
        "INSERT INTO application_runs
           (id, draft_id, job_id, profile_id, platform, mode, status, started_at)
         VALUES (?1, ?2, ?3, 'p_zero', 'linkedin', ?4, ?5, ?6)",
    )
    .bind(run.id)
    .bind(run.draft_id)
    .bind(run.job_id)
    .bind(run.mode)
    .bind(run.status)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn delete_old_scans_zero_deletes_all_unacted() {
    let (pool, now) = (mem_pool().await, now_iso());
    insert_profile(&pool, "p_zero", &now).await;
    insert_scan_job(
        &pool,
        &now,
        ScanJob::new("j_recent_unacted", "New Job", None),
    )
    .await;
    insert_scan_job(
        &pool,
        &now,
        ScanJob::new("j_drafted_only", "Drafted Job", None),
    )
    .await;
    insert_draft(&pool, &now, "d_zero", "j_drafted_only").await;

    // Applied status is the only clear-all survivor.
    insert_scan_job(
        &pool,
        &now,
        ScanJob::new("j_applied", "Applied Job", Some("applied")),
    )
    .await;
    insert_draft(&pool, &now, "d_applied", "j_applied").await;
    insert_run(
        &pool,
        &now,
        RunSeed {
            id: "r_applied",
            draft_id: "d_applied",
            job_id: "j_applied",
            mode: "auto_submit",
            status: "completed",
        },
    )
    .await;

    // Queued run exists, but queued status is still removed by clear-all.
    insert_scan_job(
        &pool,
        &now,
        ScanJob::new("j_queued", "Queued Job", Some("queued")),
    )
    .await;
    insert_draft(&pool, &now, "d_queued", "j_queued").await;
    insert_run(
        &pool,
        &now,
        RunSeed {
            id: "r_queued",
            draft_id: "d_queued",
            job_id: "j_queued",
            mode: "manual_assist",
            status: "started",
        },
    )
    .await;

    insert_scan_job(
        &pool,
        &now,
        ScanJob::new("j_ignored", "Ignored Job", Some("ignored")),
    )
    .await;

    let svc = JobSearchServiceImpl::new(pool.clone());
    let deleted = svc.delete_old_scans("p_zero", 0).await.unwrap();
    assert_eq!(
        deleted, 4,
        "clear-all deletes unacted + draft-only + queued + ignored"
    );

    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM job_posts WHERE profile_id = 'p_zero'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 1, "only the applied job must survive");
}

#[test]
fn fts_query_quotes_escapes_and_prefixes() {
    assert_eq!(fts_query("rust backend"), "\"rust\"* \"backend\"*");
    assert_eq!(fts_query("  spaced   out "), "\"spaced\"* \"out\"*");
    assert_eq!(fts_query("a\"b"), "\"a\"\"b\"*");
    assert_eq!(fts_query(""), "");
}

#[tokio::test]
async fn fts_search_ranks_title_match_first() {
    let pool = mem_pool().await;
    let now = now_iso();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1','T',?1,?1,1)",
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
            "INSERT INTO job_posts (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j1','p1','linkedin','https://x/1','Rust Engineer','Acme','we build web things',?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
            "INSERT INTO job_posts (id, profile_id, platform, url, title, company, description, discovered_at)
             VALUES ('j2','p1','linkedin','https://x/2','Backend Engineer','Beta','some rust only in the body',?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let ids = JobSearchServiceImpl::new(pool)
        .search_job_posts(&ProfileId::from("p1"), "rust", 10)
        .await
        .unwrap();
    assert_eq!(ids.len(), 2, "both posts mention rust");
    assert_eq!(
        ids.first().map(String::as_str),
        Some("j1"),
        "title hit outranks body-only hit"
    );
}
