import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { JobDatabase } from '../db/database.js';
import {
  SNAPSHOT_QUARANTINE_DIRECTORY,
  SNAPSHOT_STAGING_DIRECTORY,
} from '../domain/resume-snapshot.js';
import { ResumeSnapshotRepository } from '../repositories/resume-snapshot-repository.js';
import {
  assertSafeStorageKey,
  quarantineSnapshotArtifact,
  removePublishedArtifact,
  verifySnapshotArtifact,
} from './snapshotStorage.js';

export type SnapshotIntegrityReason =
  | 'missing'
  | 'corrupt'
  | 'path_escape'
  | 'malformed_key';

export interface SnapshotIntegrityFailure {
  snapshotId: string;
  storageKey: string;
  reason: SnapshotIntegrityReason;
}

export interface SnapshotReconciliationReport {
  healthy: boolean;
  quarantinedKeys: string[];
  removedStagingKeys: string[];
  integrityFailures: SnapshotIntegrityFailure[];
}

export function reconcileSnapshotStorage(
  snapshotRoot: string,
  database: JobDatabase,
): SnapshotReconciliationReport {
  const repository = new ResumeSnapshotRepository(database);
  const artifacts = repository.listArtifacts();

  const failures: SnapshotIntegrityFailure[] = [];
  const referencedKeys = new Set<string>();

  for (const artifact of artifacts) {
    try {
      assertSafeStorageKey(artifact.storageKey);
      referencedKeys.add(artifact.storageKey);
    } catch {
      failures.push({
        snapshotId: artifact.id,
        storageKey: artifact.storageKey,
        reason: 'malformed_key',
      });
      continue;
    }
    try {
      verifySnapshotArtifact(
        snapshotRoot,
        artifact.storageKey,
        artifact.contentHash,
        artifact.sizeBytes,
      );
    } catch (error) {
      const reason: SnapshotIntegrityReason =
        error instanceof Error && error.message.includes('resolves outside')
          ? 'path_escape'
          : error instanceof Error && error.message.includes('missing')
            ? 'missing'
            : 'corrupt';
      failures.push({
        snapshotId: artifact.id,
        storageKey: artifact.storageKey,
        reason,
      });
    }
  }

  const root = resolve(snapshotRoot);
  const quarantinedKeys: string[] = [];
  const removedStagingKeys: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === SNAPSHOT_QUARANTINE_DIRECTORY) continue;
      if (entry.name === SNAPSHOT_STAGING_DIRECTORY) {
        for (const staged of readdirSync(join(root, entry.name), {
          withFileTypes: true,
        })) {
          if (staged.isFile()) {
            removePublishedArtifact(
              join(root, SNAPSHOT_STAGING_DIRECTORY),
              staged.name,
            );
            removedStagingKeys.push(staged.name);
          }
        }
        continue;
      }
      failures.push({
        snapshotId: '(no snapshot)',
        storageKey: entry.name,
        reason: 'malformed_key',
      });
      continue;
    }
    if (!entry.isFile()) continue;
    if (referencedKeys.has(entry.name)) continue;
    try {
      assertSafeStorageKey(entry.name);
      quarantineSnapshotArtifact(snapshotRoot, entry.name);
      quarantinedKeys.push(entry.name);
    } catch {
      failures.push({
        snapshotId: '(no snapshot)',
        storageKey: entry.name,
        reason: 'malformed_key',
      });
    }
  }

  const healthy = failures.length === 0;
  return {
    healthy,
    quarantinedKeys,
    removedStagingKeys,
    integrityFailures: failures,
  };
}

export function initializeSnapshotStorage(snapshotRoot: string): void {
  mkdirSync(resolve(snapshotRoot), { recursive: true });
  mkdirSync(resolve(snapshotRoot, SNAPSHOT_STAGING_DIRECTORY), {
    recursive: true,
  });
  mkdirSync(resolve(snapshotRoot, SNAPSHOT_QUARANTINE_DIRECTORY), {
    recursive: true,
  });
}
