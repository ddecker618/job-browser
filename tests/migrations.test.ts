import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  runMigrations,
} from '../src/db/migration-runner.js';

interface NameRow {
  name: string;
}

const temporaryDirectories: string[] = [];
const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryMigrationDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-migrations-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('migration runner', () => {
  it('applies the schema and is idempotent', () => {
    const database = openDatabase(':memory:');
    databases.push(database);

    expect(runMigrations(database).applied).toEqual([
      '001_initial_schema.sql',
      '002_discovery_engine.sql',
      '003_job_intelligence.sql',
      '004_dashboard.sql',
      '005_resume_parsing_error.sql',
      '006_multi_source_discovery.sql',
      '007_expanded_discovery.sql',
      '008_job_search_salary.sql',
      '009_clean_touchette_demo_source.sql',
    ]);
    expect(runMigrations(database).applied).toEqual([]);

    const tables = database
      .prepare<[], NameRow>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'application_history',
        'applications',
        'analysis_runs',
        'analytics',
        'app_settings',
        'candidate_profiles',
        'certifications',
        'job_sources',
        'identity_conflict_diagnostics',
        'job_observations',
        'job_status_history',
        'job_certifications',
        'job_skills',
        'jobs',
        'provider_metadata',
        'recommendations',
        'resume_profile_proposals',
        'resumes',
        'runs',
        'schema_migrations',
        'score_history',
        'saved_filters',
        'skills',
        'sources',
        'source_schedules',
        'discovery_settings',
      ]),
    );
  });

  it('rejects an applied migration whose contents changed', () => {
    const directory = temporaryMigrationDirectory();
    const migrationPath = join(directory, '001_initial_schema.sql');
    writeFileSync(
      migrationPath,
      readFileSync(
        join(DEFAULT_MIGRATIONS_DIRECTORY, '001_initial_schema.sql'),
        'utf8',
      ),
    );
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, directory);
    writeFileSync(
      migrationPath,
      `${readFileSync(migrationPath, 'utf8')}\n-- changed\n`,
    );

    expect(() => runMigrations(database, directory)).toThrow(
      'Applied migration has changed',
    );
  });

  it('upgrades a populated Phase 6 database without losing data or history', () => {
    const phase6Directory = temporaryMigrationDirectory();
    for (const filename of [
      '001_initial_schema.sql',
      '002_discovery_engine.sql',
      '003_job_intelligence.sql',
      '004_dashboard.sql',
      '005_resume_parsing_error.sql',
      '006_multi_source_discovery.sql',
    ]) {
      copyFileSync(
        join(DEFAULT_MIGRATIONS_DIRECTORY, filename),
        join(phase6Directory, filename),
      );
    }
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, phase6Directory);
    database.exec(`
      INSERT INTO sources (
        id, employer, source_type, enabled, failure_count, created_at, updated_at
      ) VALUES ('source-1', 'Preserved Employer', 'fixture', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO runs (
        id, source_id, status, started_at, completed_at, jobs_discovered,
        jobs_inserted, jobs_updated, duplicates_found, created_at
      ) VALUES ('run-1', 'source-1', 'succeeded', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:01:00.000Z', 1, 1, 0, 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO jobs (
        id, fingerprint, external_id, title, normalized_title, company,
        normalized_company, remote_type, employment_type, source_name,
        source_type, first_seen_at, last_seen_at, active, seniority_level,
        status, created_at, updated_at
      ) VALUES ('job-1', '${'a'.repeat(64)}', 'external-1', 'Preserved Job',
        'preserved job', 'Preserved Employer', 'preserved employer', 'remote',
        'full-time', 'Fixture', 'fixture', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', 1, 'mid', 'applied',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO job_sources (
        id, job_id, source_id, external_id, first_seen_at, last_seen_at
      ) VALUES ('job-source-1', 'job-1', 'source-1', 'external-1',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO job_status_history (
        id, job_id, previous_status, new_status, changed_at, changed_by, reason
      ) VALUES ('status-1', 'job-1', NULL, 'applied',
        '2026-01-01T00:00:00.000Z', 'test', 'preserve me');
      INSERT INTO application_history (
        id, job_id, event_type, occurred_at, notes, source, created_at
      ) VALUES ('event-1', 'job-1', 'applied', '2026-01-01T00:00:00.000Z',
        'preserve me', 'test', '2026-01-01T00:00:00.000Z');
      INSERT INTO applications (
        id, job_id, status, applied_at, last_event_at, created_at, updated_at
      ) VALUES ('application-1', 'job-1', 'applied', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z');
    `);

    expect(runMigrations(database).applied).toEqual([
      '007_expanded_discovery.sql',
      '008_job_search_salary.sql',
      '009_clean_touchette_demo_source.sql',
    ]);
    expect(
      database
        .prepare<[], Record<string, unknown>>(
          `SELECT jobs.title, jobs.status, jobs.discovery_count,
             job_sources.external_id, job_sources.active,
             job_status_history.reason, application_history.notes,
             applications.status AS application_status
           FROM jobs
           JOIN job_sources ON job_sources.job_id = jobs.id
           JOIN job_status_history ON job_status_history.job_id = jobs.id
           JOIN application_history ON application_history.job_id = jobs.id
           JOIN applications ON applications.job_id = jobs.id`,
        )
        .get(),
    ).toMatchObject({
      title: 'Preserved Job',
      status: 'applied',
      discovery_count: 1,
      external_id: 'external-1',
      active: 1,
      reason: 'preserve me',
      notes: 'preserve me',
      application_status: 'applied',
    });
  });

  it('uses the lifecycle index for active verification queries', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const plan = database
      .prepare<[], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM jobs
          WHERE active = 1 ORDER BY last_verified_at LIMIT 20`,
      )
      .all()
      .map((row) => row.detail)
      .join(' ');
    expect(plan).toContain('jobs_lifecycle_idx');
  });

  it('rolls back a failing migration', () => {
    const directory = temporaryMigrationDirectory();
    writeFileSync(
      join(directory, '001_create_example.sql'),
      'CREATE TABLE example (id TEXT PRIMARY KEY);',
    );
    writeFileSync(
      join(directory, '002_failing.sql'),
      'CREATE TABLE should_roll_back (id TEXT); INVALID SQL;',
    );
    const database = openDatabase(':memory:');
    databases.push(database);

    expect(() => runMigrations(database, directory)).toThrow('002_failing.sql');
    expect(
      database
        .prepare<
          [],
          NameRow
        >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_roll_back'")
        .get(),
    ).toBeUndefined();
  });
});
