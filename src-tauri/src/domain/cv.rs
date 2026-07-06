//! CV import / parsing / analysis service (Phase 2+).

use super::{DomainError, DomainResult};

/// Ingests CV documents, parses them into structured profile facts, and runs
/// gap/quality analysis producing `cv_analysis_reports`.
#[allow(async_fn_in_trait)]
pub trait CvService: Send + Sync {
    async fn import_document(&self, profile_id: &str, path: &str) -> DomainResult<String>;
    async fn analyze(&self, cv_document_id: &str) -> DomainResult<String>;
}

/// Placeholder implementation wired up in Phase 2.
pub struct CvServiceStub;

impl CvService for CvServiceStub {
    async fn import_document(&self, _profile_id: &str, _path: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("CvService::import_document"))
    }
    async fn analyze(&self, _cv_document_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("CvService::analyze"))
    }
}
