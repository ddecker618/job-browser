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
      '010_merge_duplicate_provider_sources.sql',
      '011_add_matched_families.sql',
      '012_verification_columns.sql',
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
      '010_merge_duplicate_provider_sources.sql',
      '011_add_matched_families.sql',
      '012_verification_columns.sql',
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

  it('merges duplicate provider sources with colliding external_ids', () => {
    const directory = temporaryMigrationDirectory();
    for (const filename of [
      '001_initial_schema.sql',
      '002_discovery_engine.sql',
      '003_job_intelligence.sql',
      '004_dashboard.sql',
      '005_resume_parsing_error.sql',
      '006_multi_source_discovery.sql',
      '007_expanded_discovery.sql',
      '008_job_search_salary.sql',
      '009_clean_touchette_demo_source.sql',
    ]) {
      copyFileSync(
        join(DEFAULT_MIGRATIONS_DIRECTORY, filename),
        join(directory, filename),
      );
    }
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, directory);

    database.exec(`
      -- Three sources with the same provider_id:
      --   keeper    = 'provider:indeed' (the fixed-ID winner)
      --   dup1     = shares keeper's external_id 'ext-keeper' for a different job
      --   dup2     = shares dup1's external_id 'ext-dup-collide' but NOT the keeper's
      INSERT INTO sources (
        id, employer, source_type, enabled, connector, failure_count,
        created_at, updated_at, display_name, provider_id, configuration_json,
        search_criteria_json, configuration_status, health_status
      ) VALUES (
        'provider:indeed', 'Indeed', 'job-board', 1, 'indeed', 0,
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
        'Indeed (browser)', 'indeed', '{}', '{}', 'valid', 'never-run'
      );
      INSERT INTO sources (
        id, employer, source_type, enabled, connector, failure_count,
        created_at, updated_at, display_name, provider_id, configuration_json,
        search_criteria_json, configuration_status, health_status
      ) VALUES (
        'dup-1', 'Indeed', 'job-board', 1, 'indeed', 0,
        '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z',
        'Indeed (dup1)', 'indeed', '{}', '{}', 'valid', 'never-run'
      );
      INSERT INTO sources (
        id, employer, source_type, enabled, connector, failure_count,
        created_at, updated_at, display_name, provider_id, configuration_json,
        search_criteria_json, configuration_status, health_status
      ) VALUES (
        'dup-2', 'Indeed', 'job-board', 1, 'indeed', 0,
        '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z',
        'Indeed (dup2)', 'indeed', '{}', '{}', 'valid', 'never-run'
      );
      INSERT INTO source_schedules (id, source_id, enabled, cadence, created_at, updated_at)
      VALUES ('sched-1', 'provider:indeed', 0, 'manual', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
      INSERT INTO source_schedules (id, source_id, enabled, cadence, created_at, updated_at)
      VALUES ('sched-2', 'dup-1', 0, 'manual', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
      INSERT INTO source_schedules (id, source_id, enabled, cadence, created_at, updated_at)
      VALUES ('sched-3', 'dup-2', 0, 'manual', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z');

      INSERT INTO jobs (id, fingerprint, external_id, title, normalized_title, company,
        normalized_company, remote_type, employment_type, source_name,
        source_type, first_seen_at, last_seen_at, active, seniority_level,
        status, created_at, updated_at)
      VALUES ('job-keeper', '${'b'.repeat(64)}', 'ext-keeper', 'Keeper Job',
        'keeper job', 'Acme', 'acme', 'remote', 'full-time', 'Indeed',
        'job-board', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
        1, 'mid', 'new', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
      INSERT INTO jobs (id, fingerprint, external_id, title, normalized_title, company,
        normalized_company, remote_type, employment_type, source_name,
        source_type, first_seen_at, last_seen_at, active, seniority_level,
        status, created_at, updated_at)
      VALUES ('job-dup1', '${'c'.repeat(64)}', 'ext-dup1', 'Dup 1 Job',
        'dup1 job', 'Acme', 'acme', 'remote', 'full-time', 'Indeed',
        'job-board', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z',
        1, 'mid', 'new', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
      INSERT INTO jobs (id, fingerprint, external_id, title, normalized_title, company,
        normalized_company, remote_type, employment_type, source_name,
        source_type, first_seen_at, last_seen_at, active, seniority_level,
        status, created_at, updated_at)
      VALUES ('job-dup2', '${'d'.repeat(64)}', 'ext-dup2', 'Dup 2 Job',
        'dup2 job', 'Acme', 'acme', 'remote', 'full-time', 'Indeed',
        'job-board', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z',
        1, 'mid', 'new', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z');

      -- Keeper source has external_id='ext-keeper'
      INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
      VALUES ('js-keeper', 'job-keeper', 'provider:indeed', 'ext-keeper',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');

      -- dup1: same external_id 'ext-keeper' as keeper → collides with keeper
      INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
      VALUES ('js-dup1', 'job-dup1', 'dup-1', 'ext-keeper',
        '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');

      -- dup2: external_id='ext-dup-collide' which dup1 ALSO has → collides with dup1, not keeper
      INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
      VALUES ('js-dup2a', 'job-dup1', 'dup-1', 'ext-dup-collide',
        '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
      INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
      VALUES ('js-dup2b', 'job-dup2', 'dup-2', 'ext-dup-collide',
        '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z');
    `);

    expect(runMigrations(database).applied).toEqual([
      '010_merge_duplicate_provider_sources.sql',
      '011_add_matched_families.sql',
      '012_verification_columns.sql',
    ]);

    const remaining = database
      .prepare<
        [],
        { id: string }
      >("SELECT id FROM sources WHERE provider_id = 'indeed'")
      .all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('provider:indeed');

    const jobSources = database
      .prepare<
        [],
        { id: string; job_id: string; external_id: string }
      >("SELECT id, job_id, external_id FROM job_sources WHERE source_id = 'provider:indeed'")
      .all();
    // js-keeper (ext-keeper) kept, js-dup1 (ext-keeper) removed (collision with keeper)
    // js-dup2a (ext-dup-collide) kept (earliest id), js-dup2b (ext-dup-collide) removed (collision with dup1)
    expect(jobSources).toHaveLength(2);
    expect(jobSources.map((js) => js.external_id).sort()).toEqual([
      'ext-dup-collide',
      'ext-keeper',
    ]);

    const jobs = database
      .prepare<
        [],
        { id: string }
      >("SELECT id FROM jobs WHERE id IN ('job-keeper', 'job-dup1', 'job-dup2')")
      .all();
    expect(jobs).toHaveLength(3);
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
