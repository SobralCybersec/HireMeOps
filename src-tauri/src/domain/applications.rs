//! Application drafting + submission service (Phase 3+).

use super::{DomainError, DomainResult};

/// Builds `application_drafts`, renders `application_artifacts`, and records
/// `application_runs`. The per-URL lock (`application_url_locks`) prevents
/// double-applying to the same posting.
#[allow(async_fn_in_trait)]
pub trait ApplicationService: Send + Sync {
    async fn draft(&self, job_match_id: &str) -> DomainResult<String>;
    async fn submit(&self, application_draft_id: &str) -> DomainResult<String>;
}

pub struct ApplicationServiceStub;

impl ApplicationService for ApplicationServiceStub {
    async fn draft(&self, _job_match_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("ApplicationService::draft"))
    }
    async fn submit(&self, _application_draft_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("ApplicationService::submit"))
    }
}
