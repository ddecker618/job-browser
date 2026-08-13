import { createServer } from 'node:net';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  startBackend,
  type BackendHandle,
  type BackendOptions,
} from '../src/server/backend.js';
import { DatabaseRecoveryError, openDatabase } from '../src/db/database.js';
import { DEFAULT_MIGRATIONS_DIRECTORY } from '../src/db/migration-runner.js';
import { leaveCommittedWal } from './helpers/wal-fixture.js';

const directories: string[] = [];
const handles: BackendHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

describe('backend lifecycle', () => {
  it('initializes a first-run database, applies migrations, and stops cleanly', async () => {
    const directory = temporary();
    const handle = await backend(directory);
    handles.push(handle);
    expect(handle.pendingMigrations).toContain('005_resume_parsing_error.sql');
    expect((await fetch(`${handle.url}/api/health`)).ok).toBe(true);
    await handle.stop();
    handles.length = 0;
    expect(handle.database.open).toBe(false);
  });

  it('preserves existing database records and avoids conventional-port collisions', async () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const first = await backend(directory, { databasePath });
    first.database.exec(
      "CREATE TABLE preservation_marker (value TEXT); INSERT INTO preservation_marker VALUES ('kept')",
    );
    await first.stop();

    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen(4173, '127.0.0.1', resolve),
    );
    try {
      const second = await backend(directory, { databasePath });
      handles.push(second);
      expect(new URL(second.url).port).not.toBe('4173');
      expect(
        second.database
          .prepare<
            [],
            { value: string }
          >('SELECT value FROM preservation_marker')
          .get()?.value,
      ).toBe('kept');
    } finally {
      occupied.close();
    }
  });

  it('recovers WAL data before pre-migration backup and migration', async () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const migrationsDirectory = join(directory, 'migrations');
    mkdirSync(migrationsDirectory);
    for (const filename of readdirSync(DEFAULT_MIGRATIONS_DIRECTORY)) {
      if (/^\d+_.+\.sql$/.test(filename)) {
        copyFileSync(
          join(DEFAULT_MIGRATIONS_DIRECTORY, filename),
          join(migrationsDirectory, filename),
        );
      }
    }

    const first = await backend(directory, {
      databasePath,
      migrationsDirectory,
    });
    first.database.exec(
      "CREATE TABLE recovery_marker (value TEXT NOT NULL); INSERT INTO recovery_marker VALUES ('main-file')",
    );
    await first.stop();
    writeFileSync(
      join(migrationsDirectory, '999_milestone_8_1_test.sql'),
      'CREATE TABLE milestone_8_1_test (id TEXT PRIMARY KEY);',
    );
    leaveCommittedWal(databasePath);

    const phases: string[] = [];
    const second = await backend(directory, {
      databasePath,
      migrationsDirectory,
      backupBeforeMigrations: true,
      onStartupProgress: (phase) => phases.push(phase),
    });
    handles.push(second);

    expect(phases).toEqual([
      'checking-database',
      'backing-up-database',
      'applying-database-updates',
      'starting-local-service',
    ]);
    expect(second.pendingMigrations).toEqual(['999_milestone_8_1_test.sql']);
    expect(second.migrationBackupPath).not.toBeNull();
    expect(existsSync(second.migrationBackupPath!)).toBe(true);
    expect(
      second.database
        .prepare<
          [],
          { value: string }
        >('SELECT value FROM recovery_marker ORDER BY rowid DESC LIMIT 1')
        .get()?.value,
    ).toBe('wal-only');
    expect(
      second.database
        .prepare<
          [],
          { count: number }
        >("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'milestone_8_1_test'")
        .get()?.count,
    ).toBe(1);

    const backup = openDatabase(second.migrationBackupPath!);
    expect(
      backup
        .prepare<
          [],
          { value: string }
        >('SELECT value FROM recovery_marker ORDER BY rowid DESC LIMIT 1')
        .get()?.value,
    ).toBe('wal-only');
    backup.close();
  });

  it('stops before backup or migration when recovery fails', async () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const quarantineDirectory = join(directory, 'quarantine');
    const phases: string[] = [];
    writeFileSync(databasePath, Buffer.alloc(4096, 0xa5));

    let failure: unknown;
    try {
      await backend(directory, {
        databasePath,
        databaseQuarantineDirectory: quarantineDirectory,
        backupBeforeMigrations: true,
        onStartupProgress: (phase) => phases.push(phase),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DatabaseRecoveryError);
    expect((failure as DatabaseRecoveryError).quarantine).toBeDefined();
    expect(phases).toEqual(['checking-database']);
    expect(existsSync(join(directory, 'backups'))).toBe(false);
  });

  it('rate-limits API and client file requests independently', async () => {
    const directory = temporary();
    const clientDirectory = join(directory, 'client');
    mkdirSync(clientDirectory);
    writeFileSync(
      join(clientDirectory, 'index.html'),
      '<main>Job Browser</main>',
    );
    const handle = await backend(directory, {
      clientDirectory,
      apiRequestsPerMinute: 2,
      clientRequestsPerMinute: 2,
    });
    handles.push(handle);

    expect((await fetch(`${handle.url}/api/health`)).status).toBe(200);
    expect((await fetch(`${handle.url}/api/health`)).status).toBe(200);
    const limitedApiResponse = await fetch(`${handle.url}/api/health`);
    expect(limitedApiResponse.status).toBe(429);
    expect(
      Number(limitedApiResponse.headers.get('retry-after')),
    ).toBeGreaterThan(0);

    expect((await fetch(`${handle.url}/jobs`)).status).toBe(200);
    expect((await fetch(`${handle.url}/sources`)).status).toBe(200);
    const limitedClientResponse = await fetch(`${handle.url}/settings`);
    expect(limitedClientResponse.status).toBe(429);
    expect(
      Number(limitedClientResponse.headers.get('retry-after')),
    ).toBeGreaterThan(0);
  });
});

async function backend(directory: string, options: BackendOptions = {}) {
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
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-backend-'));
  directories.push(directory);
  return directory;
}
