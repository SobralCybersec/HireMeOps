-- Profile variants sourced from an extracted/rewritten CV.
--
-- Additive: `profile_variants` already existed (0001) but carried only
-- name/target_title/summary/headline/keywords_json and was never populated by
-- real backend code. This migration lets a variant hold the *structured*,
-- review-ready content derived from a CV so the UI can render per-section
-- payloads (About, Experience, Skills, Contact) and a draft-and-review
-- LinkedIn sync assistant can present them for one-click copy.
--
-- All new columns are nullable JSON/text blobs (serialized `ai::prompt::*`
-- shapes) so existing rows and older code paths keep working. NO automated
-- authenticated writes are implied by this schema — it only persists content.

ALTER TABLE profile_variants ADD COLUMN positions_json TEXT;   -- Vec<String>  (target titles)
ALTER TABLE profile_variants ADD COLUMN skills_json TEXT;      -- Vec<CvSkillGroup>
ALTER TABLE profile_variants ADD COLUMN experience_json TEXT;  -- Vec<CvExperienceEntry>
ALTER TABLE profile_variants ADD COLUMN education_json TEXT;   -- Vec<CvEducationEntry>
ALTER TABLE profile_variants ADD COLUMN contact_json TEXT;     -- ContactInfo (name/email/phone/website/location)
ALTER TABLE profile_variants ADD COLUMN about_text TEXT;       -- generated LinkedIn "About" draft

-- Provenance: which document / rewrite this variant was built from.
ALTER TABLE profile_variants ADD COLUMN source_cv_document_id TEXT
  REFERENCES cv_documents(id) ON DELETE SET NULL;
ALTER TABLE profile_variants ADD COLUMN source_rewrite_id TEXT
  REFERENCES cv_rewrites(id) ON DELETE SET NULL;

CREATE INDEX idx_profile_variants_source_doc
  ON profile_variants(source_cv_document_id);
