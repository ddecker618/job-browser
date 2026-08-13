-- ResumeSnapshots (Milestone 8.4)
--
-- Adds the immutable captured-career-document boundary required by
-- DATABASE_V2.md sections 2.5, 2.7, 5, and 10.2 and the first approved Phase 8
-- ResumeSnapshot behavior in FEATURE_SPEC_RESUMES.md.
--
-- Design rules:
--
-- * `resume_snapshots` is the immutable artifact record. The exact byte copy
--   lives outside SQLite under a managed snapshot root at a relative opaque
--   storage key; SQLite retains integrity metadata and a complete reuse
--   identity. A captured source file is never referenced through the mutable
--   Resume storage path.
-- * Copied source Resume identity (`source_resume_id`) and the optional live
--   relationship (`live_resume_id`) are distinct concepts. Deleting a library
--   Resume clears only the live relationship and never destroys provenance or
--   bytes.
-- * One capture-time interpretation is stored separately
--   (`resume_snapshot_interpretations`) with a versioned normalized payload so
--   post-capture reprocessing can later append rather than overwrite
--   (DATABASE_V2 5.7). A captured file that failed parsing retains a valid
--   failed interpretation with empty qualification relationships.
-- * Skill and Certification relationships are interpretation-scoped and never
--   reuse the Job junctions (DATABASE_V2 2.7, 5.5). Raw extracted labels and
--   provenance are preserved even when a canonical catalog entry is resolved.
-- * Applications and ApplicationEvents carry an optional
--   `submitted_resume_snapshot_id`. Only the resume-bearing Applied event may
--   carry it (DATABASE_V2 5.6). The Application column is a derived material
--   projection maintained by the canonical fold, never inferred.
-- * No historical backfill: existing Applications and events remain NULL.
--   Migration never infers the default, latest, or current Resume for a
--   historical Application.

CREATE TABLE resume_snapshots (
  id TEXT PRIMARY KEY,
  source_resume_id TEXT,
  live_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  parsing_status TEXT NOT NULL CHECK (parsing_status IN ('parsed', 'failed')),
  parsing_error TEXT,
  reuse_key TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX resume_snapshots_reuse_key_idx
  ON resume_snapshots(reuse_key)
  WHERE reuse_key IS NOT NULL;

CREATE TABLE resume_snapshot_interpretations (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES resume_snapshots(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  parsing_status TEXT NOT NULL CHECK (parsing_status IN ('parsed', 'failed')),
  parsing_error TEXT,
  normalized_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX resume_snapshot_interpretations_snapshot_idx
  ON resume_snapshot_interpretations(snapshot_id);

CREATE TABLE resume_snapshot_interpretation_skills (
  interpretation_id TEXT NOT NULL REFERENCES resume_snapshot_interpretations(id) ON DELETE CASCADE,
  skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
  raw_label TEXT NOT NULL,
  provenance TEXT NOT NULL,
  PRIMARY KEY (interpretation_id, raw_label)
);

CREATE TABLE resume_snapshot_interpretation_certifications (
  interpretation_id TEXT NOT NULL REFERENCES resume_snapshot_interpretations(id) ON DELETE CASCADE,
  certification_id TEXT REFERENCES certifications(id) ON DELETE SET NULL,
  raw_label TEXT NOT NULL,
  provenance TEXT NOT NULL,
  PRIMARY KEY (interpretation_id, raw_label)
);

ALTER TABLE applications
  ADD COLUMN submitted_resume_snapshot_id TEXT REFERENCES resume_snapshots(id) ON DELETE RESTRICT;

ALTER TABLE application_history
  ADD COLUMN submitted_resume_snapshot_id TEXT REFERENCES resume_snapshots(id) ON DELETE RESTRICT;

CREATE INDEX applications_submitted_snapshot_idx
  ON applications(submitted_resume_snapshot_id)
  WHERE submitted_resume_snapshot_id IS NOT NULL;

CREATE INDEX application_history_submitted_snapshot_idx
  ON application_history(submitted_resume_snapshot_id)
  WHERE submitted_resume_snapshot_id IS NOT NULL;

-- Only the resume-bearing Applied event may carry a Snapshot association. A
-- corrected or cleared association is a replacement Applied event, never a
-- separate event type or an edit to the original.
CREATE TRIGGER application_history_resume_association_definition
BEFORE INSERT ON application_history
WHEN NEW.submitted_resume_snapshot_id IS NOT NULL AND NEW.event_type <> 'applied'
BEGIN
  SELECT RAISE(ABORT, 'Resume snapshot association requires an Applied event');
END;

-- Snapshot artifact rows are immutable except for the optional live Resume
-- relationship, which the ON DELETE SET NULL foreign-key action clears when a
-- library Resume is deleted. SQLite foreign-key actions fire user triggers, so
-- only a live_resume_id transition is permitted and every other field is frozen.
CREATE TRIGGER resume_snapshots_no_update
BEFORE UPDATE ON resume_snapshots
BEGIN
  SELECT RAISE(ABORT, 'ResumeSnapshot rows are immutable')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.source_resume_id IS NOT OLD.source_resume_id
     OR NEW.content_hash IS NOT OLD.content_hash
     OR NEW.storage_key IS NOT OLD.storage_key
     OR NEW.original_filename IS NOT OLD.original_filename
     OR NEW.mime_type IS NOT OLD.mime_type
     OR NEW.extension IS NOT OLD.extension
     OR NEW.size_bytes IS NOT OLD.size_bytes
     OR NEW.parser_version IS NOT OLD.parser_version
     OR NEW.normalization_version IS NOT OLD.normalization_version
     OR NEW.parsing_status IS NOT OLD.parsing_status
     OR NEW.parsing_error IS NOT OLD.parsing_error
     OR NEW.reuse_key IS NOT OLD.reuse_key
     OR NEW.created_at IS NOT OLD.created_at;
END;

CREATE TRIGGER resume_snapshot_interpretations_no_update
BEFORE UPDATE ON resume_snapshot_interpretations
BEGIN
  SELECT RAISE(ABORT, 'ResumeSnapshot interpretations are immutable');
END;

CREATE TRIGGER resume_snapshot_interpretation_skills_no_update
BEFORE UPDATE ON resume_snapshot_interpretation_skills
BEGIN
  SELECT RAISE(ABORT, 'ResumeSnapshot Skill relationships are immutable');
END;

CREATE TRIGGER resume_snapshot_interpretation_certifications_no_update
BEFORE UPDATE ON resume_snapshot_interpretation_certifications
BEGIN
  SELECT RAISE(ABORT, 'ResumeSnapshot Certification relationships are immutable');
END;