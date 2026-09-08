import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_MIGRATIONS_DIRECTORY } from '../src/db/migration-runner.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';
import { scanDirectory } from './helpers/privacy-markers.js';

const BROWSER_PROFILE_DIRS = [
  'linkedin-profile',
  'dice-profile',
  'handshake-profile',
  'indeed-profile',
  'wellfound-profile',
  'ziprecruiter-profile',
  'usajobs-profile',
] as const;

const DEMO_SOURCE_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_JOB_ID = '00000000-0000-4000-8000-000000000002';

const root = mkdtempSync(join(tmpdir(), 'job-browser-fresh-install-'));
const userRoot = join(root, 'userData');
const dataDir = join(userRoot, 'data');
const settingsDir = join(userRoot, 'settings');
const resumesDir = join(userRoot, 'resumes');
const snapshotsDir = join(userRoot, 'snapshots');
const backupsDir = join(userRoot, 'backups');
const databasePath = join(dataDir, 'jobs.sqlite');
const candidateProfilePath = join(settingsDir, 'candidate-profile.json');
const scoringConfigPath = join(settingsDir, 'scoring-config.json');

let handle: BackendHandle | null = null;

beforeAll(async () => {
  for (const directory of [
    dataDir,
    settingsDir,
    resumesDir,
    snapshotsDir,
    backupsDir,
    ...BROWSER_PROFILE_DIRS.map((name) => join(userRoot, name)),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(
    resolve(process.cwd(), 'config', 'candidate-profile.json'),
    candidateProfilePath,
  );
  copyFileSync(
    resolve(process.cwd(), 'config', 'scoring-config.json'),
    scoringConfigPath,
  );
  handle = await startBackend({
    databasePath,
    migrationsDirectory: DEFAULT_MIGRATIONS_DIRECTORY,
    backupDirectory: backupsDir,
    resumeDirectory: resumesDir,
    snapshotDirectory: snapshotsDir,
    candidateProfilePath,
    scoringConfigPath,
    profilePreferencesPath: join(settingsDir, 'profile-preferences.json'),
    seedDefaultSources: true,
    development: false,
  });
}, 60_000);

afterAll(async () => {
  await handle?.stop();
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
});

describe('fresh-install isolation', () => {
  it('bootstraps a database with no user records or demo records', () => {
    const database = handle?.database;
    expect(database).toBeDefined();
    if (database === undefined) return;

    const counts = [
      'jobs',
      'applications',
      'application_history',
      'resumes',
      'job_observations',
      'career_site_discovery_attempts',
    ] as const;
    for (const table of counts) {
      const row = database
        .prepare<
          [],
          { count: number }
        >(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      expect(row.count, `${table} should be empty on a fresh install`).toBe(0);
    }

    const sources = database
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sources')
      .get() as { count: number };
    expect(sources.count).toBeGreaterThan(0);

    const demoSources = database
      .prepare<
        [string],
        { count: number }
      >('SELECT COUNT(*) AS count FROM sources WHERE id = ?')
      .get(DEMO_SOURCE_ID);
    expect(demoSources?.count ?? 0).toBe(0);
    const demoJobs = database
      .prepare<
        [string],
        { count: number }
      >('SELECT COUNT(*) AS count FROM jobs WHERE id = ?')
      .get(DEMO_JOB_ID);
    expect(demoJobs?.count ?? 0).toBe(0);
  });

  it('seeds only product data (curated employers and default sources)', () => {
    const database = handle?.database;
    expect(database).toBeDefined();
    if (database === undefined) return;

    const employers = database
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM employers')
      .get() as { count: number };
    expect(employers.count).toBeGreaterThan(0);

    const discoverySetting = database
      .prepare<
        [],
        { enabled: number }
      >('SELECT employer_discovery_enabled AS enabled FROM discovery_settings LIMIT 1')
      .get() as { enabled: number };
    expect(discoverySetting.enabled).toBe(0);
  });

  it('writes generic default settings rather than a personal profile', () => {
    const profile = JSON.parse(readFileSync(candidateProfilePath, 'utf8')) as {
      name?: unknown;
      skills?: unknown;
    };
    expect(profile.name).toBe('New Candidate');

    expect(readdirSync(resumesDir), `${resumesDir} should be empty`).toEqual(
      [],
    );
    expect(readdirSync(backupsDir), `${backupsDir} should be empty`).toEqual(
      [],
    );
    for (const entry of readdirSync(snapshotsDir)) {
      expect(['quarantine', 'tmp'], `${snapshotsDir} work directory`).toContain(
        entry,
      );
    }

    for (const name of BROWSER_PROFILE_DIRS) {
      const browserEntries = readdirSync(join(userRoot, name));
      expect(
        browserEntries.some((entry) =>
          /Login Data|Cookies|History/i.test(entry),
        ),
        `${name} should not contain browser session files on a fresh install`,
      ).toBe(false);
    }
  });

  it('contains no personal-data markers anywhere in the fresh install tree', () => {
    const hits = scanDirectory(userRoot);
    expect(hits).toEqual([]);
  });
});
