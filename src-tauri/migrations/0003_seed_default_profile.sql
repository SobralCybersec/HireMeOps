-- Seed a canonical default profile so that FK-constrained rows
-- (cv_documents, jobs, applications, ...) have a valid profile_id to
-- reference on a fresh install. Production never created a profile before
-- this migration, so the very first CV upload failed with:
--   error returned from database: (code: 787) FOREIGN KEY constraint failed
--
-- Idempotent: INSERT OR IGNORE keeps existing user rows untouched on upgrade.
INSERT OR IGNORE INTO profiles (
  id, display_name, created_at, updated_at, is_active
) VALUES (
  'default',
  'Default',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  1
);
