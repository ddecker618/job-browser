import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  markFirstSourceAt,
  readAdoptionMarkers,
  ensureInstalledAt,
} from '../src/database/adoptionMarkers.js';
import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';
import {
  startBackend,
  type BackendHandle,
  type BackendOptions,
} from '../src/server/backend.js';

const directories: string[] = [];
const handles: BackendHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

describe('adoption markers (local-only)', () => {
  it('stamps installedAt idempotently', () => {
    const database = createTestDatabase();
    const first = '2026-07-01T12:00:00.000Z';
    const second = '2026-07-02T12:00:00.000Z';

    ensureInstalledAt(database, first);
    ensureInstalledAt(database, second);

    expect(readAdoptionMarkers(database).installedAt).toBe(first);
  });

  it('leaves firstSourceAt empty until the first source exists', () => {
    const database = createTestDatabase();

    markFirstSourceAt(database);

    expect(readAdoptionMarkers(database).firstSourceAt).toBeNull();
  });

  it('stamps firstSourceAt exactly when the first source is created', () => {
    const database = createTestDatabase();
    const timestamp = '2026-07-02T12:00:00.000Z';

    insertTestSource(database);
    markFirstSourceAt(database, timestamp);

    expect(readAdoptionMarkers(database).firstSourceAt).toBe(timestamp);
  });

  it('does not overwrite firstSourceAt once set', () => {
    const database = createTestDatabase();
    insertTestSource(database);
    markFirstSourceAt(database, '2026-07-02T12:00:00.000Z');
    markFirstSourceAt(database, '2026-07-09T12:00:00.000Z');

    expect(readAdoptionMarkers(database).firstSourceAt).toBe(
      '2026-07-02T12:00:00.000Z',
    );
  });

  it('does not stamp firstSourceAt once more than one source exists', () => {
    const database = createTestDatabase();
    insertTestSource(database);
    insertTestSource(database);

    markFirstSourceAt(database);

    expect(readAdoptionMarkers(database).firstSourceAt).toBeNull();
  });

  it('persists across a reopen of the database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-adoption-'));
    directories.push(directory);
    const path = join(directory, 'adoption.sqlite');

    let database = openDatabase(path);
    runMigrations(database);
    ensureInstalledAt(database, '2026-07-01T12:00:00.000Z');
    insertTestSource(database);
    markFirstSourceAt(database, '2026-07-02T12:00:00.000Z');
    database.close();

    database = openDatabase(path);
    expect(readAdoptionMarkers(database)).toEqual({
      installedAt: '2026-07-01T12:00:00.000Z',
      firstSourceAt: '2026-07-02T12:00:00.000Z',
    });
    database.close();
  });
});

describe('adoption markers API', () => {
  it('exposes installedAt from startup and reflects a first-source stamp', async () => {
    const directory = temporary();
    const handle = await backend(directory);
    handles.push(handle);

    const initial = await fetch(`${handle.url}/api/adoption`);
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as {
      installedAt: string | null;
      firstSourceAt: string | null;
    };
    expect(initialBody.installedAt).not.toBeNull();
    expect(initialBody.firstSourceAt).toBeNull();

    insertTestSource(handle.database);
    markFirstSourceAt(handle.database, '2026-07-02T12:00:00.000Z');

    const after = await fetch(`${handle.url}/api/adoption`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      installedAt: initialBody.installedAt,
      firstSourceAt: '2026-07-02T12:00:00.000Z',
    });
  });
});

function backend(directory: string, options: BackendOptions = {}) {
  return startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
    backupDirectory: join(directory, 'backups'),
    candidateProfilePath: join(
      process.cwd(),
      'config',
      'candidate-profile.json',
    ),
    scoringConfigPath: join(process.cwd(), 'config', 'scoring-config.json'),
    resumeDirectory: join(directory, 'resumes'),
    clientDirectory: join(process.cwd(), 'dist', 'client'),
    host: '127.0.0.1',
    port: 0,
    ...options,
  });
}

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-adoption-'));
  directories.push(directory);
  return directory;
}
