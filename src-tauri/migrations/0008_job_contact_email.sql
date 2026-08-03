-- Contact email captured from scrape (Google dork snippets, job descriptions).
-- Nullable text; populated at ingest time when an email is detected in the
-- snippet or description. No default — NULL means no email was found.

ALTER TABLE job_posts ADD COLUMN contact_email TEXT;
