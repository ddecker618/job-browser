import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { openDatabase, type JobDatabase } from '../db/database.js';
import { inspectDatabaseSet } from '../db/database-recovery.js';
import { persistenceSetCoordinator } from '../db/persistenceSetCoordinator.js';
import { nowUtc } from '../utilities/timestamps.js';
import { assertSafeStorageKey } from '../resumes/snapshotStorage.js';
import { resolveResumeStoragePath } from '../resumes/resumeService.js';

export interface PersistenceSetPaths {
  databasePath: string;
  resumeDirectory: string;
  snapshotDirectory: string;
  candidateProfilePath: string;
  scoringConfigPath: string;
  profilePreferencesPath?: string;
  backupDirectory: string;
}

export type FileRole =
  | 'database'
  | 'database-wal'
  | 'database-shm'
  | 'resume'
  | 'snapshot'
  | 'candidate_profile'
  | 'scoring_config'
  | 'profile_preferences';

export interface BackupFileRecord {
  role: FileRole;
  ownerId: string | null;
  relativeKey: string;
  sourcePath: string;
  contentHash: string;
  sizeBytes: number;
}

export interface BackupManifest {
  manifestVersion: number;
  backupId: string;
  startedAt: string;
  completedAt: string | null;
  databasePath: string;
  databaseBackupPath: string;
  schemaVersion: number;
  files: BackupFileRecord[];
  manifestHash: string;
  totalBytes: number;
}

export interface BackupResult {
  backupId: string;
  manifestPath: string;
  databaseBackupPath: string;
  fileCount: number;
  totalBytes: number;
}

export interface BackupMetadata {
  backupId: string;
  startedAt: string;
  completedAt: string | null;
  databasePath: string;
  databaseBackupPath: string;
  schemaVersion: number;
  status: 'complete' | 'failed' | 'interrupted';
  fileCount: number;
  totalBytes: number;
  manifestHash: string;
}

export interface RestoreSelection {
  backupId?: string;
  atTimestamp?: string;
}

export interface RestoreDryRunReport {
  backupId: string;
  filesToRestore: BackupFileRecord[];
  filesPresent: number;
  filesMissing: number;
  totalBytes: number;
  missingDetails: { role: FileRole; relativeKey: string }[];
}

export interface RestoreResult {
  backupId: string;
  restoredFiles: number;
  databaseRestored: boolean;
  manifestVerified: boolean;
  resumePathsRewritten: boolean;
  resumePathsRewrittenCount: number;
}

export class PersistenceSetBackupError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'PersistenceSetBackupError';
  }
}

export class PersistenceSetRestoreError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'PersistenceSetRestoreError';
  }
}

const MANIFEST_VERSION = 1;
const MANIFEST_FILENAME = 'manifest.json';
const DATABASE_BACKUP_FILENAME = 'database.sqlite';
const RESUME_SUBDIR = 'resumes';
const SNAPSHOT_SUBDIR = 'snapshots';
const PREFERENCES_SUBDIR = 'preferences';

export async function createPersistenceSetBackup(
  database: JobDatabase,
  paths: PersistenceSetPaths,
): Promise<BackupResult> {
  return persistenceSetCoordinator.withRead(() =>
    backupSourceData(database, paths),
  );
}

async function backupSourceData(
  database: JobDatabase,
  paths: PersistenceSetPaths,
): Promise<BackupResult> {
  const backupId = randomUUID();
  const startedAt = nowUtc();
  const backupSetDirectory = join(paths.backupDirectory, backupId);
  const databaseBackupPath = join(backupSetDirectory, DATABASE_BACKUP_FILENAME);

  if (existsSync(backupSetDirectory)) {
    throw new PersistenceSetBackupError(
      `Backup directory already exists: ${backupSetDirectory}`,
      'backup-directory-exists',
    );
  }

  try {
    mkdirSync(backupSetDirectory, { recursive: true });
    const files: BackupFileRecord[] = [];

    await backupDatabaseSet(
      database,
      paths.databasePath,
      databaseBackupPath,
      files,
    );
    backupResumeFiles(
      database,
      paths.resumeDirectory,
      backupSetDirectory,
      files,
    );
    backupSnapshotFiles(
      database,
      paths.snapshotDirectory,
      backupSetDirectory,
      files,
    );
    backupPreferenceFile(
      paths.candidateProfilePath,
      backupSetDirectory,
      'candidate_profile',
      'candidate-profile.json',
      files,
    );
    backupPreferenceFile(
      paths.scoringConfigPath,
      backupSetDirectory,
      'scoring_config',
      'scoring-config.json',
      files,
    );
    if (paths.profilePreferencesPath !== undefined) {
      backupPreferenceFile(
        paths.profilePreferencesPath,
        backupSetDirectory,
        'profile_preferences',
        'profile-preferences.json',
        files,
      );
    }

    const schemaVersion = getCurrentSchemaVersion(database);

    const completedAt = nowUtc();
    const manifestWithoutHash: BackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      backupId,
      startedAt,
      completedAt,
      databasePath: paths.databasePath,
      databaseBackupPath,
      schemaVersion,
      files,
      manifestHash: '',
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    };

    const manifestJson = JSON.stringify(manifestWithoutHash, null, 2);
    const manifestHash = createHash('sha256')
      .update(manifestJson)
      .digest('hex');
    const manifest: BackupManifest = {
      ...manifestWithoutHash,
      manifestHash,
    };

    const manifestPath = join(backupSetDirectory, MANIFEST_FILENAME);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    persistManifestInDatabase(
      database,
      backupId,
      startedAt,
      completedAt,
      manifest,
      databaseBackupPath,
    );

    return {
      backupId,
      manifestPath,
      databaseBackupPath,
      fileCount: files.length,
      totalBytes: manifest.totalBytes,
    };
  } catch (error) {
    rmSync(backupSetDirectory, { recursive: true, force: true });
    if (error instanceof PersistenceSetBackupError) throw error;
    throw new PersistenceSetBackupError(
      `Backup failed: ${error instanceof Error ? error.message : String(error)}`,
      'backup-failed',
      { cause: error },
    );
  }
}

export function listBackups(database: JobDatabase): BackupMetadata[] {
  return database
    .prepare<
      [],
      {
        id: string;
        started_at: string;
        completed_at: string | null;
        database_path: string;
        database_backup_path: string;
        status: string;
        schema_version: number;
        file_count: number;
        total_bytes: number;
        manifest_hash: string;
      }
    >(
      `SELECT id, started_at, completed_at, database_path, database_backup_path,
              status, schema_version, file_count, total_bytes, manifest_hash
        FROM persistence_set_backups
       ORDER BY started_at DESC`,
    )
    .all()
    .map((row) => ({
      backupId: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      databasePath: row.database_path,
      databaseBackupPath: row.database_backup_path,
      schemaVersion: row.schema_version,
      status: row.status as BackupMetadata['status'],
      fileCount: row.file_count,
      totalBytes: row.total_bytes,
      manifestHash: row.manifest_hash,
    }));
}

export function loadBackupManifest(backupSetDirectory: string): BackupManifest {
  const manifestPath = join(backupSetDirectory, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new PersistenceSetRestoreError(
      `Manifest not found: ${manifestPath}`,
      'manifest-not-found',
    );
  }
  const content = readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(content) as BackupManifest;
  } catch {
    throw new PersistenceSetRestoreError(
      `Manifest is not valid JSON: ${manifestPath}`,
      'manifest-parse-failed',
    );
  }
}

export function verifyBackupSet(backupSetDirectory: string): BackupManifest {
  const manifest = loadBackupManifest(backupSetDirectory);

  const manifestJson = JSON.stringify(
    { ...manifest, manifestHash: '' },
    null,
    2,
  );
  const expectedHash = createHash('sha256').update(manifestJson).digest('hex');
  if (expectedHash !== manifest.manifestHash) {
    throw new PersistenceSetRestoreError(
      'Manifest hash mismatch; the backup set may be corrupted',
      'manifest-hash-mismatch',
    );
  }

  for (const file of manifest.files) {
    const filePath = resolveBackupFileInSet(backupSetDirectory, file);
    if (!existsSync(filePath)) {
      throw new PersistenceSetRestoreError(
        `Missing backup file: ${file.relativeKey} (${file.role})`,
        'file-missing-in-backup',
      );
    }
    const stat = statSync(filePath);
    if (stat.size !== file.sizeBytes) {
      throw new PersistenceSetRestoreError(
        `Size mismatch for ${file.relativeKey}: expected ${String(file.sizeBytes)}, got ${String(stat.size)}`,
        'file-size-mismatch',
      );
    }
    const actualHash = hashFile(filePath);
    if (actualHash !== file.contentHash) {
      throw new PersistenceSetRestoreError(
        `Hash mismatch for ${file.relativeKey}: expected ${file.contentHash}`,
        'file-hash-mismatch',
      );
    }
  }

  return manifest;
}

export function dryRunRestore(
  backupSetDirectory: string,
  paths: PersistenceSetPaths,
): RestoreDryRunReport {
  const manifest = verifyBackupSet(backupSetDirectory);
  const filesToRestore: BackupFileRecord[] = [];
  const missingDetails: { role: FileRole; relativeKey: string }[] = [];
  let filesPresent = 0;
  let filesMissing = 0;

  for (const file of manifest.files) {
    if (
      file.role === 'database' ||
      file.role === 'database-wal' ||
      file.role === 'database-shm'
    ) {
      filesToRestore.push(file);
      filesPresent += 1;
      continue;
    }
    const currentPath = resolveBackupFileToCurrentPath(file, paths);
    if (existsSync(currentPath)) {
      filesPresent += 1;
    } else {
      filesMissing += 1;
      missingDetails.push({ role: file.role, relativeKey: file.relativeKey });
    }
    filesToRestore.push(file);
  }

  return {
    backupId: manifest.backupId,
    filesToRestore,
    filesPresent,
    filesMissing,
    totalBytes: manifest.totalBytes,
    missingDetails,
  };
}

export function restorePersistenceSet(
  backupSetDirectory: string,
  paths: PersistenceSetPaths,
): RestoreResult {
  const manifest = verifyBackupSet(backupSetDirectory);

  if (existsSync(paths.databasePath)) {
    const set = inspectDatabaseSet(paths.databasePath);
    for (const member of set.members) {
      if (member.exists && backupSetDirectory === dirname(member.path)) {
        throw new PersistenceSetRestoreError(
          'Cannot restore onto the backup set directory itself',
          'restore-target-is-backup',
        );
      }
    }
  }

  mkdirSync(dirname(paths.databasePath), { recursive: true });

  for (const member of inspectDatabaseSet(paths.databasePath).members) {
    if (member.kind !== 'database' && member.exists) {
      rmSync(member.path, { force: true });
    }
  }

  const databaseBackupPath = join(backupSetDirectory, DATABASE_BACKUP_FILENAME);
  copyFileSync(databaseBackupPath, paths.databasePath);

  const walBackup = join(backupSetDirectory, `${DATABASE_BACKUP_FILENAME}-wal`);
  const shmBackup = join(backupSetDirectory, `${DATABASE_BACKUP_FILENAME}-shm`);
  if (existsSync(walBackup)) {
    copyFileSync(walBackup, `${paths.databasePath}-wal`);
  }
  if (existsSync(shmBackup)) {
    copyFileSync(shmBackup, `${paths.databasePath}-shm`);
  }

  let restoredFiles = 0;
  let resumePathsRewritten = 0;

  for (const file of manifest.files) {
    if (
      file.role === 'database' ||
      file.role === 'database-wal' ||
      file.role === 'database-shm'
    ) {
      continue;
    }

    const backupFilePath = resolveBackupFileInSet(backupSetDirectory, file);
    if (!existsSync(backupFilePath)) {
      throw new PersistenceSetRestoreError(
        `Missing backup file for restore: ${file.relativeKey}`,
        'file-missing-in-backup',
      );
    }

    if (file.role === 'resume') {
      const destPath = join(paths.resumeDirectory, basename(file.relativeKey));
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(backupFilePath, destPath);
      restoredFiles += 1;
    } else if (file.role === 'snapshot') {
      const destPath = join(paths.snapshotDirectory, file.relativeKey);
      mkdirSync(dirname(destPath), { recursive: true });
      try {
        assertSafeStorageKey(file.relativeKey);
      } catch {
        throw new PersistenceSetRestoreError(
          `Malformed snapshot storage key: ${file.relativeKey}`,
          'malformed-storage-key',
        );
      }
      copyFileSync(backupFilePath, destPath);
      restoredFiles += 1;
    } else {
      const destPath = resolveBackupFileToCurrentPath(file, paths);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(backupFilePath, destPath);
      restoredFiles += 1;
    }
  }

  const restoredDb = openDatabase(paths.databasePath);
  try {
    restoredDb.pragma('busy_timeout = 5000');
    restoredDb.pragma('foreign_keys = ON');

    for (const file of manifest.files) {
      if (file.role !== 'resume' || file.ownerId === null) continue;
      const currentPath = join(
        paths.resumeDirectory,
        basename(file.relativeKey),
      );
      const updated = restoredDb
        .prepare(
          'UPDATE resumes SET storage_path = ? WHERE id = ? AND storage_path != ?',
        )
        .run(currentPath, file.ownerId, currentPath);
      if (updated.changes > 0) {
        resumePathsRewritten += 1;
      }
    }

    restoredDb.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    restoredDb.close();
  }

  return {
    backupId: manifest.backupId,
    restoredFiles,
    databaseRestored: true,
    manifestVerified: true,
    resumePathsRewritten: resumePathsRewritten > 0,
    resumePathsRewrittenCount: resumePathsRewritten,
  };
}

async function backupDatabaseSet(
  database: JobDatabase,
  databasePath: string,
  databaseBackupPath: string,
  files: BackupFileRecord[],
): Promise<void> {
  if (!existsSync(databasePath)) {
    throw new PersistenceSetBackupError(
      `Database file not found: ${databasePath}`,
      'database-missing',
    );
  }

  await database.backup(databaseBackupPath);

  const stat = statSync(databaseBackupPath);
  files.push({
    role: 'database',
    ownerId: null,
    relativeKey: DATABASE_BACKUP_FILENAME,
    sourcePath: databasePath,
    contentHash: hashFile(databaseBackupPath),
    sizeBytes: stat.size,
  });
}

function backupResumeFiles(
  database: JobDatabase,
  resumeDirectory: string,
  backupSetDirectory: string,
  files: BackupFileRecord[],
): void {
  const rows = database
    .prepare<[], { id: string; storage_path: string }>(
      'SELECT id, storage_path FROM resumes ORDER BY id',
    )
    .all()
    .map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
    }));

  for (const row of rows) {
    if (row.storagePath.length === 0) {
      throw new PersistenceSetBackupError(
        `Resume ${row.id} has no storage path`,
        'resume-file-missing',
      );
    }
    const resolvedPath = resolveSafe(resumeDirectory, row.storagePath);
    if (resolvedPath === null || !existsSync(resolvedPath)) {
      throw new PersistenceSetBackupError(
        `Resume file is missing or outside the managed root: ${row.id}`,
        'resume-file-missing',
      );
    }
    const ext = extname(resolvedPath);
    const relativeKey = `${row.id}${ext}`;
    const destPath = join(backupSetDirectory, RESUME_SUBDIR, relativeKey);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(resolvedPath, destPath);
    const stat = statSync(destPath);
    files.push({
      role: 'resume',
      ownerId: row.id,
      relativeKey,
      sourcePath: resolvedPath,
      contentHash: hashFile(destPath),
      sizeBytes: stat.size,
    });
  }
}

function backupSnapshotFiles(
  database: JobDatabase,
  snapshotDirectory: string,
  backupSetDirectory: string,
  files: BackupFileRecord[],
): void {
  const artifacts = database
    .prepare<
      [],
      {
        id: string;
        storage_key: string;
        content_hash: string;
        size_bytes: number;
      }
    >(
      'SELECT id, storage_key, content_hash, size_bytes FROM resume_snapshots ORDER BY id',
    )
    .all()
    .map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      contentHash: row.content_hash,
      sizeBytes: row.size_bytes,
    }));

  for (const artifact of artifacts) {
    try {
      assertSafeStorageKey(artifact.storageKey);
    } catch {
      throw new PersistenceSetBackupError(
        `Snapshot has a malformed storage key: ${artifact.id}`,
        'snapshot-storage-key-invalid',
      );
    }
    const resolvedPath = join(snapshotDirectory, artifact.storageKey);
    if (!existsSync(resolvedPath)) {
      throw new PersistenceSetBackupError(
        `Snapshot file is missing: ${artifact.id}`,
        'snapshot-file-missing',
      );
    }
    const destPath = join(
      backupSetDirectory,
      SNAPSHOT_SUBDIR,
      artifact.storageKey,
    );
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(resolvedPath, destPath);
    const stat = statSync(destPath);
    const contentHash = hashFile(destPath);
    if (
      stat.size !== artifact.sizeBytes ||
      contentHash !== artifact.contentHash
    ) {
      throw new PersistenceSetBackupError(
        `Snapshot file failed integrity verification: ${artifact.id}`,
        'snapshot-file-corrupt',
      );
    }
    files.push({
      role: 'snapshot',
      ownerId: artifact.id,
      relativeKey: artifact.storageKey,
      sourcePath: resolvedPath,
      contentHash,
      sizeBytes: stat.size,
    });
  }
}

function backupPreferenceFile(
  filePath: string,
  backupSetDirectory: string,
  role: FileRole,
  relativeKey: string,
  files: BackupFileRecord[],
): void {
  if (!existsSync(filePath)) return;
  const destPath = join(backupSetDirectory, PREFERENCES_SUBDIR, relativeKey);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(filePath, destPath);
  const stat = statSync(filePath);
  files.push({
    role,
    ownerId: null,
    relativeKey,
    sourcePath: filePath,
    contentHash: hashFile(filePath),
    sizeBytes: stat.size,
  });
}

function persistManifestInDatabase(
  database: JobDatabase,
  backupId: string,
  startedAt: string,
  completedAt: string,
  manifest: BackupManifest,
  databaseBackupPath: string,
): void {
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO persistence_set_backups
           (id, started_at, completed_at, database_path, database_backup_path,
            status, schema_version, file_count, total_bytes, manifest_hash, created_at)
         VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?)`,
      )
      .run(
        backupId,
        startedAt,
        completedAt,
        manifest.databasePath,
        databaseBackupPath,
        manifest.schemaVersion,
        manifest.files.length,
        manifest.totalBytes,
        manifest.manifestHash,
        nowUtc(),
      );

    const insertFile = database.prepare(
      `INSERT INTO persistence_set_files
         (id, backup_id, role, owner_id, relative_key, source_path,
          content_hash, size_bytes, restored, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    for (const file of manifest.files) {
      insertFile.run(
        randomUUID(),
        backupId,
        file.role,
        file.ownerId,
        file.relativeKey,
        file.sourcePath,
        file.contentHash,
        file.sizeBytes,
        nowUtc(),
      );
    }
  })();
}

function getCurrentSchemaVersion(database: JobDatabase): number {
  const row = database
    .prepare<
      [],
      { version: number } | undefined
    >('SELECT MAX(version) AS version FROM schema_migrations')
    .get();
  return row?.version ?? 0;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function relativePathForRole(role: FileRole, relativeKey: string): string {
  switch (role) {
    case 'database':
      return DATABASE_BACKUP_FILENAME;
    case 'database-wal':
      return `${DATABASE_BACKUP_FILENAME}-wal`;
    case 'database-shm':
      return `${DATABASE_BACKUP_FILENAME}-shm`;
    case 'resume':
      return join(RESUME_SUBDIR, relativeKey);
    case 'snapshot':
      return join(SNAPSHOT_SUBDIR, relativeKey);
    case 'candidate_profile':
    case 'scoring_config':
    case 'profile_preferences':
      return join(PREFERENCES_SUBDIR, relativeKey);
    default:
      return relativeKey;
  }
}

function resolveBackupFileInSet(
  backupSetDirectory: string,
  file: BackupFileRecord,
): string {
  return join(
    backupSetDirectory,
    relativePathForRole(file.role, file.relativeKey),
  );
}

function resolveBackupFileToCurrentPath(
  file: BackupFileRecord,
  paths: PersistenceSetPaths,
): string {
  switch (file.role) {
    case 'resume':
      return join(paths.resumeDirectory, basename(file.relativeKey));
    case 'snapshot':
      return join(paths.snapshotDirectory, file.relativeKey);
    case 'candidate_profile':
      return paths.candidateProfilePath;
    case 'scoring_config':
      return paths.scoringConfigPath;
    case 'profile_preferences':
      return paths.profilePreferencesPath ?? '';
    default:
      return '';
  }
}

function resolveSafe(
  resumeDirectory: string,
  storagePath: string,
): string | null {
  try {
    return resolveResumeStoragePath(resumeDirectory, storagePath);
  } catch {
    return null;
  }
}
