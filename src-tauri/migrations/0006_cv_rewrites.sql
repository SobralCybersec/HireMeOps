-- CV rewrites (AI-produced, tailored full CVs + derived PDF metadata).
--
-- Additive: sits alongside `cv_analysis_reports` (a critique) and never
-- replaces it. Each row is one rewrite run: the structured CV the model
-- produced (`rewrite_json` = serialized `ai::prompt::CvRewrite`) plus the
-- metadata block derived from it (`metadata_json` = serialized
-- `ai::prompt::CvMetadata`) computed exactly like the Java CV Generator's
-- `ResumeService.addPDFMetadata`, so the .tex model can consume it directly.
CREATE TABLE cv_rewrites (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cv_document_id TEXT,
  role_variant_id TEXT,
  model_provider TEXT,
  model_name TEXT,
  rewrite_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_cv_rewrites_profile_created
ON cv_rewrites(profile_id, created_at);
