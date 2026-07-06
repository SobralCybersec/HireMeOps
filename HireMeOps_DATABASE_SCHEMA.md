# HireMeOps — Database Schema

## 1. Database Strategy

Database:

```txt
SQLite local database
SQLx migrations
Single-device only
Local-first
Portable mode supported
Database-only backup/restore
```

Reasons:

- SQLite is sufficient for local-first desktop state.
- SQLx supports SQLite and migrations.
- Heavy artifacts should live on disk, not in hot database tables.

Sources:

- SQLx: https://github.com/launchbadge/sqlx
- SQLx migrate macro: https://docs.rs/sqlx/latest/sqlx/macro.migrate.html

---

## 2. File Storage Layout

Normal mode:

```txt
<AppData>/HireMeOps/
├─ hiremeops.sqlite
├─ profiles/
│  └─ <profile_id>/
│     ├─ cvs/
│     │  ├─ original/
│     │  └─ previews/
│     ├─ evidence/
│     │  ├─ screenshots/
│     │  └─ dom/
│     └─ exports/
├─ browser-profiles/
│  └─ <profile_id>/
│     └─ linkedin-chromium/
├─ backups/
└─ logs/
```

Portable mode:

```txt
<ExecutableDir>/HireMeOpsData/
├─ hiremeops.sqlite
├─ profiles/
├─ browser-profiles/
├─ backups/
└─ logs/
```

Portable toggle behavior:

```txt
When enabled, move existing data automatically.
When disabled, move data back to app data directory automatically.
Show progress through events.
Create a rollback marker before moving.
```

---

## 3. Migration 0001 — Core Profiles

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  target_title TEXT,
  summary TEXT,
  location TEXT,
  remote_preference TEXT,
  seniority TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_profiles_active ON profiles(is_active);
```

---

## 4. Profile Links

```sql
CREATE TABLE profile_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  url TEXT,
  value_encrypted TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_profile_links_profile ON profile_links(profile_id);
```

Kinds:

```txt
linkedin
github
portfolio
email
phone
website
other
```

---

## 5. Profile Facts

Facts are used for auto-answering salary, legal, work authorization, availability, and language fields.

```sql
CREATE TABLE profile_facts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_profile_facts_key
ON profile_facts(profile_id, fact_key);
```

Required v1 facts:

```txt
salary_expectation_min
salary_expectation_currency
salary_expectation_period
work_authorized_brazil
work_authorized_eu
requires_visa_sponsorship_brazil
requires_visa_sponsorship_eu
available_start_date
willing_to_relocate
english_level
```

---

## 6. CV Documents

Raw CV text is not stored permanently. CV files are copied into app storage and re-parsed when needed.

```sql
CREATE TABLE cv_documents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  preview_path TEXT,
  parser_version TEXT,
  last_parsed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_cv_documents_profile ON cv_documents(profile_id);
CREATE INDEX idx_cv_documents_hash ON cv_documents(file_hash);
```

---

## 7. Profile Variants

```sql
CREATE TABLE profile_variants (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_title TEXT NOT NULL,
  summary TEXT,
  headline TEXT,
  keywords_json TEXT,
  preferred_cv_document_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preferred_cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL
);

CREATE INDEX idx_profile_variants_profile ON profile_variants(profile_id);
```

Examples:

```txt
Java Backend Developer
Fullstack Developer
Rust Developer
Cybersecurity Analyst
DevOps Junior
```

---

## 8. Multiple Active CVs

```sql
CREATE TABLE profile_active_cvs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cv_document_id TEXT NOT NULL,
  role_variant_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE CASCADE
);

CREATE INDEX idx_profile_active_cvs_profile
ON profile_active_cvs(profile_id);

CREATE INDEX idx_profile_active_cvs_variant
ON profile_active_cvs(role_variant_id);
```

Selection rule:

```txt
For each job, score all active CVs and pick the highest match automatically.
```

---

## 9. CV Analysis Reports

```sql
CREATE TABLE cv_analysis_reports (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cv_document_id TEXT,
  role_variant_id TEXT,
  model_provider TEXT,
  model_name TEXT,
  score INTEGER,
  summary TEXT,
  optimization_needed INTEGER NOT NULL DEFAULT 0,
  missing_keywords_json TEXT,
  strengths_json TEXT,
  weaknesses_json TEXT,
  recommendations_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_cv_analysis_profile_created
ON cv_analysis_reports(profile_id, created_at);
```

---

## 10. Skills

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  proficiency TEXT,
  years_experience REAL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_skills_profile ON skills(profile_id);
CREATE INDEX idx_skills_name ON skills(name);
```

---

## 11. Experiences

```sql
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  company TEXT,
  title TEXT NOT NULL,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  bullets_json TEXT,
  skills_json TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_experiences_profile ON experiences(profile_id);
```

---

## 12. Projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT,
  url TEXT,
  repository_url TEXT,
  technologies_json TEXT,
  highlights_json TEXT,
  metrics_json TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_profile ON projects(profile_id);
```

---

## 13. Education

```sql
CREATE TABLE education (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  institution TEXT NOT NULL,
  degree TEXT,
  field TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_education_profile ON education(profile_id);
```

---

## 14. Certifications

```sql
CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT,
  issue_date TEXT,
  expiration_date TEXT,
  credential_id TEXT,
  credential_url TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_certifications_profile ON certifications(profile_id);
```

---

## 15. Languages

```sql
CREATE TABLE languages (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_languages_profile ON languages(profile_id);
```

---

## 16. Job Preferences

```sql
CREATE TABLE job_preferences (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_roles_json TEXT NOT NULL,
  seniority_json TEXT,
  locations_json TEXT,
  remote_modes_json TEXT,
  min_salary INTEGER,
  salary_currency TEXT,
  required_skills_json TEXT,
  preferred_skills_json TEXT,
  excluded_keywords_json TEXT,
  blocked_companies_json TEXT,
  auto_apply_enabled INTEGER NOT NULL DEFAULT 1,
  auto_submit_enabled INTEGER NOT NULL DEFAULT 1,
  auto_submit_min_score INTEGER NOT NULL DEFAULT 60,
  needs_review_confidence_threshold INTEGER NOT NULL DEFAULT 50,
  retry_failed_enabled INTEGER NOT NULL DEFAULT 1,
  retry_limit INTEGER NOT NULL DEFAULT 10,
  daily_application_limit INTEGER,
  daily_connection_limit INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_preferences_profile ON job_preferences(profile_id);
```

`NULL` daily limits means no app-level limit configured.

---

## 17. Search Queries

```sql
CREATE TABLE search_queries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  preference_id TEXT,
  platform TEXT NOT NULL,
  query TEXT NOT NULL,
  query_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES job_preferences(id) ON DELETE SET NULL
);

CREATE INDEX idx_search_queries_profile ON search_queries(profile_id);
CREATE INDEX idx_search_queries_enabled ON search_queries(enabled);
```

Types:

```txt
linkedin_search
google_dork
company_career_page
manual
```

---

## 18. Job Posts

Duplicate jobs are not merged. Do not create a unique index on URL.

```sql
CREATE TABLE job_posts (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  platform TEXT NOT NULL,
  external_id TEXT,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote_mode TEXT,
  description TEXT NOT NULL,
  summary TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  currency TEXT,
  seniority TEXT,
  employment_type TEXT,
  posted_at TEXT,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT,
  content_hash TEXT,
  discovery_source TEXT,
  search_query_id TEXT,
  duplicate_group_hash TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (search_query_id) REFERENCES search_queries(id) ON DELETE SET NULL
);

CREATE INDEX idx_jobs_profile_status ON job_posts(profile_id, status);
CREATE INDEX idx_jobs_discovered ON job_posts(discovered_at);
CREATE INDEX idx_jobs_canonical_url ON job_posts(profile_id, platform, canonical_url);
CREATE INDEX idx_jobs_company ON job_posts(company);
```

Statuses:

```txt
discovered
matched
rejected
queued
applied
failed
needs_review
saved
ignored
skipped_duplicate_url
```

---

## 19. Job Matches

Preserve old match scores for history.

```sql
CREATE TABLE job_matches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  preference_id TEXT,
  cv_document_id TEXT,
  role_variant_id TEXT,
  score INTEGER NOT NULL,
  role_score INTEGER,
  skill_score INTEGER,
  seniority_score INTEGER,
  location_score INTEGER,
  salary_score INTEGER,
  complexity_score INTEGER,
  matched_skills_json TEXT,
  missing_skills_json TEXT,
  risk_flags_json TEXT,
  recommendation TEXT NOT NULL,
  explanation TEXT,
  model_provider TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES job_preferences(id) ON DELETE SET NULL,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_matches_profile_job ON job_matches(profile_id, job_id);
CREATE INDEX idx_matches_score ON job_matches(score);
CREATE INDEX idx_matches_created ON job_matches(created_at);
```

Recommendations:

```txt
auto_apply
review_first
skip
save_for_later
```

---

## 20. Application Drafts

```sql
CREATE TABLE application_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  match_id TEXT,
  cv_document_id TEXT,
  role_variant_id TEXT,
  cover_letter TEXT,
  form_answers_json TEXT,
  generated_summary TEXT,
  optimization_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES job_matches(id) ON DELETE SET NULL,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_application_drafts_profile_status
ON application_drafts(profile_id, status);
```

---

## 21. Application Artifacts

```sql
CREATE TABLE application_artifacts (
  id TEXT PRIMARY KEY,
  application_draft_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  cache_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (application_draft_id) REFERENCES application_drafts(id) ON DELETE CASCADE
);

CREATE INDEX idx_application_artifacts_draft
ON application_artifacts(application_draft_id);
```

Types:

```txt
cover_letter
form_answer
resume_variant
cv_review
optimization_note
```

---

## 22. Application Runs

```sql
CREATE TABLE application_runs (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failure_reason TEXT,
  browser_session_id TEXT,
  FOREIGN KEY (draft_id) REFERENCES application_drafts(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_app_runs_profile_status ON application_runs(profile_id, status);
CREATE INDEX idx_app_runs_job ON application_runs(job_id);
CREATE INDEX idx_app_runs_started ON application_runs(started_at);
```

Modes:

```txt
auto_fill
auto_submit
dry_run
manual_assist
```

Statuses:

```txt
started
completed
failed
needs_review
retry_scheduled
skipped_duplicate_url
paused_for_captcha
```

---

## 23. Application URL Locks

Per-profile lock to prevent applying twice to the same URL.

```sql
CREATE TABLE application_url_locks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_job_id TEXT NOT NULL,
  first_application_run_id TEXT,
  locked_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (first_job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (first_application_run_id) REFERENCES application_runs(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_application_url_locks_profile_url
ON application_url_locks(profile_id, platform, canonical_url);
```

---

## 24. Connection Targets

No recruiter messages in v1.

```sql
CREATE TABLE connection_targets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_url TEXT NOT NULL,
  full_name TEXT,
  headline TEXT,
  company TEXT,
  location TEXT,
  match_reason TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  discovered_at TEXT NOT NULL,
  connected_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_connection_targets_profile_status
ON connection_targets(profile_id, status);
```

Statuses:

```txt
discovered
queued
connected
skipped
blocked
failed
```

---

## 25. Automation Tasks

```sql
CREATE TABLE automation_tasks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  target_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  scheduled_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  payload_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_profile_status ON automation_tasks(profile_id, status);
CREATE INDEX idx_tasks_scheduled ON automation_tasks(status, scheduled_at);
CREATE INDEX idx_tasks_priority ON automation_tasks(priority);
```

Types:

```txt
parse_cv
analyze_cv
recalculate_matches
search_jobs
score_job
select_cv
generate_application
apply_job
connect_person
google_dork_search
sync_platform
cleanup
backup
restore
move_portable_data
```

---

## 26. Automation Evidence

Evidence is stored on disk. Database stores metadata and paths.

```sql
CREATE TABLE automation_evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  application_run_id TEXT,
  evidence_type TEXT NOT NULL,
  file_path TEXT,
  content TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (task_id) REFERENCES automation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (application_run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_evidence_task ON automation_evidence(task_id);
CREATE INDEX idx_evidence_run ON automation_evidence(application_run_id);
CREATE INDEX idx_evidence_expires ON automation_evidence(expires_at);
```

Types:

```txt
screenshot
dom_snapshot
console_log
network_error
form_state
```

Default expiration:

```txt
1 day
```

---

## 27. Browser Sessions

```sql
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  engine TEXT NOT NULL,
  user_data_dir TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_browser_sessions_profile_platform
ON browser_sessions(profile_id, platform);
```

Engines:

```txt
playwright_chromium
playwright_firefox_future
webview2_experimental_future
```

---

## 28. AI Providers

```sql
CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,
  default_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_providers_enabled ON ai_providers(enabled);
```

Provider types:

```txt
openai_compatible
anthropic_compatible
ollama
custom_proxy
disabled
```

---

## 29. AI Cache

```sql
CREATE TABLE ai_cache (
  id TEXT PRIMARY KEY,
  provider_id TEXT,
  model_name TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response_text TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_ai_cache_hash
ON ai_cache(model_name, prompt_hash, input_hash);

CREATE INDEX idx_ai_cache_last_used
ON ai_cache(last_used_at);
```

Use cases:

```txt
CV analysis
Job summary
Match explanation
Form answer generation
Cover letter generation
```

---

## 30. Retention Policies

```sql
CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  days INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
```

Default rows:

```sql
INSERT INTO retention_policies (id, key, days, enabled, updated_at)
VALUES
  ('rp_audit_logs', 'audit_logs', 30, 1, datetime('now')),
  ('rp_automation_evidence', 'automation_evidence', 1, 1, datetime('now')),
  ('rp_ai_cache', 'ai_cache', NULL, 0, datetime('now')),
  ('rp_application_artifacts', 'application_artifacts', NULL, 0, datetime('now'));
```

---

## 31. Cleanup Runs

```sql
CREATE TABLE cleanup_runs (
  id TEXT PRIMARY KEY,
  cleanup_type TEXT NOT NULL,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);

CREATE INDEX idx_cleanup_runs_started ON cleanup_runs(started_at);
```

Cleanup commands:

```txt
clear_ai_cache
clear_old_audit_logs
clear_old_dom_snapshots
clear_old_screenshots
clear_unused_application_artifacts
clear_failed_task_history
factory_reset
delete_profile
```

---

## 32. Audit Logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_profile_created ON audit_logs(profile_id, created_at);
CREATE INDEX idx_audit_expires ON audit_logs(expires_at);
CREATE INDEX idx_audit_severity ON audit_logs(severity);
```

Default expiration:

```txt
30 days
```

Severity:

```txt
debug
info
warning
error
critical
```

---

## 33. App Settings

Use this for persistent app-level settings. Lightweight UI-only settings can also use Tauri Store, but SQLite keeps backup/export simpler.

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Required keys:

```txt
theme = dark | light | system
reduced_effects = true | false | auto
portable_mode = true | false
data_dir = path
active_profile_id = uuid
browser_engine = playwright_chromium
```

---

## 34. Data Export Records

```sql
CREATE TABLE export_runs (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
```

Supported exports:

```txt
profile_json
jobs_csv
applications_csv
audit_csv
```

---

## 35. Backup Records

Database-only backup.

```sql
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  backup_path TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
```

Backup excludes:

```txt
Copied CV files
Screenshots
DOM snapshots
Browser profile folders
Exports
```

---

## 36. Security Notes

Argon2id is for key derivation/password hashing. Use authenticated encryption for encrypted fields.

Recommended sensitive field flow:

```txt
User passphrase -> Argon2id -> key -> AES-256-GCM / ChaCha20-Poly1305 -> encrypted field
```

Sources:

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
