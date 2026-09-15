ALTER TABLE shared_jobs ADD COLUMN search_run_id TEXT REFERENCES search_runs(id) ON DELETE SET NULL;

CREATE INDEX shared_jobs_search_run ON shared_jobs (search_run_id)
  WHERE search_run_id IS NOT NULL;

CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL UNIQUE,
  encrypted_state BYTEA NOT NULL,
  encryption_version INTEGER NOT NULL CHECK (encryption_version > 0),
  state_format_version INTEGER NOT NULL CHECK (state_format_version > 0),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('valid', 'expired', 'login_required', 'challenged', 'unknown', 'revoked')),
  platform_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at TIMESTAMPTZ
);

CREATE INDEX browser_sessions_status ON browser_sessions (status, updated_at DESC);
