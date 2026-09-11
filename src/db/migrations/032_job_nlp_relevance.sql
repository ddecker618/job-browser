-- Additive NLP search relevance index storage.
--
-- This table is a fork of job_nlp_enrichments: it stores only the compact,
-- deterministic relevance document derived from the enrichment envelope and a
-- bounded 0..1 ranking score used strictly as a search tie-break behind an
-- off-by-default flag. It never adds NLP columns to jobs and never feeds
-- score, eligibility, ranking baselines, filtering, or lifecycle.

CREATE TABLE job_nlp_relevance (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  relevance_index_version TEXT NOT NULL,
  relevance_score REAL NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 1),
  relevance_json TEXT NOT NULL CHECK (json_valid(relevance_json)),
  updated_at TEXT NOT NULL
);