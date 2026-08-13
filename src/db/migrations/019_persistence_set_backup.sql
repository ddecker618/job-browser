-- Persistence-Set Backup and Restore Manifest (Milestone 8.5)
--
-- Adds the backup manifest infrastructure required by DATABASE_V2.md sections
-- 2.5 and 5.8 to back up and restore the complete persistence set as one
-- verified unit. The previous SQLite-only backup is replaced by a manifest
-- that covers SQLite, current Resume files, ResumeSnapshot files, and
-- authoritative application-managed CandidateProfile/scoring preference files.
--
-- Design rules follow DATABASE_V2.md section 1.8 (migration philosophy) and
-- section 1.4 (backward compatibility):
--
-- * This migration is purely additive. It does not alter any existing table,
--   column, index, trigger, or data. Existing migrations remain immutable.
-- * `persistence_set_backups` records each backup run as a logical set with
--   a stable backup_id, a deterministic ISO-8601 UTC timestamp, and schema
--   version metadata for forward-compatible reconciliation.
-- * `persistence_set_files` records every external file covered by a backup
--   manifest: the database file (role 'database'), its WAL and SHM sidecars,
--   current Resume library files, ResumeSnapshot artifacts, and the
--   authoritative CandidateProfile and scoring preference JSON files.
-- * Each file row stores the persistence role, an owning identity (Resume ID,
--   Snapshot ID, or 'installation' for database/preference files), a portable
--   path relative to its managed root, the source path at backup time, and
--   cryptographic integrity metadata (SHA-256 content hash + size).
-- * Restore is performed by the application layer against these manifest rows
--   and the database backup artifact. No SQLite-level restore is implemented
--   here; restoration replaces SQLite through a verified offline copy and
--   places external files under the current managed roots before activation.
-- * The manifest does not cover credentials, logs, diagnostics, temporary files,
--   quarantined files, or previous backup sets, per FEATURE_SPEC_RESUMES.md
--   section "Storage, Backup, and Restore".

CREATE TABLE persistence_set_backups (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  database_path TEXT NOT NULL,
  database_backup_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('in_progress', 'complete', 'failed', 'interrupted')
  ),
  schema_version INTEGER NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX persistence_set_backups_started_at_idx
  ON persistence_set_backups(started_at DESC);

CREATE INDEX persistence_set_backups_status_idx
  ON persistence_set_backups(status);

CREATE TABLE persistence_set_files (
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL REFERENCES persistence_set_backups(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('database', 'database-wal', 'database-shm', 'resume', 'snapshot', 'candidate_profile', 'scoring_config', 'profile_preferences')
  ),
  owner_id TEXT,
  relative_key TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  restored INTEGER NOT NULL DEFAULT 0 CHECK (restored IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX persistence_set_files_backup_key_idx
  ON persistence_set_files(backup_id, role, relative_key);

CREATE INDEX persistence_set_files_owner_idx
  ON persistence_set_files(backup_id, owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX persistence_set_files_role_idx
  ON persistence_set_files(backup_id, role);
