-- Employer Discovery 9.3 scheduler state, owned by the existing desktop lifecycle.

ALTER TABLE discovery_settings ADD COLUMN employer_discovery_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (employer_discovery_enabled IN (0, 1));
ALTER TABLE discovery_settings ADD COLUMN employer_discovery_last_evaluated_at TEXT;
