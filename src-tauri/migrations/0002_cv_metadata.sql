-- CV parse metadata (Increment 1 — CvService::import_document).
-- Additive columns; existing 0001 rows get NULL and are handled by DTO defaults.
ALTER TABLE cv_documents ADD COLUMN size_bytes INTEGER;
ALTER TABLE cv_documents ADD COLUMN page_count INTEGER;
ALTER TABLE cv_documents ADD COLUMN sections_json TEXT;
