-- Employer Discovery 9.3 automation state.

ALTER TABLE career_sites ADD COLUMN source_id TEXT REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE career_sites ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'ready'
  CHECK (discovery_state IN (
    'ready', 'source-created', 'source-reused', 'completed', 'failed',
    'unsupported', 'backoff', 'retired'
  ));
ALTER TABLE career_sites ADD COLUMN discovery_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (discovery_attempt_count >= 0);
ALTER TABLE career_sites ADD COLUMN last_discovery_attempt_at TEXT;
ALTER TABLE career_sites ADD COLUMN last_discovery_result TEXT;
ALTER TABLE career_sites ADD COLUMN next_discovery_attempt_at TEXT;
ALTER TABLE career_sites ADD COLUMN discovery_provenance TEXT NOT NULL DEFAULT 'employer-registry';

CREATE INDEX career_sites_discovery_eligibility_idx
  ON career_sites(discovery_state, next_discovery_attempt_at);

CREATE TABLE career_site_discovery_attempts (
  id TEXT PRIMARY KEY,
  career_site_id TEXT NOT NULL REFERENCES career_sites(id) ON DELETE CASCADE,
  provenance TEXT NOT NULL,
  result TEXT NOT NULL CHECK (
    result IN ('success', 'source-created', 'source-reused', 'unsupported', 'failed', 'skipped')
  ),
  provider_id TEXT,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  detail TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  next_eligible_at TEXT
);

CREATE INDEX career_site_discovery_attempts_site_idx
  ON career_site_discovery_attempts(career_site_id, attempted_at DESC, id DESC);

CREATE TRIGGER career_site_discovery_attempts_no_update
BEFORE UPDATE ON career_site_discovery_attempts
BEGIN
  SELECT RAISE(ABORT, 'CareerSite discovery attempts are append-only');
END;

CREATE TRIGGER career_site_discovery_attempts_no_delete
BEFORE DELETE ON career_site_discovery_attempts
BEGIN
  SELECT RAISE(ABORT, 'CareerSite discovery attempts are append-only');
END;
