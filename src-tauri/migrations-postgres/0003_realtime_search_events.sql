ALTER TABLE shared_jobs
  ADD COLUMN IF NOT EXISTS search_run_id TEXT REFERENCES search_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shared_jobs_search_run
  ON shared_jobs(search_run_id);

ALTER TABLE search_runs
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  ADD COLUMN persisted_count INTEGER NOT NULL DEFAULT 0 CHECK (persisted_count >= 0),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE search_runs
SET phase = CASE status
  WHEN 'completed' THEN 'completed'
  WHEN 'failed' THEN 'failed'
  WHEN 'cancelled' THEN 'cancelled'
  ELSE 'queued'
END;

ALTER TABLE search_runs
  ADD CONSTRAINT search_runs_phase_check CHECK (
    phase IN (
      'queued', 'validating_session', 'launching_browser', 'navigating',
      'discovering', 'enriching', 'persisting', 'syncing_session',
      'completed', 'failed', 'cancelled'
    )
  );

CREATE TABLE search_run_events (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  profile_id TEXT,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX search_run_events_run_seq
  ON search_run_events(search_run_id, seq);

CREATE INDEX search_run_events_profile_seq
  ON search_run_events(profile_id, seq);
