-- Full-text search over job_posts. External-content FTS5 index: the text stays
-- in job_posts, only the inverted index lives here (no duplication).
CREATE VIRTUAL TABLE job_posts_fts USING fts5(
  title,
  company,
  location,
  description,
  summary,
  content='job_posts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep the index in lockstep with job_posts. External-content tables require the
-- special 'delete' command form to retract a row's old terms before re-indexing.
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

-- Backfill rows that existed before this migration.
INSERT INTO job_posts_fts(rowid, title, company, location, description, summary)
SELECT rowid, title, company, location, description, summary FROM job_posts;
