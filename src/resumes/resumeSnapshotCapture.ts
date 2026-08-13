import { extname } from 'node:path';
import { randomUUID as nodeRandomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import {
  RESUME_SNAPSHOT_NORMALIZATION_VERSION,
  RESUME_SNAPSHOT_PARSER_VERSION,
  RESUME_SNAPSHOT_SCHEMA_VERSION,
  ResumeSnapshotCaptureError,
} from '../domain/resume-snapshot.js';
import type {
  ResumeSnapshot,
  ResumeSnapshotInsertInput,
} from '../models/resume-snapshot.js';
import { snapshotReuseKey } from '../models/resume-snapshot.js';
import { ResumeSnapshotRepository } from '../repositories/resume-snapshot-repository.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { normalizeText } from '../utilities/normalization.js';
import {
  assertRealPathWithin,
  publishSnapshotArtifact,
  quarantineSnapshotArtifact,
  removeStagedArtifact,
  resolveSnapshotStoragePath,
  stageSnapshotArtifact,
} from './snapshotStorage.js';
import {
  extractResumeFromPath,
  resolveResumeStoragePath,
} from './resumeService.js';

export interface CaptureResumeSnapshotOptions {
  database: JobDatabase;
  resumeId: string;
  resumeDirectory: string;
  snapshotRoot: string;
  profile: CandidateProfile;
  config: ScoringConfig;
  now?: () => Date | string;
  randomUUID?: () => string;
}

export interface PreparedResumeSnapshot {
  snapshot: ResumeSnapshot;
  insertInput: ResumeSnapshotInsertInput | null;
  reused: boolean;
  cleanup: () => void;
}

interface ResumeSourceRow {
  id: string;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}

export async function captureResumeSnapshot(
  options: CaptureResumeSnapshotOptions,
): Promise<PreparedResumeSnapshot> {
  const database = options.database;
  const resume = database
    .prepare<
      [string],
      ResumeSourceRow
    >('SELECT id, original_filename, storage_path, mime_type, size_bytes FROM resumes WHERE id = ?')
    .get(options.resumeId);

  if (resume === undefined) {
    throw new ResumeSnapshotCaptureError(
      'The selected Resume was not found',
      'snapshot_resume_not_found',
      {},
      404,
    );
  }

  const resolvedResumePath = resolveResumeStoragePath(
    options.resumeDirectory,
    resume.storage_path,
  );
  assertRealPathWithin(resolvedResumePath, options.resumeDirectory);

  const staged = stageSnapshotArtifact(
    resolvedResumePath,
    options.snapshotRoot,
  );

  if (staged.sizeBytes !== resume.size_bytes) {
    removeStagedArtifact(staged.tempPath);
    throw new ResumeSnapshotCaptureError(
      'The selected Resume file changed since it was recorded and cannot be captured as historical evidence',
      'snapshot_resume_integrity_failed',
    );
  }

  const extraction = await extractResumeFromPath(
    resolvedResumePath,
    resume.original_filename,
    options.profile,
    options.config,
  );

  const parsingStatus: 'parsed' | 'failed' =
    extraction.parsingStatus === 'parsed' ? 'parsed' : 'failed';
  const extension = extname(resume.original_filename).toLowerCase();
  const reuseKey = snapshotReuseKey({
    sourceResumeId: options.resumeId,
    contentHash: staged.contentHash,
    originalFilename: resume.original_filename,
    mimeType: resume.mime_type,
    extension,
    sizeBytes: staged.sizeBytes,
    parserVersion: RESUME_SNAPSHOT_PARSER_VERSION,
    normalizationVersion: RESUME_SNAPSHOT_NORMALIZATION_VERSION,
    parsingStatus,
    parsingError: extraction.parsingError,
  });

  const repository = new ResumeSnapshotRepository(database);
  const existing = repository.findReusable(reuseKey);
  if (existing !== null) {
    removeStagedArtifact(staged.tempPath);
    return {
      snapshot: existing,
      insertInput: null,
      reused: true,
      cleanup: () => undefined,
    };
  }

  const randomUUID = options.randomUUID ?? nodeRandomUUID;
  const createdAt =
    options.now === undefined
      ? new Date().toISOString()
      : new Date(options.now()).toISOString();
  const snapshotId = randomUUID();
  const interpretationId = randomUUID();
  const storageKey = randomUUID();
  publishSnapshotArtifact(staged.tempPath, options.snapshotRoot, storageKey);

  const skills = extraction.skillTerms.map((term) => ({
    rawLabel: term.rawLabel,
    provenance: `resume-extract:${term.matchedBy}`,
    skillId: resolveCatalogId(database, 'skills', term.label),
  }));
  const certifications = extraction.certificationTerms.map((term) => ({
    rawLabel: term.rawLabel,
    provenance: `resume-extract:${term.matchedBy}`,
    certificationId: resolveCatalogId(database, 'certifications', term.label),
  }));

  const insertInput: ResumeSnapshotInsertInput = {
    id: snapshotId,
    sourceResumeId: options.resumeId,
    liveResumeId: options.resumeId,
    contentHash: staged.contentHash,
    storageKey,
    originalFilename: resume.original_filename,
    mimeType: resume.mime_type,
    extension,
    sizeBytes: staged.sizeBytes,
    parserVersion: RESUME_SNAPSHOT_PARSER_VERSION,
    normalizationVersion: RESUME_SNAPSHOT_NORMALIZATION_VERSION,
    parsingStatus,
    parsingError: extraction.parsingError,
    reuseKey,
    createdAt,
    interpretationId,
    interpretationSchemaVersion: RESUME_SNAPSHOT_SCHEMA_VERSION,
    normalizedPayloadJson: JSON.stringify({
      schemaVersion: RESUME_SNAPSHOT_SCHEMA_VERSION,
      normalizedText: extraction.normalizedText,
    }),
    skills,
    certifications,
  };

  return {
    snapshot: {
      id: snapshotId,
      sourceResumeId: insertInput.sourceResumeId,
      liveResumeId: insertInput.liveResumeId,
      contentHash: insertInput.contentHash,
      storageKey,
      originalFilename: insertInput.originalFilename,
      mimeType: insertInput.mimeType,
      extension,
      sizeBytes: insertInput.sizeBytes,
      parserVersion: insertInput.parserVersion,
      normalizationVersion: insertInput.normalizationVersion,
      parsingStatus,
      parsingError: insertInput.parsingError,
      reuseKey,
      createdAt,
    },
    insertInput,
    reused: false,
    cleanup: () => quarantineSnapshotArtifact(options.snapshotRoot, storageKey),
  };
}

export function snapshotStoragePath(
  snapshotRoot: string,
  storageKey: string,
): string {
  return resolveSnapshotStoragePath(snapshotRoot, storageKey);
}

function resolveCatalogId(
  database: JobDatabase,
  table: 'skills' | 'certifications',
  label: string,
): string | null {
  const row = database
    .prepare<
      [string],
      { id: string }
    >(`SELECT id FROM ${table} WHERE normalized_name = ?`)
    .get(normalizeText(label));
  return row?.id ?? null;
}
