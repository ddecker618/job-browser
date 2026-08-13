import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  SNAPSHOT_QUARANTINE_DIRECTORY,
  SNAPSHOT_STAGING_DIRECTORY,
} from '../src/domain/resume-snapshot.js';
import {
  initializeSnapshotStorage,
  reconcileSnapshotStorage,
} from '../src/resumes/reconcileSnapshots.js';
import { resolveSnapshotStoragePath } from '../src/resumes/snapshotStorage.js';
import { createTestDatabase } from './helpers/test-database.js';

const BASE = tmpdir();

describe('ResumeSnapshot reconciliation', () => {
  let database: JobDatabase;
  const roots: string[] = [];
  let snapshotRoot: string;

  afterEach(() => {
    database.close();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('reports healthy when every recorded artifact is present and verified', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('healthy');
    writeSnapshotRow('snap-healthy', 'key-healthy', sha256('hello world'), 11);
    const artifact = resolveSnapshotStoragePath(snapshotRoot, 'key-healthy');
    writeFileSync(artifact, 'hello world');

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.healthy).toBe(true);
    expect(report.integrityFailures).toEqual([]);
    expect(report.quarantinedKeys).toEqual([]);
    expect(report.removedStagingKeys).toEqual([]);
  });

  it('quarantines a file that is not referenced by any Snapshot row', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('orphan');
    writeFileSync(
      resolveSnapshotStoragePath(snapshotRoot, 'orphan-key'),
      'stray',
    );

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.quarantinedKeys).toEqual(['orphan-key']);
    expect(
      existsSync(resolveSnapshotStoragePath(snapshotRoot, 'orphan-key')),
    ).toBe(false);
    expect(
      readdirSync(join(snapshotRoot, SNAPSHOT_QUARANTINE_DIRECTORY)).some(
        (name) => name.endsWith('orphan-key'),
      ),
    ).toBe(true);
  });

  it('removes leftover staging files', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('staging');
    const staged = join(
      snapshotRoot,
      SNAPSHOT_STAGING_DIRECTORY,
      'leftover.staged',
    );
    writeFileSync(staged, 'abandoned temp artifact');

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.removedStagingKeys).toEqual(['leftover.staged']);
    expect(existsSync(staged)).toBe(false);
  });

  it('flags a corrupt artifact without replacing or destroying it', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('corrupt');
    writeSnapshotRow('snap-corrupt', 'key-corrupt', 'a'.repeat(64), 11);
    writeFileSync(
      resolveSnapshotStoragePath(snapshotRoot, 'key-corrupt'),
      'tampered',
    );

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.healthy).toBe(false);
    expect(report.integrityFailures).toEqual([
      {
        snapshotId: 'snap-corrupt',
        storageKey: 'key-corrupt',
        reason: 'corrupt',
      },
    ]);
    expect(
      existsSync(resolveSnapshotStoragePath(snapshotRoot, 'key-corrupt')),
    ).toBe(true);
  });

  it('flags a missing artifact as an integrity failure', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('missing');
    writeSnapshotRow('snap-missing', 'key-missing', 'content-hash-missing', 11);

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.healthy).toBe(false);
    expect(report.integrityFailures[0]?.reason).toBe('missing');
  });

  it('flags a malformed storage key without touching the filesystem', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('malformed');
    writeSnapshotRow(
      'snap-malformed',
      '../escape',
      'content-hash-malformed',
      11,
    );

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.healthy).toBe(false);
    expect(report.integrityFailures[0]?.reason).toBe('malformed_key');
  });

  it('surfaces every problem together for later inspection', () => {
    database = createTestDatabase();
    snapshotRoot = newSnapshotRoot('combined');
    writeSnapshotRow('snap-good', 'key-good', sha256('ok'), 2);
    writeSnapshotRow('snap-bad', 'key-bad', 'wrong-hash', 2);
    writeFileSync(resolveSnapshotStoragePath(snapshotRoot, 'key-good'), 'ok');
    writeFileSync(resolveSnapshotStoragePath(snapshotRoot, 'key-bad'), 'ok');
    writeFileSync(resolveSnapshotStoragePath(snapshotRoot, 'stray'), 'stray');

    const report = reconcileSnapshotStorage(snapshotRoot, database);

    expect(report.healthy).toBe(false);
    expect(report.quarantinedKeys).toEqual(['stray']);
    expect(report.integrityFailures).toContainEqual({
      snapshotId: 'snap-bad',
      storageKey: 'key-bad',
      reason: 'corrupt',
    });
  });

  function newSnapshotRoot(suffix: string): string {
    const root = mkdtempSync(join(BASE, `jb-reconcile-${suffix}-`));
    roots.push(root);
    initializeSnapshotStorage(root);
    return root;
  }

  function writeSnapshotRow(
    id: string,
    storageKey: string,
    contentHash: string,
    sizeBytes: number,
  ): void {
    database
      .prepare(
        `INSERT INTO resume_snapshots (
          id, source_resume_id, live_resume_id, content_hash, storage_key,
          original_filename, mime_type, extension, size_bytes, parser_version,
          normalization_version, parsing_status, parsing_error, reuse_key,
          created_at
        ) VALUES (?, NULL, NULL, ?, ?, 'resume.txt', 'text/plain', '.txt',
          ?, 'resume-parser-v1', 'resume-normalization-v1', 'parsed', NULL,
          NULL, '2026-01-01T00:00:00.000Z')`,
      )
      .run(id, contentHash, storageKey, sizeBytes);
  }

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
});
