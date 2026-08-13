import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OutcomeAnalyticsRepository } from '../src/analytics/outcomeAnalyticsRepository.js';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import {
  createPersistenceSetBackup,
  restorePersistenceSet,
  type PersistenceSetPaths,
} from '../src/db/persistenceSetBackup.js';

const databases: JobDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Phase 8 integrated release', () => {
  it('restores a populated changed-root set with Company identity and outcomes intact offline', async () => {
    const sourcePaths = paths(root());
    mkdirSync(dirname(sourcePaths.candidateProfilePath), { recursive: true });
    writeFileSync(sourcePaths.candidateProfilePath, '{}');
    writeFileSync(sourcePaths.scoringConfigPath, '{}');
    writeFileSync(sourcePaths.profilePreferencesPath!, '{}');
    const database = tracked(sourcePaths.databasePath);
    runMigrations(database);
    populateCanonicalFacts(database);

    const before = new OutcomeAnalyticsRepository(database).calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    const backup = await createPersistenceSetBackup(database, sourcePaths);
    const targetPaths = paths(root());
    const restored = restorePersistenceSet(
      dirname(backup.manifestPath),
      targetPaths,
    );
    expect(restored).toMatchObject({
      databaseRestored: true,
      manifestVerified: true,
    });

    const restoredDatabase = tracked(targetPaths.databasePath);
    const after = new OutcomeAnalyticsRepository(restoredDatabase).calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(after.applications).toEqual(before.applications);
    expect(after.companies).toEqual(before.companies);
    expect(
      restoredDatabase
        .prepare<[], { company_id: string; canonical_name: string }>(
          `SELECT applications.company_id, companies.canonical_name
             FROM applications JOIN companies ON companies.id = applications.company_id`,
        )
        .get(),
    ).toEqual({ company_id: 'company-1', canonical_name: 'Acme, Inc.' });
    expect(
      restoredDatabase
        .prepare<[], { employer_count: number; company_count: number }>(
          `SELECT (SELECT COUNT(*) FROM employers) AS employer_count,
                  (SELECT COUNT(*) FROM companies) AS company_count`,
        )
        .get(),
    ).toEqual({ employer_count: 1, company_count: 1 });
  });
});

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-phase8-release-'));
  directories.push(directory);
  return directory;
}

function paths(directory: string): PersistenceSetPaths {
  return {
    databasePath: join(directory, 'data', 'jobs.sqlite'),
    resumeDirectory: join(directory, 'resumes'),
    snapshotDirectory: join(directory, 'snapshots'),
    candidateProfilePath: join(directory, 'settings', 'candidate-profile.json'),
    scoringConfigPath: join(directory, 'settings', 'scoring-config.json'),
    profilePreferencesPath: join(
      directory,
      'settings',
      'profile-preferences.json',
    ),
    backupDirectory: join(directory, 'backups'),
  };
}

function tracked(path: string): JobDatabase {
  const database = openDatabase(path);
  databases.push(database);
  return database;
}

function populateCanonicalFacts(database: JobDatabase): void {
  database.exec(`
    INSERT INTO companies (id, canonical_name, normalized_key, resolver_version, created_at, updated_at)
    VALUES ('company-1', 'Acme, Inc.', 'acme, inc.', 'company-exact-v1',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO employers (id, name, normalized_name, created_at, updated_at)
    VALUES ('employer-1', 'Acme Employer Registry', 'acme employer registry',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO jobs (id, fingerprint, title, normalized_title, company, normalized_company,
      company_id, remote_type, employment_type, source_name, source_type, first_seen_at,
      last_seen_at, active, seniority_level, status, created_at, updated_at)
    VALUES ('job-1', '${'a'.repeat(64)}', 'Engineer', 'engineer', 'Acme, Inc.',
      'acme, inc.', 'company-1', 'remote', 'full-time', 'offline-fixture', 'fixture',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1, 'mid',
      'interview', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO applications (id, job_id, company_id, status, company_at_application,
      created_at, updated_at)
    VALUES ('application-1', 'job-1', 'company-1', 'interview', 'Acme, Inc.',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO application_history (id, application_id, job_id, event_type, resulting_status,
      occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort, source,
      metadata_json, created_at)
    VALUES ('event-applied', 'application-1', 'job-1', 'applied', 'applied',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'exact',
      '2026-01-01T00:00:00.000Z', 'user', '{"definition":"application-event-v1"}',
      '2026-01-01T00:00:00.000Z');
    INSERT INTO application_history (id, application_id, job_id, event_type, resulting_status,
      occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort, source,
      metadata_json, created_at)
    VALUES ('event-interview', 'application-1', 'job-1', 'interview', 'interview',
      '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z', 'exact',
      '2026-01-05T00:00:00.000Z', 'user', '{"definition":"application-event-v1"}',
      '2026-01-05T00:00:00.000Z');
  `);
}
