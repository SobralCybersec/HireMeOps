//! Job search + matching service (Phase 3+).

use super::{DomainError, DomainResult};

/// Runs saved `search_queries`, ingests `job_posts` (keeping duplicates as
/// separate rows), and scores `job_matches` against the active profile.
#[allow(async_fn_in_trait)]
pub trait JobSearchService: Send + Sync {
    async fn run_search(&self, search_query_id: &str) -> DomainResult<u32>;
    async fn score_match(&self, job_post_id: &str, profile_id: &str) -> DomainResult<String>;
}

pub struct JobSearchServiceStub;

impl JobSearchService for JobSearchServiceStub {
    async fn run_search(&self, _search_query_id: &str) -> DomainResult<u32> {
        Err(DomainError::NotImplemented("JobSearchService::run_search"))
    }
    async fn score_match(&self, _job_post_id: &str, _profile_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("JobSearchService::score_match"))
    }
}
