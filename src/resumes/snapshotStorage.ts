import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';

import {
  ResumeSnapshotCaptureError,
  ResumeSnapshotIntegrityError,
  SNAPSHOT_QUARANTINE_DIRECTORY,
  SNAPSHOT_STAGING_DIRECTORY,
} from '../domain/resume-snapshot.js';

export interface StagedSnapshotArtifact {
  tempPath: string;
  contentHash: string;
  sizeBytes: number;
}

export interface SourceFileStat {
  size: number;
  mtimeMs: number;
}

const MAX_STORAGE_KEY_LENGTH = 200;

export function resolveSnapshotStoragePath(
  snapshotRoot: string,
  storagePath: string,
): string {
  const root = resolve(snapshotRoot);
  const candidate = resolve(snapshotRoot, storagePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!candidate.startsWith(rootPrefix)) {
    throw new ResumeSnapshotCaptureError(
      'Snapshot storage path must remain inside the configured snapshot directory',
      'snapshot_path_escape',
    );
  }
  return candidate;
}

export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > MAX_STORAGE_KEY_LENGTH ||
    key === '.' ||
    key === '..' ||
    key.includes('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    /^[A-Za-z]:/.test(key)
  ) {
    throw new ResumeSnapshotCaptureError(
      'Malformed snapshot storage key',
      'snapshot_malformed_storage_key',
    );
  }
}

export function stageSnapshotArtifact(
  sourcePath: string,
  snapshotRoot: string,
): StagedSnapshotArtifact {
  const root = resolve(snapshotRoot);
  const stagingRoot = resolve(root, SNAPSHOT_STAGING_DIRECTORY);
  mkdirSync(stagingRoot, { recursive: true });
  const before = statSync(sourcePath);
  const beforeStat: SourceFileStat = {
    size: before.size,
    mtimeMs: before.mtimeMs,
  };
  const tempPath = join(stagingRoot, `${randomUUID()}.staged`);
  try {
    copyFileSync(sourcePath, tempPath);
  } catch (error) {
    removeIfPresent(tempPath);
    throw new ResumeSnapshotCaptureError(
      `Unable to copy the selected Resume into snapshot staging: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'snapshot_copy_failed',
      { cause: error },
    );
  }
  try {
    verifySourceStable(beforeStat, sourcePath);
  } catch (error) {
    removeIfPresent(tempPath);
    throw error;
  }
  try {
    const staged = statSync(tempPath);
    const contentHash = hashFile(tempPath);
    return {
      tempPath,
      contentHash,
      sizeBytes: staged.size,
    };
  } catch (error) {
    removeIfPresent(tempPath);
    throw new ResumeSnapshotCaptureError(
      `Unable to verify the staged Resume artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'snapshot_hash_or_stat_failed',
      { cause: error },
    );
  }
}

export function verifySourceStable(
  before: SourceFileStat,
  sourcePath: string,
): void {
  const after = statSync(sourcePath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new ResumeSnapshotCaptureError(
      'The selected Resume changed during capture; failing safely to preserve historical certainty',
      'snapshot_source_mutated',
    );
  }
}

export function assertRealPathWithin(sourcePath: string, root: string): void {
  const sourceReal = realpathSync(sourcePath);
  const rootReal = realpathSync(root);
  const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  if (!sourceReal.startsWith(prefix)) {
    throw new ResumeSnapshotCaptureError(
      'The selected Resume resolves outside the configured resume directory',
      'snapshot_path_escape',
    );
  }
}

export function publishSnapshotArtifact(
  tempPath: string,
  snapshotRoot: string,
  storageKey: string,
): string {
  assertSafeStorageKey(storageKey);
  const finalPath = resolveSnapshotStoragePath(snapshotRoot, storageKey);
  try {
    renameSync(tempPath, finalPath);
  } catch (error) {
    removeIfPresent(tempPath);
    throw new ResumeSnapshotCaptureError(
      `Unable to publish the staged Resume artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'snapshot_rename_failed',
      { cause: error },
    );
  }
  return finalPath;
}

export function removeStagedArtifact(tempPath: string): void {
  removeIfPresent(tempPath);
}

export function removePublishedArtifact(
  snapshotRoot: string,
  storageKey: string,
): void {
  try {
    assertSafeStorageKey(storageKey);
    const path = resolveSnapshotStoragePath(snapshotRoot, storageKey);
    removeIfPresent(path);
  } catch {
    // A malformed key is reconciled as an integrity failure; never touch it
    // outside the managed root from cleanup paths.
  }
}

export function quarantineSnapshotArtifact(
  snapshotRoot: string,
  storageKey: string,
): void {
  assertSafeStorageKey(storageKey);
  const quarantineRoot = resolve(snapshotRoot, SNAPSHOT_QUARANTINE_DIRECTORY);
  mkdirSync(quarantineRoot, { recursive: true });
  const source = resolveSnapshotStoragePath(snapshotRoot, storageKey);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(quarantineRoot, `${timestamp}-${storageKey}`);
  try {
    if (existsSync(source)) renameSync(source, destination);
  } catch {
    // Quarantine is best-effort; the orphan remains visible for the next pass.
  }
}

export function verifySnapshotArtifact(
  snapshotRoot: string,
  storageKey: string,
  contentHash: string,
  sizeBytes: number,
): string {
  const path = resolveSnapshotStoragePath(snapshotRoot, storageKey);
  if (!existsSync(path)) {
    throw new ResumeSnapshotIntegrityError(
      `Snapshot artifact is missing at ${storageKey}`,
    );
  }
  const realRoot = realpathSync(snapshotRoot);
  const realPath = realpathSync(path);
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!realPath.startsWith(prefix)) {
    throw new ResumeSnapshotIntegrityError(
      `Snapshot artifact resolves outside the managed snapshot root: ${storageKey}`,
    );
  }
  let actualHash: string;
  let actualSize: number;
  try {
    actualHash = hashFile(path);
    actualSize = statSync(path).size;
  } catch (error) {
    throw new ResumeSnapshotIntegrityError(
      `Snapshot artifact is unreadable at ${storageKey}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (actualHash !== contentHash || actualSize !== sizeBytes) {
    throw new ResumeSnapshotIntegrityError(
      `Snapshot artifact failed integrity verification at ${storageKey}`,
    );
  }
  return path;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readBytes(path)).digest('hex');
}

function readBytes(path: string): Buffer {
  return readFileSync(path);
}

function removeIfPresent(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Cleanup is best-effort; leftover staging is handled by reconciliation.
  }
}
