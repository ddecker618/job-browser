import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DatabaseRecoveryError,
  openDatabase,
  verifyDatabaseIntegrity,
} from '../src/db/database.js';
import { quarantineDatabaseSet } from '../src/db/database-recovery.js';
import { leaveCommittedWal } from './helpers/wal-fixture.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

describe('database recovery', () => {
  it('recovers committed data from a real WAL after abnormal shutdown', () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const mainOnlyPath = join(directory, 'main-only.sqlite');
    const database = openDatabase(databasePath);
    database.exec(
      "CREATE TABLE recovery_marker (value TEXT NOT NULL); INSERT INTO recovery_marker VALUES ('main-file')",
    );
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.close();

    leaveCommittedWal(databasePath);
    expect(existsSync(`${databasePath}-wal`)).toBe(true);

    copyFileSync(databasePath, mainOnlyPath);
    const mainOnly = new Database(mainOnlyPath, {
      readonly: true,
      fileMustExist: true,
    });
    expect(markerValues(mainOnly)).toEqual(['main-file']);
    mainOnly.close();

    const recovered = openDatabase(databasePath, {
      quarantineDirectory: join(directory, 'quarantine'),
    });
    expect(markerValues(recovered)).toEqual(['main-file', 'wal-only']);
    expect(() =>
      verifyDatabaseIntegrity(recovered, databasePath),
    ).not.toThrow();
    recovered
      .prepare('INSERT INTO recovery_marker (value) VALUES (?)')
      .run('still-usable');
    expect(markerValues(recovered)).toEqual([
      'main-file',
      'wal-only',
      'still-usable',
    ]);
    recovered.close();
  });

  it('quarantines a corrupt database set without replacing the originals', () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const quarantineRoot = join(directory, 'quarantine');
    const originals = new Map<string, Buffer>([
      [databasePath, Buffer.alloc(4096, 0xa5)],
      [`${databasePath}-wal`, Buffer.from('provider-secret-wal-evidence\n')],
      [`${databasePath}-shm`, Buffer.from('provider-secret-shm-evidence\n')],
    ]);
    for (const [path, contents] of originals) writeFileSync(path, contents);

    const error = captureRecoveryError(() =>
      openDatabase(databasePath, { quarantineDirectory: quarantineRoot }),
    );
    expect(error.reason).toBe('database-integrity-failed');
    expect(error.quarantine).toBeDefined();
    expect(error.quarantineFailed).toBe(false);

    for (const [path, contents] of originals) {
      expect(readFileSync(path)).toEqual(contents);
      expect(
        readFileSync(join(error.quarantine!.directory, basename(path))),
      ).toEqual(contents);
    }

    const metadataText = readFileSync(error.quarantine!.metadataPath, 'utf8');
    const metadata = JSON.parse(metadataText) as Record<string, unknown>;
    expect(metadataText.length).toBeLessThan(4096);
    expect(metadataText).not.toContain('provider-secret');
    expect(Object.keys(metadata).sort()).toEqual([
      'createdAt',
      'databasePath',
      'files',
      'incidentId',
      'phase',
      'reason',
      'sqliteCode',
      'version',
    ]);
    expect((metadata['files'] as unknown[]).length).toBe(3);

    const second = quarantineDatabaseSet(databasePath, quarantineRoot, error);
    expect(second.directory).not.toBe(error.quarantine!.directory);
  });

  it('quarantines orphaned sidecars without creating an empty database', () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const wal = Buffer.from('orphaned wal evidence');
    const shm = Buffer.from('orphaned shm evidence');
    writeFileSync(`${databasePath}-wal`, wal);
    writeFileSync(`${databasePath}-shm`, shm);

    const error = captureRecoveryError(() =>
      openDatabase(databasePath, {
        quarantineDirectory: join(directory, 'quarantine'),
      }),
    );
    expect(error.reason).toBe('database-set-incomplete');
    expect(existsSync(databasePath)).toBe(false);
    expect(readFileSync(`${databasePath}-wal`)).toEqual(wal);
    expect(readFileSync(`${databasePath}-shm`)).toEqual(shm);
    expect(error.quarantine?.files.map((file) => file.kind).sort()).toEqual([
      'shm',
      'wal',
    ]);
  });
});

function markerValues(database: Database.Database): string[] {
  return database
    .prepare<[], { value: string }>(
      'SELECT value FROM recovery_marker ORDER BY rowid',
    )
    .all()
    .map((row) => row.value);
}

function captureRecoveryError(action: () => unknown): DatabaseRecoveryError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseRecoveryError);
    return error as DatabaseRecoveryError;
  }
  throw new Error('Expected database recovery to fail');
}

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-recovery-'));
  directories.push(directory);
  return directory;
}
