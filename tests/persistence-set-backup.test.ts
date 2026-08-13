import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import {
  createPersistenceSetBackup,
  dryRunRestore,
  listBackups,
  loadBackupManifest,
  PersistenceSetBackupError,
  PersistenceSetRestoreError,
  restorePersistenceSet,
  verifyBackupSet,
  type PersistenceSetPaths,
} from '../src/db/persistenceSetBackup.js';
import {
  PersistenceSetCoordinator,
  persistenceSetCoordinator,
} from '../src/db/persistenceSetCoordinator.js';

const RESUME_1 = 'resume-1';
const RESUME_2 = 'resume-2';
const RESUME_1_BODY = 'Hello, I am a candidate.';
const RESUME_2_BODY = 'This resume failed parsing but must be preserved.';
const SNAPSHOT_KEY = 'snapshot-a.pdf';
const SNAPSHOT_BODY = 'Immutable captured resume bytes.';

const directories: string[] = [];
const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function createRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-pset-'));
  directories.push(directory);
  return directory;
}

function createPaths(root: string): PersistenceSetPaths {
  return {
    databasePath: join(root, 'data', 'jobs.sqlite'),
    resumeDirectory: join(root, 'resumes'),
    snapshotDirectory: join(root, 'snapshots'),
    candidateProfilePath: join(root, 'settings', 'candidate-profile.json'),
    scoringConfigPath: join(root, 'settings', 'scoring-config.json'),
    profilePreferencesPath: join(root, 'settings', 'profile-preferences.json'),
    backupDirectory: join(root, 'backups'),
  };
}

function openTrackedDatabase(path: string): JobDatabase {
  const database = openDatabase(path);
  databases.push(database);
  return database;
}

function populateSet(root: string): {
  paths: PersistenceSetPaths;
  database: JobDatabase;
} {
  const paths = createPaths(root);
  mkdirSync(paths.resumeDirectory, { recursive: true });
  mkdirSync(paths.snapshotDirectory, { recursive: true });
  mkdirSync(dirname(paths.candidateProfilePath), { recursive: true });
  mkdirSync(paths.backupDirectory, { recursive: true });

  const database = openTrackedDatabase(paths.databasePath);
  runMigrations(database);

  writeFileSync(
    join(paths.resumeDirectory, `${RESUME_1}.txt`),
    RESUME_1_BODY,
    'utf8',
  );
  writeFileSync(
    join(paths.resumeDirectory, `${RESUME_2}.pdf`),
    RESUME_2_BODY,
    'utf8',
  );
  writeFileSync(
    join(paths.snapshotDirectory, SNAPSHOT_KEY),
    SNAPSHOT_BODY,
    'utf8',
  );
  writeFileSync(
    paths.candidateProfilePath,
    JSON.stringify({ name: 'Dustin' }),
    'utf8',
  );
  writeFileSync(
    paths.scoringConfigPath,
    JSON.stringify({ weights: [1, 2] }),
    'utf8',
  );
  writeFileSync(
    paths.profilePreferencesPath!,
    JSON.stringify({ theme: 'dark' }),
    'utf8',
  );

  database
    .prepare(
      `INSERT INTO resumes
         (id, display_name, original_filename, storage_path, mime_type,
          size_bytes, is_default, parsing_status, extracted_skills_json,
          extracted_certifications_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      RESUME_1,
      'Dustin.txt',
      'Dustin.txt',
      join(paths.resumeDirectory, `${RESUME_1}.txt`),
      'text/plain',
      RESUME_1_BODY.length,
      1,
      'parsed',
      '[]',
      '[]',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  database
    .prepare(
      `INSERT INTO resumes
         (id, display_name, original_filename, storage_path, mime_type,
          size_bytes, is_default, parsing_status, extracted_skills_json,
          extracted_certifications_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      RESUME_2,
      'Scan.pdf',
      'Scan.pdf',
      join(paths.resumeDirectory, `${RESUME_2}.pdf`),
      'application/pdf',
      RESUME_2_BODY.length,
      0,
      'failed',
      '[]',
      '[]',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  database
    .prepare(
      `INSERT INTO resume_snapshots
         (id, source_resume_id, live_resume_id, content_hash, storage_key,
          original_filename, mime_type, extension, size_bytes, parser_version,
          normalization_version, parsing_status, parsing_error, reuse_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'snap-1',
      RESUME_1,
      RESUME_1,
      sha256(SNAPSHOT_BODY),
      SNAPSHOT_KEY,
      'captured.pdf',
      'application/pdf',
      'pdf',
      SNAPSHOT_BODY.length,
      'test-parser',
      'test-normalization',
      'parsed',
      null,
      null,
      '2026-01-01T00:00:00.000Z',
    );

  return { paths, database };
}

function currentSchemaVersion(database: JobDatabase): number {
  const row = database
    .prepare<
      [],
      { version: number } | undefined
    >('SELECT MAX(version) AS version FROM schema_migrations')
    .get();
  return row?.version ?? 0;
}

describe('persistence set backup and restore', () => {
  it('round-trips an empty persistence set', async () => {
    const root = createRoot();
    const paths = createPaths(root);
    const database = openTrackedDatabase(paths.databasePath);
    runMigrations(database);
    const sourceVersion = currentSchemaVersion(database);

    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    expect(result.fileCount).toBe(1);
    const manifest = verifyBackupSet(backupSetDir);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]!.role).toBe('database');
    expect(manifest.files[0]!.relativeKey).toBe('database.sqlite');

    const targetPaths = createPaths(createRoot());
    const restored = restorePersistenceSet(backupSetDir, targetPaths);
    expect(restored.databaseRestored).toBe(true);
    expect(restored.manifestVerified).toBe(true);
    expect(restored.resumePathsRewritten).toBe(false);

    const restoredDb = openTrackedDatabase(targetPaths.databasePath);
    expect(currentSchemaVersion(restoredDb)).toBe(sourceVersion);
  });

  it('round-trips a fully populated set and rewrites resume paths into a new root', async () => {
    const { paths, database } = populateSet(createRoot());

    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    expect(result.fileCount).toBe(7);
    const manifest = verifyBackupSet(backupSetDir);
    expect(manifest.files.map((file) => file.role)).toEqual(
      expect.arrayContaining([
        'database',
        'resume',
        'resume',
        'snapshot',
        'candidate_profile',
        'scoring_config',
        'profile_preferences',
      ]),
    );
    expect(
      manifest.files.map(({ role, ownerId }) => ({ role, ownerId })),
    ).toEqual([
      { role: 'database', ownerId: null },
      { role: 'resume', ownerId: RESUME_1 },
      { role: 'resume', ownerId: RESUME_2 },
      { role: 'snapshot', ownerId: 'snap-1' },
      { role: 'candidate_profile', ownerId: null },
      { role: 'scoring_config', ownerId: null },
      { role: 'profile_preferences', ownerId: null },
    ]);
    for (const file of manifest.files) {
      expect(file.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(file.sizeBytes).toBeGreaterThan(0);
    }

    const resumesInSource = database
      .prepare<[], { id: string }>('SELECT id FROM resumes')
      .all();
    expect(resumesInSource).toHaveLength(2);

    const targetPaths = createPaths(createRoot());
    const report = dryRunRestore(backupSetDir, targetPaths);
    expect(report.filesPresent).toBe(1);
    expect(report.filesMissing).toBe(6);
    expect(report.missingDetails).toHaveLength(6);

    const restored = restorePersistenceSet(backupSetDir, targetPaths);
    expect(restored.restoredFiles).toBe(6);
    expect(restored.databaseRestored).toBe(true);
    expect(restored.manifestVerified).toBe(true);
    expect(restored.resumePathsRewritten).toBe(true);
    expect(restored.resumePathsRewrittenCount).toBe(2);

    expect(
      readFileSync(
        join(targetPaths.resumeDirectory, `${RESUME_1}.txt`),
        'utf8',
      ),
    ).toBe(RESUME_1_BODY);
    expect(
      readFileSync(
        join(targetPaths.resumeDirectory, `${RESUME_2}.pdf`),
        'utf8',
      ),
    ).toBe(RESUME_2_BODY);
    expect(
      readFileSync(join(targetPaths.snapshotDirectory, SNAPSHOT_KEY), 'utf8'),
    ).toBe(SNAPSHOT_BODY);
    expect(
      JSON.parse(readFileSync(targetPaths.candidateProfilePath, 'utf8')),
    ).toEqual({
      name: 'Dustin',
    });
    expect(
      JSON.parse(readFileSync(targetPaths.scoringConfigPath, 'utf8')),
    ).toEqual({
      weights: [1, 2],
    });
    expect(
      JSON.parse(readFileSync(targetPaths.profilePreferencesPath!, 'utf8')),
    ).toEqual({ theme: 'dark' });

    const restoredDb = openTrackedDatabase(targetPaths.databasePath);
    const rows = restoredDb
      .prepare<
        [],
        { id: string; storage_path: string; parsing_status: string }
      >('SELECT id, storage_path, parsing_status FROM resumes ORDER BY id')
      .all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.storage_path.startsWith(targetPaths.resumeDirectory)).toBe(
        true,
      );
    }
    expect(rows[1]!.parsing_status).toBe('failed');
    const snapshots = restoredDb
      .prepare<[], { id: string }>('SELECT id FROM resume_snapshots')
      .all();
    expect(snapshots).toHaveLength(1);
  });

  it('rejects a backup when a referenced resume file is missing', async () => {
    const { paths, database } = populateSet(createRoot());
    rmSync(join(paths.resumeDirectory, `${RESUME_2}.pdf`));

    await expect(
      createPersistenceSetBackup(database, paths),
    ).rejects.toMatchObject({ code: 'resume-file-missing' });
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
    expect(listBackups(database)).toHaveLength(0);
  });

  it('rejects a backup when a referenced snapshot file is missing', async () => {
    const { paths, database } = populateSet(createRoot());
    rmSync(join(paths.snapshotDirectory, SNAPSHOT_KEY));

    await expect(
      createPersistenceSetBackup(database, paths),
    ).rejects.toMatchObject({ code: 'snapshot-file-missing' });
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
  });

  it('rejects a backup when referenced snapshot bytes are corrupt', async () => {
    const { paths, database } = populateSet(createRoot());
    writeFileSync(
      join(paths.snapshotDirectory, SNAPSHOT_KEY),
      'Mutable replacement bytes.',
      'utf8',
    );

    await expect(
      createPersistenceSetBackup(database, paths),
    ).rejects.toMatchObject({ code: 'snapshot-file-corrupt' });
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
  });

  it('excludes orphaned, temporary, and quarantined files', async () => {
    const { paths, database } = populateSet(createRoot());
    writeFileSync(join(paths.resumeDirectory, 'orphan.txt'), 'orphan', 'utf8');
    writeFileSync(
      join(paths.resumeDirectory, 'upload.tmp'),
      'temporary',
      'utf8',
    );
    mkdirSync(join(paths.snapshotDirectory, 'quarantine'), { recursive: true });
    writeFileSync(
      join(paths.snapshotDirectory, 'quarantine', 'snapshot.bin'),
      'quarantined',
      'utf8',
    );

    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);
    const manifest = verifyBackupSet(backupSetDir);

    expect(manifest.files).toHaveLength(7);
    expect(
      manifest.files.some((file) => file.relativeKey.includes('orphan')),
    ).toBe(false);
    expect(
      manifest.files.some((file) => file.relativeKey.includes('.tmp')),
    ).toBe(false);
    expect(
      manifest.files.some((file) => file.relativeKey.includes('quarantine')),
    ).toBe(false);
  });

  it('preserves the preference state captured at backup time', async () => {
    const { paths, database } = populateSet(createRoot());

    const result = await createPersistenceSetBackup(database, paths);
    writeFileSync(
      paths.profilePreferencesPath!,
      JSON.stringify({ theme: 'light' }),
      'utf8',
    );

    const targetPaths = createPaths(createRoot());
    restorePersistenceSet(dirname(result.manifestPath), targetPaths);
    expect(
      JSON.parse(readFileSync(targetPaths.profilePreferencesPath!, 'utf8')),
    ).toEqual({ theme: 'dark' });
  });

  it('detects a tampered file inside the backup set', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    const tampered = 'X'.repeat(RESUME_1_BODY.length);
    writeFileSync(
      join(backupSetDir, 'resumes', `${RESUME_1}.txt`),
      tampered,
      'utf8',
    );

    expect(() => verifyBackupSet(backupSetDir)).toThrow(
      PersistenceSetRestoreError,
    );
    expect(() => verifyBackupSet(backupSetDir)).toThrow(/hash mismatch/i);
  });

  it('reports a missing backup artifact before restore activates a target', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);
    rmSync(join(backupSetDir, 'snapshots', SNAPSHOT_KEY));

    expect(() => verifyBackupSet(backupSetDir)).toThrow(
      expect.objectContaining({ code: 'file-missing-in-backup' }),
    );
    const targetPaths = createPaths(createRoot());
    expect(() => restorePersistenceSet(backupSetDir, targetPaths)).toThrow(
      expect.objectContaining({ code: 'file-missing-in-backup' }),
    );
    expect(existsSync(targetPaths.databasePath)).toBe(false);
  });

  it('detects a tampered manifest', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as {
      databasePath: string;
    };
    manifest.databasePath = '/tampered/path.sqlite';
    writeFileSync(
      result.manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf8',
    );

    expect(() => verifyBackupSet(backupSetDir)).toThrow(
      /manifest hash mismatch/i,
    );
  });

  it('reports a manifest that is not valid JSON', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    writeFileSync(result.manifestPath, 'not json', 'utf8');

    expect(() => verifyBackupSet(backupSetDir)).toThrow(/not valid JSON/i);
  });

  it('rejects a restore when the backup set fails verification', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    const tampered = 'Y'.repeat(RESUME_1_BODY.length);
    writeFileSync(
      join(backupSetDir, 'resumes', `${RESUME_1}.txt`),
      tampered,
      'utf8',
    );

    const targetPaths = createPaths(createRoot());
    expect(() => restorePersistenceSet(backupSetDir, targetPaths)).toThrow(
      PersistenceSetRestoreError,
    );
    expect(existsSync(targetPaths.databasePath)).toBe(false);
  });

  it('refuses to restore onto the backup set directory itself', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);
    const backupSetDir = dirname(result.manifestPath);

    const targetPaths = {
      ...paths,
      databasePath: join(backupSetDir, 'database.sqlite'),
    };
    expect(() => restorePersistenceSet(backupSetDir, targetPaths)).toThrow(
      PersistenceSetRestoreError,
    );
    expect(() => restorePersistenceSet(backupSetDir, targetPaths)).toThrow(
      /backup set directory/i,
    );
  });

  it('cleans up partial state when a backup operation is interrupted', async () => {
    const { paths, database } = populateSet(createRoot());
    rmSync(paths.candidateProfilePath);
    mkdirSync(paths.candidateProfilePath);

    await expect(createPersistenceSetBackup(database, paths)).rejects.toThrow(
      PersistenceSetBackupError,
    );
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
    expect(listBackups(database)).toHaveLength(0);

    rmSync(paths.candidateProfilePath, { recursive: true });
    writeFileSync(
      paths.candidateProfilePath,
      JSON.stringify({ name: 'Dustin' }),
      'utf8',
    );
    const retry = await createPersistenceSetBackup(database, paths);
    const targetPaths = createPaths(createRoot());
    const restored = restorePersistenceSet(
      dirname(retry.manifestPath),
      targetPaths,
    );
    expect(restored.manifestVerified).toBe(true);
    expect(restored.restoredFiles).toBe(6);
  });

  it('records completed backups in the persistence_set_backups table', async () => {
    const { paths, database } = populateSet(createRoot());
    const result = await createPersistenceSetBackup(database, paths);

    const backups = listBackups(database);
    expect(backups).toHaveLength(1);
    expect(backups[0]!).toMatchObject({
      backupId: result.backupId,
      status: 'complete',
      fileCount: 7,
    });
    const fileRows = database
      .prepare<
        [string],
        { role: string; count: number }
      >('SELECT role, COUNT(*) AS count FROM persistence_set_files WHERE backup_id = ? GROUP BY role')
      .all(result.backupId);
    expect(fileRows.map((row) => row.role)).toEqual(
      expect.arrayContaining([
        'database',
        'resume',
        'snapshot',
        'candidate_profile',
        'scoring_config',
        'profile_preferences',
      ]),
    );
  });
});

describe('persistence set coordinator', () => {
  it('allows concurrent reads and blocks a writer until every read completes', async () => {
    const coordinator = new PersistenceSetCoordinator();
    let releaseFirstRead!: () => void;
    const firstRead = coordinator.withRead(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstRead = resolve;
        }),
    );
    const secondRead = coordinator.withRead(() => undefined);
    let writerRan = false;
    const writer = coordinator.withWrite(() => {
      writerRan = true;
    });

    await Promise.resolve();
    expect(writerRan).toBe(false);

    releaseFirstRead();
    await firstRead;
    await secondRead;
    await writer;
    expect(writerRan).toBe(true);
  });

  it('defers a read until an active writer finishes', async () => {
    const coordinator = new PersistenceSetCoordinator();
    let releaseWriter!: () => void;
    const writer = coordinator.withWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve;
        }),
    );
    let readRan = false;
    const deferredRead = coordinator.withRead(() => {
      readRan = true;
    });

    await Promise.resolve();
    expect(readRan).toBe(false);

    releaseWriter();
    await writer;
    await deferredRead;
    expect(readRan).toBe(true);
  });

  it('serializes successive writers in FIFO order', async () => {
    const coordinator = new PersistenceSetCoordinator();
    const order: string[] = [];
    const first = coordinator.withWrite(() => order.push('first'));
    const second = coordinator.withWrite(() => order.push('second'));
    const third = coordinator.withWrite(() => order.push('third'));

    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('admits queued readers after the active writer completes', async () => {
    const coordinator = new PersistenceSetCoordinator();
    let releaseWriter!: () => void;
    const writer = coordinator.withWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve;
        }),
    );
    let readRan = false;
    const deferredRead = coordinator.withRead(() => {
      readRan = true;
    });

    await Promise.resolve();
    expect(readRan).toBe(false);

    releaseWriter();
    await writer;
    await deferredRead;
    expect(readRan).toBe(true);
  });
});

describe('serialized persistence-set writes', () => {
  it('keeps a concurrent resume deletion out of an in-progress backup boundary', async () => {
    const { paths, database } = populateSet(createRoot());
    let releaseHeldRead!: () => void;
    let cleanupNeeded = true;
    const heldRead = persistenceSetCoordinator.withRead(
      () =>
        new Promise<void>((resolve) => {
          releaseHeldRead = resolve;
        }),
    );
    let deleteRan = false;
    const pendingDelete = persistenceSetCoordinator.withWrite(() => {
      deleteRan = true;
      database.prepare('DELETE FROM resumes WHERE id = ?').run(RESUME_1);
      rmSync(join(paths.resumeDirectory, `${RESUME_1}.txt`));
    });

    try {
      await Promise.resolve();
      expect(deleteRan).toBe(false);

      const result = await createPersistenceSetBackup(database, paths);
      await Promise.resolve();
      expect(deleteRan).toBe(false);

      const manifest = loadBackupManifest(dirname(result.manifestPath));
      expect(
        manifest.files.filter((file) => file.role === 'resume'),
      ).toHaveLength(2);

      releaseHeldRead();
      await heldRead;
      await pendingDelete;
      cleanupNeeded = false;
      expect(deleteRan).toBe(true);

      expect(
        database.prepare('SELECT id FROM resumes WHERE id = ?').get(RESUME_1),
      ).toBeUndefined();
      expect(existsSync(join(paths.resumeDirectory, `${RESUME_1}.txt`))).toBe(
        false,
      );

      const targetPaths = createPaths(createRoot());
      restorePersistenceSet(dirname(result.manifestPath), targetPaths);
      expect(
        existsSync(join(targetPaths.resumeDirectory, `${RESUME_1}.txt`)),
      ).toBe(true);
    } finally {
      if (cleanupNeeded) {
        releaseHeldRead();
        await heldRead;
        await pendingDelete;
      }
    }
  });

  it('keeps a concurrent preference write behind an in-progress backup boundary', async () => {
    const { paths, database } = populateSet(createRoot());
    let releaseHeldRead!: () => void;
    let cleanupNeeded = true;
    const heldRead = persistenceSetCoordinator.withRead(
      () =>
        new Promise<void>((resolve) => {
          releaseHeldRead = resolve;
        }),
    );
    let writeRan = false;
    const pendingWrite = persistenceSetCoordinator.withWrite(() => {
      writeRan = true;
      writeFileSync(
        paths.candidateProfilePath,
        JSON.stringify({ name: 'Concurrent' }),
        'utf8',
      );
      writeFileSync(
        paths.profilePreferencesPath!,
        JSON.stringify({ theme: 'light' }),
        'utf8',
      );
    });

    try {
      await Promise.resolve();
      expect(writeRan).toBe(false);

      const result = await createPersistenceSetBackup(database, paths);
      await Promise.resolve();
      expect(writeRan).toBe(false);

      const manifest = loadBackupManifest(dirname(result.manifestPath));
      const profileRecord = manifest.files.find(
        (file) => file.role === 'candidate_profile',
      )!;
      const captured = JSON.parse(
        readFileSync(
          join(
            dirname(result.manifestPath),
            'preferences',
            profileRecord.relativeKey,
          ),
          'utf8',
        ),
      ) as { name: string };
      expect(captured).toEqual({ name: 'Dustin' });

      releaseHeldRead();
      await heldRead;
      await pendingWrite;
      cleanupNeeded = false;
      expect(writeRan).toBe(true);
      expect(
        JSON.parse(readFileSync(paths.candidateProfilePath, 'utf8')),
      ).toEqual({ name: 'Concurrent' });
    } finally {
      if (cleanupNeeded) {
        releaseHeldRead();
        await heldRead;
        await pendingWrite;
      }
    }
  });

  it('backs up a coherent preference boundary during a real concurrent write', async () => {
    const { paths, database } = populateSet(createRoot());

    const backupPromise = createPersistenceSetBackup(database, paths);
    await persistenceSetCoordinator.withWrite(() => {
      writeFileSync(
        paths.candidateProfilePath,
        JSON.stringify({ name: 'Second' }),
        'utf8',
      );
      writeFileSync(
        paths.profilePreferencesPath!,
        JSON.stringify({ theme: 'light' }),
        'utf8',
      );
    });
    const result = await backupPromise;

    const manifest = loadBackupManifest(dirname(result.manifestPath));
    const profileRecord = manifest.files.find(
      (file) => file.role === 'candidate_profile',
    )!;
    const preferencesRecord = manifest.files.find(
      (file) => file.role === 'profile_preferences',
    )!;
    const capturedCandidate = JSON.parse(
      readFileSync(
        join(
          dirname(result.manifestPath),
          'preferences',
          profileRecord.relativeKey,
        ),
        'utf8',
      ),
    ) as { name: string };
    const capturedPreferences = JSON.parse(
      readFileSync(
        join(
          dirname(result.manifestPath),
          'preferences',
          preferencesRecord.relativeKey,
        ),
        'utf8',
      ),
    ) as { theme: string };

    const coherent =
      (capturedCandidate.name === 'Dustin' &&
        capturedPreferences.theme === 'dark') ||
      (capturedCandidate.name === 'Second' &&
        capturedPreferences.theme === 'light');
    expect(coherent).toBe(true);
  });
});
