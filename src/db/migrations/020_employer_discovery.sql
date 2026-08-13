-- Employer Discovery persistence (vertical slice)
--
-- Adds Employer and CareerSite tables for the Employer Discovery UI.
-- This migration is purely additive: it does not alter existing tables.

CREATE TABLE employers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  website_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX employers_normalized_name_idx
  ON employers(normalized_name);

CREATE TABLE career_sites (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  ats_platform TEXT,
  ats_detected_provider TEXT,
  ats_confidence REAL CHECK (ats_confidence IS NULL OR (ats_confidence >= 0 AND ats_confidence <= 1)),
  ats_support_state TEXT CHECK (
    ats_support_state IN ('supported', 'supported-with-configuration', 'detected-but-unsupported', 'structured-data-fallback-available', 'unsupported')
  ),
  fingerprint_evidence_json TEXT,
  fingerprint_confidence_label TEXT CHECK (
    fingerprint_confidence_label IN ('high', 'medium', 'low')
  ),
  fingerprint_version TEXT,
  fingerprint_observed_at TEXT,
  verification_state TEXT NOT NULL CHECK (
    verification_state IN ('verified', 'unverified', 'unknown')
  ),
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX career_sites_employer_url_idx
  ON career_sites(employer_id, normalized_url);

CREATE INDEX career_sites_ats_provider_idx
  ON career_sites(ats_detected_provider)
  WHERE ats_detected_provider IS NOT NULL;

CREATE TABLE career_site_evidence (
  id TEXT PRIMARY KEY,
  career_site_id TEXT NOT NULL REFERENCES career_sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX career_site_evidence_site_idx
  ON career_site_evidence(career_site_id, observed_at DESC);
