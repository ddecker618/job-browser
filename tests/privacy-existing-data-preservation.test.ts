import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  listPendingMigrations,
  runMigrations,
} from '../src/db/migration-runner.js';
import { assertDatabaseOutsideInstallDirectory } from '../src/desktop/paths.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';
import { nowUtc } from '../src/utilities/timestamps.js';
import { insertTestSource } from './helpers/test-database.js';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'job-browser-preserve-'));
  roots.push(root);
  return root;
}

function copyMigrations(target: string, count: number): void {
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(DEFAULT_MIGRATIONS_DIRECTORY)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
    .slice(0, count)) {
    writeFileSync(
      join(target, file),
      readFileSync(join(DEFAULT_MIGRATIONS_DIRECTORY, file), 'utf8'),
    );
  }
}

function insertSentinelJob(database: JobDatabase, employer: string): string {
  const id = randomUUID();
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, location,
        remote_type, employment_type, seniority_level, source_name, source_type,
        first_seen_at, last_seen_at, active, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'full-time', 'unknown',
        'Existing User Source', 'existing-user', ?, ?, 1, 'new', ?, ?)`,
    )
    .run(
      id,
      'Existing User Job',
      'existing user job',
      employer,
      employer.toLocaleLowerCase('en-US'),
      'Nowhere',
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
  return id;
}

describe('existing-data preservation and safe migration', () => {
  it('reopens an existing database without deleting, replacing, or re-migrating it', () => {
    const root = makeRoot();
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const databasePath = join(dataDir, 'jobs.sqlite');

    const database = openDatabase(databasePath);
    runMigrations(database);
    const sourceId = insertTestSource(database, {
      employer: 'Sentinel Employer',
    });
    const jobId = insertSentinelJob(database, 'Sentinel Employer');
    const schemaCount = (
      database
        .prepare<
          [],
          { count: number }
        >('SELECT COUNT(*) AS count FROM schema_migrations')
        .get() as { count: number }
    ).count;
    expect(schemaCount).toBeGreaterThan(0);
    database.close();

    const reopened = openDatabase(databasePath);
    expect(listPendingMigrations(reopened)).toEqual([]);
    expect(
      (
        reopened
          .prepare<
            [string],
            { count: number }
          >('SELECT COUNT(*) AS count FROM sources WHERE id = ?')
          .get(sourceId) as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        reopened
          .prepare<
            [string],
            { count: number }
          >('SELECT COUNT(*) AS count FROM jobs WHERE id = ?')
          .get(jobId) as { count: number }
      ).count,
    ).toBe(1);
    reopened.close();
  });

  it('applies forward migrations to an older database while preserving user records', () => {
    const root = makeRoot();
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const databasePath = join(dataDir, 'jobs.sqlite');
    const oldMigrations = join(root, 'old-migrations');
    copyMigrations(oldMigrations, 8);

    let database = openDatabase(databasePath);
    runMigrations(database, oldMigrations);
    expect(
      (
        database
          .prepare<
            [],
            { count: number }
          >('SELECT COUNT(*) AS count FROM schema_migrations')
          .get() as { count: number }
      ).count,
    ).toBe(8);
    const sentinelSourceId = insertTestSource(database, {
      employer: 'Upgrading Employer',
    });
    const sentinelJobId = insertSentinelJob(database, 'Upgrading Employer');
    database.close();

    database = openDatabase(databasePath);
    const result = runMigrations(database);
    expect(result.applied.length).toBeGreaterThanOrEqual(22);
    expect(
      (
        database
          .prepare<
            [],
            { count: number }
          >('SELECT COUNT(*) AS count FROM schema_migrations')
          .get() as { count: number }
      ).count,
    ).toBe(32);

    expect(
      (
        database
          .prepare<
            [string],
            { count: number }
          >('SELECT COUNT(*) AS count FROM sources WHERE id = ?')
          .get(sentinelSourceId) as { count: number }
      ).count,
    ).toBe(1);
    const preservedJob = database
      .prepare<
        [string],
        { company: string }
      >('SELECT company FROM jobs WHERE id = ?')
      .get(sentinelJobId);
    expect(preservedJob?.company).toBe('Upgrading Employer');

    const columns = database.prepare("PRAGMA table_info('jobs')").all() as {
      name: string;
    }[];
    expect(columns.some((column) => column.name === 'role_details_json')).toBe(
      true,
    );
    database.close();
  });

  it('backs up before migrating and preserves database plus user files on upgrade boot', async () => {
    const root = makeRoot();
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    const resumesDir = join(root, 'resumes');
    const snapshotsDir = join(root, 'snapshots');
    const settingsDir = join(root, 'settings');
    for (const directory of [
      dataDir,
      backupsDir,
      resumesDir,
      snapshotsDir,
      settingsDir,
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    const databasePath = join(dataDir, 'jobs.sqlite');
    const oldMigrations = join(root, 'old-migrations');
    copyMigrations(oldMigrations, 26);

    const database = openDatabase(databasePath);
    runMigrations(database, oldMigrations);
    const sentinelSourceId = insertTestSource(database, {
      employer: 'Existing Boot Employer',
    });
    const sentinelJobId = insertSentinelJob(database, 'Existing Boot Employer');
    database.close();

    const candidateProfilePath = join(settingsDir, 'candidate-profile.json');
    const scoringConfigPath = join(settingsDir, 'scoring-config.json');
    const candidateBefore = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'config', 'candidate-profile.json'),
        'utf8',
      ),
    ) as { name: string };
    candidateBefore.name = 'Existing User Persona';
    writeFileSync(
      candidateProfilePath,
      JSON.stringify(candidateBefore, null, 2),
    );
    writeFileSync(
      scoringConfigPath,
      readFileSync(
        resolve(process.cwd(), 'config', 'scoring-config.json'),
        'utf8',
      ),
    );

    const resumePath = join(resumesDir, 'existing-user-resume.txt');
    writeFileSync(resumePath, 'Existing user resume content');

    let handle: BackendHandle | null = null;
    try {
      handle = await startBackend({
        databasePath,
        migrationsDirectory: DEFAULT_MIGRATIONS_DIRECTORY,
        backupDirectory: backupsDir,
        resumeDirectory: resumesDir,
        snapshotDirectory: snapshotsDir,
        candidateProfilePath,
        scoringConfigPath,
        backupBeforeMigrations: true,
        seedDefaultSources: true,
        development: false,
      });
      expect(handle.pendingMigrations.length).toBeGreaterThan(0);
      expect(
        (
          handle.database
            .prepare<
              [string],
              { count: number }
            >('SELECT COUNT(*) AS count FROM sources WHERE id = ?')
            .get(sentinelSourceId) as { count: number }
        ).count,
      ).toBe(1);
      expect(
        (
          handle.database
            .prepare<
              [string],
              { count: number }
            >('SELECT COUNT(*) AS count FROM jobs WHERE id = ?')
            .get(sentinelJobId) as { count: number }
        ).count,
      ).toBe(1);

      expect(
        readdirSync(backupsDir).filter((name) => name.endsWith('.sqlite'))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(readFileSync(resumePath, 'utf8')).toBe(
        'Existing user resume content',
      );
      expect(
        (
          JSON.parse(readFileSync(candidateProfilePath, 'utf8')) as {
            name: string;
          }
        ).name,
      ).toBe('Existing User Persona');
    } finally {
      await handle?.stop();
    }
  });

  it('rejects a database location inside the installation directory', () => {
    const installDir = makeRoot();
    const resourcesPath = join(installDir, 'resources');
    expect(() =>
      assertDatabaseOutsideInstallDirectory(
        join(resourcesPath, 'data', 'jobs.sqlite'),
        resourcesPath,
      ),
    ).toThrow(/outside/);

    expect(() =>
      assertDatabaseOutsideInstallDirectory(
        join(makeRoot(), 'data', 'jobs.sqlite'),
        resourcesPath,
      ),
    ).not.toThrow();
  });
});
