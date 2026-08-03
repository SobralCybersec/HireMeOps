-- ============================================================
-- Migration 0004: Performance indices for export/list handlers
--
-- Idempotent (IF NOT EXISTS). Adds only indices — no schema semantics change.
-- Each covers a column combination actually used by an export list query in
-- src-tauri/src/domain/exports.rs that lacked a usable leftmost-prefix index.
-- ============================================================

-- export_profiles_json: "SELECT ... FROM profiles ORDER BY created_at".
-- Only idx_profiles_active(is_active) existed; no index served the sort.
CREATE INDEX IF NOT EXISTS idx_profiles_created ON profiles(created_at);

-- export_profiles_json (batched CV fetch):
-- "SELECT ... FROM cv_documents ORDER BY profile_id, created_at".
-- idx_cv_documents_profile(profile_id) covered the group but not the sort tail.
CREATE INDEX IF NOT EXISTS idx_cv_documents_profile_created
  ON cv_documents(profile_id, created_at);

-- export_jobs_csv: "... (SELECT job_id, MAX(score) FROM job_matches GROUP BY job_id) ...".
-- idx_matches_profile_job(profile_id, job_id) is profile_id-leading, so it can
-- not serve a bare GROUP BY job_id.
CREATE INDEX IF NOT EXISTS idx_matches_job ON job_matches(job_id);

-- export_audit_csv: "SELECT ... FROM audit_logs ORDER BY created_at DESC".
-- idx_audit_profile_created(profile_id, created_at) is profile_id-leading.
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
