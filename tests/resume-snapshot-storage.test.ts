import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ResumeSnapshotCaptureError,
  ResumeSnapshotIntegrityError,
  SNAPSHOT_QUARANTINE_DIRECTORY,
  SNAPSHOT_STAGING_DIRECTORY,
} from '../src/domain/resume-snapshot.js';
import {
  assertSafeStorageKey,
  publishSnapshotArtifact,
  quarantineSnapshotArtifact,
  removePublishedArtifact,
  removeStagedArtifact,
  resolveSnapshotStoragePath,
  stageSnapshotArtifact,
  verifySnapshotArtifact,
  verifySourceStable,
} from '../src/resumes/snapshotStorage.js';

const BASE = tmpdir();

function tempRoot(prefix: string): string {
  return mkdtempSync(join(BASE, prefix));
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('ResumeSnapshot snapshotStorage', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('stages exact bytes with a content hash and recorded size', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const source = join(root, 'resume.txt');
    const payload = Buffer.from('Staged exact bytes content');
    writeFileSync(source, payload);
    mkdirSync(join(root, 'snapshot'));
    const snapshotRoot = join(root, 'snapshot');

    const staged = stageSnapshotArtifact(source, snapshotRoot);

    expect(staged.contentHash).toBe(sha256(payload));
    expect(staged.sizeBytes).toBe(payload.length);
    expect(existsSync(staged.tempPath)).toBe(true);
    expect(readFileSync(staged.tempPath)).toEqual(payload);
    expect(
      staged.tempPath.startsWith(
        join(snapshotRoot, SNAPSHOT_STAGING_DIRECTORY),
      ),
    ).toBe(true);

    removeStagedArtifact(staged.tempPath);
    expect(existsSync(staged.tempPath)).toBe(false);
  });

  it('fails safely when the source disappears after staging (mutation detection)', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const source = join(root, 'unstable.txt');
    writeFileSync(source, 'version one');
    const sourceStat = statSync(source);
    const before = {
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
    };

    expect(() => verifySourceStable(before, source)).not.toThrow();

    writeFileSync(source, 'version two - longer content');
    expect(() => verifySourceStable(before, source)).toThrow(
      ResumeSnapshotCaptureError,
    );
    try {
      verifySourceStable(before, source);
    } catch (error) {
      expect((error as ResumeSnapshotCaptureError).code).toBe(
        'snapshot_source_mutated',
      );
    }
  });

  it('leaves no staging artifact when the copy fails', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const sourceDirectory = join(root, 'source-dir');
    mkdirSync(sourceDirectory);
    const snapshotRoot = join(root, 'snapshot');

    let error: unknown;
    try {
      stageSnapshotArtifact(sourceDirectory, snapshotRoot);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ResumeSnapshotCaptureError);
    expect((error as ResumeSnapshotCaptureError).code).toBe(
      'snapshot_copy_failed',
    );
    const staging = join(snapshotRoot, SNAPSHOT_STAGING_DIRECTORY);
    if (existsSync(staging)) {
      expect(
        readdirSync(staging).filter((name) => name.endsWith('.staged')).length,
      ).toBe(0);
    }
  });

  it('publishes an artifact atomically at the final opaque key', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const snapshotRoot = join(root, 'snapshot');
    mkdirSync(snapshotRoot, { recursive: true });
    const staging = join(snapshotRoot, SNAPSHOT_STAGING_DIRECTORY);
    mkdirSync(staging, { recursive: true });
    const tempPath = join(staging, 'abc.staged');
    const payload = Buffer.from('Published bytes');
    writeFileSync(tempPath, payload);

    const published = publishSnapshotArtifact(
      tempPath,
      snapshotRoot,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(published).toBe(
      resolveSnapshotStoragePath(
        snapshotRoot,
        '11111111-1111-4111-8111-111111111111',
      ),
    );
    expect(readFileSync(published)).toEqual(payload);
    expect(existsSync(tempPath)).toBe(false);
  });

  it('rejects malformed and escaping storage keys before any file touch', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const snapshotRoot = join(root, 'snapshot');
    mkdirSync(snapshotRoot, { recursive: true });
    const tempPath = join(snapshotRoot, 'temp.staged');
    writeFileSync(tempPath, 'staged');

    for (const badKey of [
      '../escape.txt',
      '/absolute.txt',
      'a/b.txt',
      '..',
      '',
    ]) {
      expect(() =>
        publishSnapshotArtifact(tempPath, snapshotRoot, badKey),
      ).toThrow(ResumeSnapshotCaptureError);
    }
    expect(() => assertSafeStorageKey('ok-key-123')).not.toThrow();
    expect(() =>
      resolveSnapshotStoragePath(snapshotRoot, '../outside'),
    ).toThrow(ResumeSnapshotCaptureError);
    expect(resolveSnapshotStoragePath(snapshotRoot, 'inside.txt')).toContain(
      'inside.txt',
    );
  });

  it('verifies an artifact against its recorded hash and size', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const snapshotRoot = join(root, 'snapshot');
    mkdirSync(snapshotRoot, { recursive: true });
    const key = '22222222-2222-4222-8222-222222222222';
    const payload = Buffer.from('Verifiable snapshot bytes');
    const path = resolveSnapshotStoragePath(snapshotRoot, key);
    writeFileSync(path, payload);

    expect(
      verifySnapshotArtifact(
        snapshotRoot,
        key,
        sha256(payload),
        payload.length,
      ),
    ).toBe(path);

    expect(() =>
      verifySnapshotArtifact(
        snapshotRoot,
        key,
        sha256('different bytes'),
        payload.length,
      ),
    ).toThrow(ResumeSnapshotIntegrityError);
    expect(() =>
      verifySnapshotArtifact(
        snapshotRoot,
        key,
        sha256(payload),
        payload.length + 1,
      ),
    ).toThrow(ResumeSnapshotIntegrityError);

    removePublishedArtifact(snapshotRoot, key);
    expect(() =>
      verifySnapshotArtifact(
        snapshotRoot,
        key,
        sha256(payload),
        payload.length,
      ),
    ).toThrow(ResumeSnapshotIntegrityError);
  });

  it('quarantines a published artifact out of the managed root', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const snapshotRoot = join(root, 'snapshot');
    mkdirSync(snapshotRoot, { recursive: true });
    const key = '33333333-3333-4333-8333-333333333333';
    const payload = randomBytes(256);
    writeFileSync(resolveSnapshotStoragePath(snapshotRoot, key), payload);

    quarantineSnapshotArtifact(snapshotRoot, key);

    expect(existsSync(resolveSnapshotStoragePath(snapshotRoot, key))).toBe(
      false,
    );
    const quarantine = join(snapshotRoot, SNAPSHOT_QUARANTINE_DIRECTORY);
    const quarantined = readdirSync(quarantine).filter((name) =>
      name.endsWith(key),
    );
    expect(quarantined.length).toBe(1);
  });

  it('supports free-standing remove of a published artifact', () => {
    const root = tempRoot('jb-storage-');
    roots.push(root);
    const snapshotRoot = join(root, 'snapshot');
    mkdirSync(snapshotRoot, { recursive: true });
    const key = '44444444-4444-4444-8444-444444444444';
    writeFileSync(resolveSnapshotStoragePath(snapshotRoot, key), 'bytes');

    removePublishedArtifact(snapshotRoot, key);
    expect(existsSync(resolveSnapshotStoragePath(snapshotRoot, key))).toBe(
      false,
    );
    expect(() => removePublishedArtifact(snapshotRoot, key)).not.toThrow();
  });
});
