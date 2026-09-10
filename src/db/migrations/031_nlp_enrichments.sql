-- Additive shadow-mode NLP enrichment storage.
--
-- This table deliberately does not add NLP columns to jobs. The production job
-- record, score, eligibility, lifecycle, and retained descriptions remain
-- independent and authoritative.

CREATE TABLE job_nlp_enrichments (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  extraction_version TEXT NOT NULL,
  source_text_hash TEXT NOT NULL,
  enrichment_json TEXT NOT NULL CHECK (json_valid(enrichment_json)),
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX job_nlp_enrichments_stale_idx
  ON job_nlp_enrichments(extraction_version, source_text_hash, job_id);
