-- Shared ownership starts here. Existing local SQLite tables remain untouched.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE shared_jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  platform TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote_mode TEXT,
  description TEXT NOT NULL,
  summary TEXT,
  salary_min BIGINT,
  salary_max BIGINT,
  currency TEXT,
  seniority TEXT,
  employment_type TEXT,
  posted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT,
  search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(company, '') || ' ' ||
      coalesce(location, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(summary, '')
    )
  ) STORED,
  embedding vector,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  CHECK (embedding IS NULL OR embedding_dimensions = vector_dims(embedding))
);

CREATE INDEX shared_jobs_search_document_gin
  ON shared_jobs USING GIN (search_document);

CREATE INDEX shared_jobs_profile_discovered
  ON shared_jobs (profile_id, discovered_at DESC, id ASC);

CREATE TABLE job_discoveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES shared_jobs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_url TEXT,
  description_fingerprint TEXT,
  dedupe_reason TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);

CREATE INDEX job_discoveries_job ON job_discoveries (job_id);

CREATE TABLE search_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  intent TEXT NOT NULL,
  query_plan JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
  error TEXT
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total_steps INTEGER NOT NULL DEFAULT 0 CHECK (total_steps >= 0),
  total_tokens BIGINT CHECK (total_tokens IS NULL OR total_tokens >= 0),
  error TEXT
);

CREATE TABLE agent_run_steps (
  id BIGSERIAL PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step INTEGER NOT NULL CHECK (step >= 0),
  tool_name TEXT NOT NULL,
  latency_ms BIGINT CHECK (latency_ms IS NULL OR latency_ms >= 0),
  success BOOLEAN NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_run_id, step, tool_name)
);

CREATE INDEX agent_run_steps_run ON agent_run_steps (agent_run_id, step);
