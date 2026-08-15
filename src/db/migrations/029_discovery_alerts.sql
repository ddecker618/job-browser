-- Migration 029: discovery alerts table and indexes
CREATE TABLE discovery_alerts (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('source', 'career_site', 'provider')),
  entity_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  state TEXT NOT NULL CHECK (state IN ('active', 'acknowledged', 'resolved')),
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  resolved_at TEXT,
  acknowledged_at TEXT,
  message TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  rule_version TEXT NOT NULL
);

-- Ensure stable active alert identity: only one active/acknowledged alert per rule + entity
CREATE UNIQUE INDEX discovery_alerts_active_unique_idx
  ON discovery_alerts(rule_id, entity_type, entity_id)
  WHERE state IN ('active', 'acknowledged');

CREATE INDEX discovery_alerts_state_idx ON discovery_alerts(state);
