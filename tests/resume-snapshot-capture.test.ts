import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  RESUME_SNAPSHOT_PARSER_VERSION,
  ResumeSnapshotCaptureError,
  SNAPSHOT_QUARANTINE_DIRECTORY,
} from '../src/domain/resume-snapshot.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';
import { captureResumeSnapshot } from '../src/resumes/resumeSnapshotCapture.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { createTestDatabase } from './helpers/test-database.js';

const BASE = tmpdir();

describe('ResumeSnapshotRepository', () => {
  let database: JobDatabase;

  afterEach(() => database.close());

  it('persists and reloads a full snapshot with interpretation and terms', () => {
    database = createTestDatabase();
    const repository = new ResumeSnapshotRepository(database);
    database
      .prepare(
        `INSERT INTO skills (id, name, normalized_name) VALUES (?, ?, ?)`,
      )
      .run('skill-siem', 'SIEM', 'siem');
    database
      .prepare(
        `INSERT INTO certifications (id, name, normalized_name) VALUES (?, ?, ?)`,
      )
      .run('cert-security-plus', 'Security+', 'security+');
    const input = {
      ...snapshotInsertInput({
        id: 'snapshot-persist',
        contentHash: 'a'.repeat(64),
        storageKey: 'storage-key-persist',
        parsingStatus: 'parsed',
      }),
      skills: [
        {
          rawLabel: 'siem',
          provenance: 'resume-extract:name',
          skillId: 'skill-siem',
        },
      ],
      certifications: [
        {
          rawLabel: 'security+',
          provenance: 'resume-extract:alias',
          certificationId: 'cert-security-plus',
        },
      ],
    };

    repository.insertSnapshot(input);

    const detail = repository.findById('snapshot-persist');
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      id: 'snapshot-persist',
      sourceResumeId: 'resume-persist',
      liveResumeId: null,
      contentHash: 'a'.repeat(64),
      storageKey: 'storage-key-persist',
      originalFilename: 'resume.txt',
      mimeType: 'text/plain',
      extension: '.txt',
      sizeBytes: 7,
      parserVersion: RESUME_SNAPSHOT_PARSER_VERSION,
      parsingStatus: 'parsed',
      parsingError: null,
    });
    expect(detail?.interpretation.skills).toEqual([
      {
        rawLabel: 'siem',
        provenance: 'resume-extract:name',
        skillId: 'skill-siem',
      },
    ]);
    expect(detail?.interpretation.certifications).toEqual([
      {
        rawLabel: 'security+',
        provenance: 'resume-extract:alias',
        certificationId: 'cert-security-plus',
      },
    ]);
    expect(detail?.interpretation.parsingStatus).toBe('parsed');
  });

  it('finds a reusable snapshot by complete capture identity', () => {
    database = createTestDatabase();
    const repository = new ResumeSnapshotRepository(database);
    repository.insertSnapshot(
      snapshotInsertInput({
        id: 'snapshot-reuse',
        reuseKey: 'reuse-identity',
      }),
    );

    const reusable = repository.findReusable('reuse-identity');
    expect(reusable?.id).toBe('snapshot-reuse');
    expect(repository.findReusable('other-identity')).toBeNull();
  });

  it('lists snapshot storage keys and artifact verification rows', () => {
    database = createTestDatabase();
    const repository = new ResumeSnapshotRepository(database);
    repository.insertSnapshot(
      snapshotInsertInput({
        id: 'snapshot-list-a',
        storageKey: 'key-a',
        interpretationId: 'interpretation-a',
      }),
    );
    repository.insertSnapshot(
      snapshotInsertInput({
        id: 'snapshot-list-b',
        storageKey: 'key-b',
        interpretationId: 'interpretation-b',
      }),
    );

    expect(repository.listStorageKeys().sort()).toEqual(['key-a', 'key-b']);
    const artifacts = repository.listArtifacts();
    expect(artifacts.map((artifact) => artifact.storageKey).sort()).toEqual([
      'key-a',
      'key-b',
    ]);
    expect(artifacts[0]?.sizeBytes).toBe(7);
  });
});

describe('ResumeSnapshot capture', () => {
  let database: JobDatabase;
  const roots: string[] = [];
  let resumeRoot: string;
  let snapshotRoot: string;

  function base(): void {
    database = createTestDatabase();
    const root = mkdtempSync(join(BASE, 'jb-capture-'));
    roots.push(root);
    resumeRoot = join(root, 'resumes');
    snapshotRoot = join(root, 'snapshots');
    mkdirSync(resumeRoot, { recursive: true });
    mkdirSync(snapshotRoot, { recursive: true });
  }

  function insertResume(overrides: {
    id: string;
    filename?: string;
    resumePath?: string;
    sizeBytes?: number;
    mimeType?: string;
  }): void {
    const filename = overrides.filename ?? 'resume.txt';
    const resumePath =
      overrides.resumePath ?? join(resumeRoot, `${overrides.id}.txt`);
    const sizeBytes =
      overrides.sizeBytes ??
      (existsSync(resumePath) ? statSize(resumePath) : 0);
    database
      .prepare(
        `INSERT INTO resumes (
          id, display_name, original_filename, storage_path, mime_type, size_bytes,
          is_default, parsing_status, extracted_skills_json,
          extracted_certifications_json, parsing_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'parsed', '[]', '[]', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(
        overrides.id,
        filename,
        filename,
        resumePath,
        overrides.mimeType ?? 'text/plain',
        sizeBytes,
      );
  }

  afterEach(() => {
    database.close();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('captures exact bytes into the managed snapshot root without touching the database', async () => {
    base();
    const resumePath = join(resumeRoot, 'r1.txt');
    writeFileSync(resumePath, 'Security Analyst with SIEM experience');
    insertResume({ id: 'resume-1', resumePath });
    database
      .prepare(
        `INSERT INTO skills (id, name, normalized_name) VALUES (?, ?, ?)`,
      )
      .run('skill-siem', 'SIEM', 'siem');

    const prepared = await captureResumeSnapshot({
      database,
      resumeId: 'resume-1',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });

    expect(prepared.insertInput).not.toBeNull();
    expect(prepared.snapshot.storageKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(prepared.insertInput?.skills).toEqual([
      {
        rawLabel: 'siem',
        provenance: 'resume-extract:name',
        skillId: 'skill-siem',
      },
    ]);
    const artifactPath = join(snapshotRoot, prepared.snapshot.storageKey);
    expect(existsSync(artifactPath)).toBe(true);
    expect(readBytes(artifactPath)).toBe(
      'Security Analyst with SIEM experience',
    );
    const snapshotCount = database
      .prepare('SELECT COUNT(*) AS value FROM resume_snapshots')
      .get() as { value: number };
    expect(snapshotCount.value).toBe(0);

    database.transaction(() => {
      new ResumeSnapshotRepository(database).insertSnapshot(
        prepared.insertInput!,
      );
    })();
    const persisted = new ResumeSnapshotRepository(database).findById(
      prepared.snapshot.id,
    );
    expect(persisted?.storageKey).toBe(prepared.snapshot.storageKey);
    expect(persisted?.interpretation.skills[0]?.skillId).toBe('skill-siem');
  });

  it('records a failed parse as a valid failed snapshot with empty terms', async () => {
    base();
    const resumePath = join(resumeRoot, 'bin.bin');
    writeFileSync(resumePath, 'not a supported document');
    insertResume({
      id: 'resume-bin',
      resumePath,
      filename: 'notes.bin',
      mimeType: 'application/octet-stream',
    });

    const prepared = await captureResumeSnapshot({
      database,
      resumeId: 'resume-bin',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });

    expect(prepared.snapshot.parsingStatus).toBe('failed');
    expect(prepared.snapshot.parsingError).toContain(
      'Unsupported resume format',
    );
    expect(prepared.insertInput?.parsingStatus).toBe('failed');
    expect(prepared.insertInput?.skills).toEqual([]);
    database.transaction(() => {
      new ResumeSnapshotRepository(database).insertSnapshot(
        prepared.insertInput!,
      );
    })();
    const persisted = new ResumeSnapshotRepository(database).findById(
      prepared.snapshot.id,
    );
    expect(persisted?.parsingStatus).toBe('failed');
  });

  it('reuses an identical snapshot and publishes nothing new', async () => {
    base();
    const resumePath = join(resumeRoot, 'reuse.txt');
    writeFileSync(resumePath, 'Stable resume content for reuse');
    insertResume({ id: 'resume-reuse', resumePath });
    const options = {
      database,
      resumeId: 'resume-reuse',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    };

    const first = await captureResumeSnapshot(options);
    expect(first.insertInput).not.toBeNull();
    database.transaction(() => {
      new ResumeSnapshotRepository(database).insertSnapshot(first.insertInput!);
    })();
    const second = await captureResumeSnapshot(options);

    expect(second.reused).toBe(true);
    expect(second.insertInput).toBeNull();
    expect(second.snapshot.id).toBe(first.snapshot.id);
    const rootFiles = readdirSync(snapshotRoot, { withFileTypes: true }).filter(
      (entry) => entry.isFile(),
    );
    expect(rootFiles.length).toBe(1);
  });

  it('fails when the Resume row is missing', async () => {
    base();
    const error = await captureError({
      database,
      resumeId: 'missing-resume',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });
    expect(error?.code).toBe('snapshot_resume_not_found');
    expect(error?.status).toBe(404);
  });

  it('fails when the recorded Resume size no longer matches its source bytes', async () => {
    base();
    const resumePath = join(resumeRoot, 'drifted.txt');
    writeFileSync(resumePath, 'stale recorded size');
    insertResume({ id: 'resume-drifted', resumePath, sizeBytes: 999 });

    const error = await captureError({
      database,
      resumeId: 'resume-drifted',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });
    expect(error?.code).toBe('snapshot_resume_integrity_failed');
  });

  it('cleanup quarantines the published artifact when the caller aborts', async () => {
    base();
    const resumePath = join(resumeRoot, 'abort.txt');
    writeFileSync(resumePath, 'Rollback snapshot bytes');
    insertResume({ id: 'resume-abort', resumePath });

    const prepared = await captureResumeSnapshot({
      database,
      resumeId: 'resume-abort',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });

    const key = prepared.snapshot.storageKey;
    expect(existsSync(join(snapshotRoot, key))).toBe(true);
    prepared.cleanup();
    expect(existsSync(join(snapshotRoot, key))).toBe(false);
    const quarantine = join(snapshotRoot, SNAPSHOT_QUARANTINE_DIRECTORY);
    expect(readdirSync(quarantine).some((name) => name.endsWith(key))).toBe(
      true,
    );
  });
});

function snapshotInsertInput(
  overrides: Partial<
    Parameters<ResumeSnapshotRepository['insertSnapshot']>[0]
  > = {},
) {
  return {
    id: 'snapshot-default',
    sourceResumeId: 'resume-persist',
    liveResumeId: null,
    contentHash: 'a'.repeat(64),
    storageKey: 'storage-key-default',
    originalFilename: 'resume.txt',
    mimeType: 'text/plain',
    extension: '.txt',
    sizeBytes: 7,
    parserVersion: RESUME_SNAPSHOT_PARSER_VERSION,
    normalizationVersion: 'resume-normalization-v1',
    parsingStatus: 'parsed' as const,
    parsingError: null,
    reuseKey: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    interpretationId: 'interpretation-default',
    interpretationSchemaVersion: 1,
    normalizedPayloadJson: JSON.stringify({
      schemaVersion: 1,
      normalizedText: 'text',
    }),
    skills: [],
    certifications: [],
    ...overrides,
  };
}

function profile() {
  return candidateProfileSchema.parse({
    id: 'profile-test',
    name: 'Test Candidate',
    preferredLocations: [{ city: 'Example City', state: 'EX' }],
    searchRadiusMiles: 25,
    secondarySearchRadiusMiles: 50,
    remotePreference: 'preferred',
    desiredSalary: { minimum: 60_000, target: 75_000, currency: 'USD' },
    certifications: [],
    degrees: [],
    skills: ['AWS'],
    clearanceEligibility: 'unknown',
    yearsOfExperience: 4,
    desiredJobTitles: ['Security Analyst'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
    degreeRequired: false,
    degreeInProgressOk: true,
  });
}

function config() {
  return scoringConfigSchema.parse({
    weights: {
      title: 10,
      skills: 30,
      certifications: 20,
      location: 10,
      remotePreference: 10,
      salary: 5,
      experience: 5,
      employmentType: 5,
      recency: 5,
    },
    recommendationThresholds: {
      applyImmediately: 85,
      strongMatch: 70,
      possibleMatch: 50,
    },
    recency: { freshDays: 7, recentDays: 14 },
    skills: [{ name: 'SIEM', aliases: ['siem'] }],
    certifications: [{ name: 'Security+', aliases: ['security+'] }],
  });
}

async function captureError(
  options: Parameters<typeof captureResumeSnapshot>[0],
): Promise<ResumeSnapshotCaptureError | null> {
  try {
    await captureResumeSnapshot(options);
    return null;
  } catch (error) {
    if (error instanceof ResumeSnapshotCaptureError) return error;
    throw error;
  }
}

function readBytes(path: string): string {
  return readFileSync(path, 'utf8');
}

function statSize(path: string): number {
  return statSync(path).size;
}
