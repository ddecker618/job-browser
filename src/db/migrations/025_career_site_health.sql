-- Employer Discovery 9.4: deterministic CareerSite health and retained verification history.

ALTER TABLE career_sites ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (health_status IN ('healthy', 'warning', 'broken', 'retired', 'unknown'));
ALTER TABLE career_sites ADD COLUMN health_checked_at TEXT;
ALTER TABLE career_sites ADD COLUMN health_message TEXT;
ALTER TABLE career_sites ADD COLUMN health_failure_count INTEGER NOT NULL DEFAULT 0
  CHECK (health_failure_count >= 0);
ALTER TABLE career_sites ADD COLUMN health_effective_url TEXT;
ALTER TABLE career_sites ADD COLUMN health_next_check_at TEXT;

CREATE INDEX career_sites_health_eligibility_idx
  ON career_sites(health_status, health_next_check_at);

CREATE TABLE career_site_verification_history (
  id TEXT PRIMARY KEY,
  career_site_id TEXT NOT NULL REFERENCES career_sites(id) ON DELETE CASCADE,
  requested_url TEXT NOT NULL,
  effective_url TEXT,
  http_status INTEGER,
  result_classification TEXT NOT NULL CHECK (
    result_classification IN (
      'healthy', 'redirected', 'transient-failure', 'broken', 'unsupported',
      'ats-changed', 'retired-skip'
    )
  ),
  previous_ats_provider TEXT,
  detected_ats_platform TEXT,
  detected_provider TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL,
  previous_health_status TEXT NOT NULL,
  resulting_health_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX career_site_verification_history_site_idx
  ON career_site_verification_history(career_site_id, observed_at DESC, id DESC);

CREATE TRIGGER career_site_verification_history_no_update
BEFORE UPDATE ON career_site_verification_history
BEGIN
  SELECT RAISE(ABORT, 'CareerSite verification history is append-only');
END;
