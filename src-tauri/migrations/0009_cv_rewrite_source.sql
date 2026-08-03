-- Store the original extracted CV text alongside each rewrite so the CV Library
-- can show a before/after comparison (original text vs the AI-rewritten content)
-- without re-reading and re-parsing the source file. Nullable: pre-existing
-- rewrite rows simply have no "before" text to show.
ALTER TABLE cv_rewrites ADD COLUMN source_text TEXT;
