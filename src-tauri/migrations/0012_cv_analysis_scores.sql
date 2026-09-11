-- Cover the document list's latest-score lookup without scanning report payloads.
CREATE INDEX IF NOT EXISTS idx_cv_analysis_profile_document_created
  ON cv_analysis_reports(profile_id, cv_document_id, created_at DESC, id DESC, score);
