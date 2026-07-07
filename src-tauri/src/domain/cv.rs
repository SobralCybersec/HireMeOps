//! CV import / parsing / analysis service (Phase 2+).

use std::path::PathBuf;

use sqlx::SqlitePool;
use uuid::Uuid;

use super::{DomainError, DomainResult};
use crate::cv::{self, DocKind};
use crate::util::now_iso;

/// Ingests CV documents, parses them into structured profile facts, and runs
/// gap/quality analysis producing `cv_analysis_reports`.
#[allow(async_fn_in_trait)]
pub trait CvService: Send + Sync {
    async fn import_document(&self, profile_id: &str, path: &str) -> DomainResult<String>;
    async fn analyze(&self, cv_document_id: &str) -> DomainResult<String>;
}

/// Placeholder implementation (kept for reference / early Phase-1 wiring).
pub struct CvServiceStub;

impl CvService for CvServiceStub {
    async fn import_document(&self, _profile_id: &str, _path: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("CvService::import_document"))
    }
    async fn analyze(&self, _cv_document_id: &str) -> DomainResult<String> {
        Err(DomainError::NotImplemented("CvService::analyze"))
    }
}

/// Concrete `CvService` backed by the SQLite pool and the on-disk CV file store.
///
/// `import_document` is idempotent per `(profile_id, file_hash)`: re-importing
/// identical bytes returns the existing document id instead of duplicating.
pub struct CvServiceImpl {
    db: SqlitePool,
    cv_files_dir: PathBuf,
}

impl CvServiceImpl {
    pub fn new(db: SqlitePool, cv_files_dir: PathBuf) -> Self {
        Self { db, cv_files_dir }
    }
}

impl CvService for CvServiceImpl {
    async fn import_document(&self, profile_id: &str, path: &str) -> DomainResult<String> {
        let src = std::path::Path::new(path);
        let file_name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| DomainError::InvalidInput(format!("bad file path: {path}")))?
            .to_string();

        let kind = cv::detect_kind(&file_name).ok_or_else(|| {
            DomainError::InvalidInput(format!("unsupported file type: {file_name}"))
        })?;
        let file_type = match kind {
            DocKind::Pdf => "pdf",
            DocKind::Docx => "docx",
        };

        let bytes =
            std::fs::read(src).map_err(|e| DomainError::InvalidInput(format!("read {path}: {e}")))?;
        let file_hash = cv::hash_bytes(&bytes);

        // Idempotent import: identical content for this profile → existing row.
        if let Some(existing) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM cv_documents WHERE profile_id = ?1 AND file_hash = ?2",
        )
        .bind(profile_id)
        .bind(&file_hash)
        .fetch_optional(&self.db)
        .await?
        {
            return Ok(existing);
        }

        // Validate + extract by actually parsing *before* persisting anything —
        // a corrupt/unsupported file must never leave a dangling row or copy.
        let parsed = cv::parse(kind, &bytes)
            .map_err(|e| DomainError::InvalidInput(format!("parse {file_name}: {e}")))?;
        tracing::debug!(
            profile_id,
            file_name = %file_name,
            chars = parsed.text.len(),
            sections = parsed.sections.len(),
            page_count = ?parsed.page_count,
            "parsed CV document"
        );

        // Copy into the per-profile store: {cv_files_dir}/{profile_id}/{hash}.{ext}
        let profile_dir = self.cv_files_dir.join(profile_id);
        std::fs::create_dir_all(&profile_dir).map_err(|e| {
            DomainError::Other(anyhow::anyhow!("create {}: {e}", profile_dir.display()))
        })?;
        let stored = profile_dir.join(format!("{file_hash}.{file_type}"));
        std::fs::write(&stored, &bytes)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("write {}: {e}", stored.display())))?;
        let stored_path = stored.to_string_lossy().into_owned();

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let size_bytes = bytes.len() as i64;
        let page_count = parsed.page_count.map(|p| p as i64);

        sqlx::query(
            "INSERT INTO cv_documents (
                id, profile_id, file_name, file_type, file_hash, stored_path,
                preview_path, parser_version, last_parsed_at,
                size_bytes, page_count, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(&file_name)
        .bind(file_type)
        .bind(&file_hash)
        .bind(&stored_path)
        .bind(Option::<String>::None) // preview_path — rendered lazily by the viewer
        .bind(cv::PARSER_VERSION)
        .bind(&now) // last_parsed_at
        .bind(size_bytes)
        .bind(page_count)
        .bind(&now) // created_at
        .bind(&now) // updated_at
        .execute(&self.db)
        .await?;

        Ok(id)
    }

    async fn analyze(&self, _cv_document_id: &str) -> DomainResult<String> {
        // Gap/quality analysis is AI-backed — wired in Phase 4 (task #28).
        Err(DomainError::NotImplemented("CvService::analyze"))
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

    async fn insert_profile(pool: &SqlitePool, id: &str) {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES (?1, 'Test', ?2, ?2, 1)",
        )
        .bind(id)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    fn unique_tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hiremeops-cv-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fixture(name: &str) -> String {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[tokio::test]
    async fn imports_pdf_persists_metadata_and_is_idempotent() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());
        let pdf = fixture("sample.pdf");

        let id1 = svc.import_document("p1", &pdf).await.unwrap();

        let (ft, pages, size, ver): (String, Option<i64>, Option<i64>, Option<String>) =
            sqlx::query_as(
                "SELECT file_type, page_count, size_bytes, parser_version
                 FROM cv_documents WHERE id = ?1",
            )
            .bind(&id1)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(ft, "pdf");
        assert_eq!(pages, Some(2));
        assert!(size.unwrap() > 0);
        assert_eq!(ver.as_deref(), Some(cv::PARSER_VERSION));

        // The bytes were copied into the per-profile store.
        assert!(tmp.join("p1").read_dir().unwrap().next().is_some());

        // Re-importing identical bytes returns the same id (dedupe), no dup row.
        let id2 = svc.import_document("p1", &pdf).await.unwrap();
        assert_eq!(id1, id2);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn imports_docx_with_no_page_count() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

        let id = svc.import_document("p1", &fixture("sample.docx")).await.unwrap();
        let (ft, pages): (String, Option<i64>) =
            sqlx::query_as("SELECT file_type, page_count FROM cv_documents WHERE id = ?1")
                .bind(&id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(ft, "docx");
        assert_eq!(pages, None);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn rejects_unsupported_extension_without_persisting() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let tmp = unique_tmp_dir();
        let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

        let err = svc
            .import_document("p1", "/nonexistent/whatever.txt")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);

        std::fs::remove_dir_all(&tmp).ok();
    }
}
