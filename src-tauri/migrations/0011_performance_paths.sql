-- Query-shape indexes for the hot list, search, scoring, and cleanup paths.
CREATE INDEX IF NOT EXISTS idx_jobs_profile_discovered_id
  ON job_posts(profile_id, discovered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_profile_status_discovered_id
  ON job_posts(profile_id, status, discovered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_search_discovered
  ON job_posts(search_query_id, discovered_at ASC, id ASC)
  WHERE status = 'discovered';

CREATE INDEX IF NOT EXISTS idx_cv_analysis_document_created
  ON cv_analysis_reports(cv_document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_preferences_profile_updated
  ON job_preferences(profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_variants_profile_created
  ON profile_variants(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_drafts_job
  ON application_drafts(job_id);

-- Rebuild the external-content FTS index with prefix segments. The source data
-- remains in job_posts; only the derived index is replaced.
DROP TRIGGER IF EXISTS job_posts_fts_ai;
DROP TRIGGER IF EXISTS job_posts_fts_ad;
DROP TRIGGER IF EXISTS job_posts_fts_au;
DROP TABLE IF EXISTS job_posts_fts;

CREATE VIRTUAL TABLE job_posts_fts USING fts5(
  title,
  company,
  location,
  description,
  summary,
  content='job_posts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

CREATE TRIGGER job_posts_fts_ai AFTER INSERT ON job_posts BEGIN
  INSERT INTO job_posts_fts(rowid, title, company, location, description, summary)
  VALUES (new.rowid, new.title, new.company, new.location, new.description, new.summary);
END;

CREATE TRIGGER job_posts_fts_ad AFTER DELETE ON job_posts BEGIN
  INSERT INTO job_posts_fts(job_posts_fts, rowid, title, company, location, description, summary)
  VALUES ('delete', old.rowid, old.title, old.company, old.location, old.description, old.summary);
END;

CREATE TRIGGER job_posts_fts_au AFTER UPDATE ON job_posts BEGIN
  INSERT INTO job_posts_fts(job_posts_fts, rowid, title, company, location, description, summary)
  VALUES ('delete', old.rowid, old.title, old.company, old.location, old.description, old.summary);
  INSERT INTO job_posts_fts(rowid, title, company, location, description, summary)
  VALUES (new.rowid, new.title, new.company, new.location, new.description, new.summary);
END;

INSERT INTO job_posts_fts(rowid, title, company, location, description, summary)
SELECT rowid, title, company, location, description, summary FROM job_posts;
