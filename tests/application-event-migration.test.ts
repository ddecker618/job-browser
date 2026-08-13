import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  runMigrations,
} from '../src/db/migration-runner.js';

const PRE_016_MIGRATIONS = [
  '001_initial_schema.sql',
  '002_discovery_engine.sql',
  '003_job_intelligence.sql',
  '004_dashboard.sql',
  '005_resume_parsing_error.sql',
  '006_multi_source_discovery.sql',
  '007_expanded_discovery.sql',
  '008_job_search_salary.sql',
  '009_clean_touchette_demo_source.sql',
  '010_merge_duplicate_provider_sources.sql',
  '011_add_matched_families.sql',
  '012_verification_columns.sql',
  '013_scoring_version_and_backfill.sql',
  '014_legacy_remote_ok_sources.sql',
  '015_interrupted_run_status.sql',
] as const;

interface ProjectionRow {
  id: string;
  job_id: string;
  status: string;
  applied_at: string | null;
  applied_at_precision: string | null;
  last_event_at: string | null;
  last_recorded_at: string | null;
  notes: string | null;
  source_id: string | null;
}

describe('application event foundation migration', () => {
  const databases: JobDatabase[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reconciles every approved legacy class without losing IDs, rows, or Job workflow state', () => {
    const legacyDirectory = mkdtempSync(join(tmpdir(), 'job-browser-pre-016-'));
    temporaryDirectories.push(legacyDirectory);
    for (const filename of PRE_016_MIGRATIONS) {
      copyFileSync(
        join(DEFAULT_MIGRATIONS_DIRECTORY, filename),
        join(legacyDirectory, filename),
      );
    }

    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, legacyDirectory);

    insertLegacyJob(database, 'job-aggregate', 'new');
    insertLegacyJob(database, 'job-history', 'review');
    insertLegacyJob(database, 'job-note', 'new');
    insertLegacyJob(database, 'job-divergent', 'review');

    database.exec(`
      -- Aggregate-only, source-less Application with an imprecise applied date.
      INSERT INTO applications (
        id, job_id, status, applied_at, last_event_at, notes, created_at, updated_at
      ) VALUES (
        'application-aggregate', 'job-aggregate', 'offer', '2025-01-15',
        '2025-05-01T00:00:00.000Z', 'aggregate notes',
        '2025-01-01T00:00:00.000Z', '2025-05-02T00:00:00.000Z'
      );

      -- History-only Application. Generic Interview must remain generic.
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES (
        'history-applied', 'job-history', 'applied',
        '2025-02-01T00:00:00.000Z', NULL, 'legacy-test',
        '2025-02-01T01:00:00.000Z'
      );
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES (
        'history-interview', 'job-history', 'interview',
        '2025-02-10T00:00:00.000Z', 'generic remains generic', 'legacy-test',
        '2025-02-10T01:00:00.000Z'
      );

      -- Note-only history creates Unknown Legacy State without inferring Applied.
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES (
        'history-note', 'job-note', 'note',
        '2025-03-01T00:00:00.000Z', 'preserved note', 'legacy-test',
        '2025-03-01T01:00:00.000Z'
      );

      -- Aggregate/history divergence retains the aggregate compatibility state
      -- through a migration event while preserving both factual history rows.
      INSERT INTO applications (
        id, job_id, status, applied_at, last_event_at, notes, created_at, updated_at
      ) VALUES (
        'application-divergent', 'job-divergent', 'rejected',
        '2025-03-10T00:00:00.000Z', '2025-04-15T00:00:00.000Z',
        'divergent notes', '2025-03-10T00:00:00.000Z',
        '2025-04-15T00:00:00.000Z'
      );
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES (
        'divergent-applied', 'job-divergent', 'applied',
        '2025-03-10T00:00:00.000Z', NULL, 'legacy-test',
        '2025-03-10T01:00:00.000Z'
      );
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES (
        'divergent-interview', 'job-divergent', 'interview',
        '2025-04-01T00:00:00.000Z', NULL, 'legacy-test',
        '2025-04-01T01:00:00.000Z'
      );
    `);

    const originalApplicationIds = applicationIds(database);
    const originalHistoryIds = historyIds(database);
    expect(originalApplicationIds).toEqual([
      'application-aggregate',
      'application-divergent',
    ]);
    expect(originalHistoryIds).toEqual([
      'divergent-applied',
      'divergent-interview',
      'history-applied',
      'history-interview',
      'history-note',
    ]);

    expect(runMigrations(database).applied).toEqual([
      '016_application_event_foundation.sql',
      '017_application_management_indexes.sql',
      '018_resume_snapshots.sql',
      '019_persistence_set_backup.sql',
      '020_employer_discovery.sql',
      '021_company_identity.sql',
      '022_employer_discovery_engine.sql',
      '023_outcome_analytics_indexes.sql',
      '024_employer_discovery_scheduling.sql',
      '025_career_site_health.sql',
      '026_explicit_job_lifecycle.sql',
    ]);

    expect(applicationIds(database)).toEqual([
      'application-aggregate',
      'application-divergent',
      'job-history',
      'job-note',
    ]);
    expect(historyIds(database)).toEqual(
      expect.arrayContaining(originalHistoryIds),
    );
    expect(historyIds(database)).toHaveLength(9);

    expect(projection(database, 'job-aggregate')).toMatchObject({
      id: 'application-aggregate',
      status: 'offer',
      applied_at: '2025-01-15',
      applied_at_precision: 'approximate',
      last_event_at: '2025-01-15T00:00:00.000Z',
      notes: 'aggregate notes',
      source_id: null,
    });
    expect(
      projection(database, 'job-aggregate').last_recorded_at,
    ).not.toBeNull();

    expect(projection(database, 'job-history')).toMatchObject({
      id: 'job-history',
      status: 'interview',
      applied_at: '2025-02-01T00:00:00.000Z',
      applied_at_precision: 'exact',
      last_event_at: '2025-02-10T00:00:00.000Z',
    });
    expect(
      database
        .prepare<
          [string],
          { event_type: string }
        >('SELECT event_type FROM application_history WHERE id = ?')
        .get('history-interview')?.event_type,
    ).toBe('interview');

    expect(projection(database, 'job-note')).toMatchObject({
      id: 'job-note',
      status: 'unknown_legacy_state',
      applied_at: null,
      applied_at_precision: null,
      last_event_at: '2025-03-01T00:00:00.000Z',
    });
    expect(
      database
        .prepare<
          [string],
          { notes: string | null }
        >('SELECT notes FROM application_history WHERE id = ?')
        .get('history-note')?.notes,
    ).toBe('preserved note');

    expect(projection(database, 'job-divergent')).toMatchObject({
      id: 'application-divergent',
      status: 'rejected',
      applied_at: '2025-03-10T00:00:00.000Z',
      applied_at_precision: 'exact',
      last_event_at: '2025-04-01T00:00:00.000Z',
      notes: 'divergent notes',
    });
    const divergentImport = database
      .prepare<
        [],
        { event_type: string; resulting_status: string; metadata_json: string }
      >(
        `SELECT event_type, resulting_status, metadata_json
           FROM application_history
          WHERE id = 'legacy-state:application-divergent'`,
      )
      .get();
    expect(divergentImport).toMatchObject({
      event_type: 'legacy_state_imported',
      resulting_status: 'rejected',
    });
    expect(JSON.parse(divergentImport!.metadata_json)).toMatchObject({
      classification: 'legacy:pre-v2-aggregate',
      legacy_application_id: 'application-divergent',
      legacy_last_event_at: '2025-04-15T00:00:00.000Z',
    });

    expect(
      database
        .prepare<
          [],
          {
            occurred_at: string;
            occurred_at_sort: string;
            occurrence_precision: string;
          }
        >(
          `SELECT occurred_at, occurred_at_sort, occurrence_precision
             FROM application_history
            WHERE id = 'legacy-lad:application-aggregate'`,
        )
        .get(),
    ).toEqual({
      occurred_at: '2025-01-15',
      occurred_at_sort: '2025-01-15T00:00:00.000Z',
      occurrence_precision: 'approximate',
    });

    expect(
      database
        .prepare<[], { id: string; status: string }>(
          `SELECT id, status FROM jobs
            WHERE id IN ('job-aggregate', 'job-history', 'job-note', 'job-divergent')
            ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: 'job-aggregate', status: 'new' },
      { id: 'job-divergent', status: 'review' },
      { id: 'job-history', status: 'review' },
      { id: 'job-note', status: 'new' },
    ]);

    expect(() =>
      database
        .prepare(
          "UPDATE application_history SET notes = 'changed' WHERE id = ?",
        )
        .run('history-note'),
    ).toThrow('updates are not allowed');
    expect(() =>
      database
        .prepare('DELETE FROM application_history WHERE id = ?')
        .run('history-note'),
    ).toThrow('deletes are not allowed');
    expect(() =>
      database.prepare('DELETE FROM jobs WHERE id = ?').run('job-history'),
    ).toThrow();
  });
});

function insertLegacyJob(
  database: JobDatabase,
  id: string,
  status: 'new' | 'review',
): void {
  database
    .prepare(
      `INSERT INTO jobs (
        id, fingerprint, title, normalized_title, company, normalized_company,
        remote_type, employment_type, source_name, source_type, first_seen_at,
        last_seen_at, active, seniority_level, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Example Company', 'example company', 'remote',
        'full-time', 'Legacy Test', 'fixture', '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z', 1, 'mid', ?,
        '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
    )
    .run(id, `fingerprint:${id}`, `Job ${id}`, `job ${id}`, status);
}

function applicationIds(database: JobDatabase): string[] {
  return database
    .prepare<[], { id: string }>('SELECT id FROM applications ORDER BY id')
    .all()
    .map((row) => row.id);
}

function historyIds(database: JobDatabase): string[] {
  return database
    .prepare<[], { id: string }>(
      'SELECT id FROM application_history ORDER BY id',
    )
    .all()
    .map((row) => row.id);
}

function projection(database: JobDatabase, jobId: string): ProjectionRow {
  const row = database
    .prepare<[string], ProjectionRow>(
      `SELECT id, job_id, status, applied_at, applied_at_precision,
              last_event_at, last_recorded_at, notes, source_id
         FROM applications
        WHERE job_id = ?`,
    )
    .get(jobId);
  if (row === undefined) throw new Error(`Missing Application for ${jobId}`);
  return row;
}
