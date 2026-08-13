import type { ResumeSnapshotParsingStatus } from '../domain/resume-snapshot.js';

export interface ResumeSnapshotSkill {
  rawLabel: string;
  provenance: string;
  skillId: string | null;
}

export interface ResumeSnapshotCertification {
  rawLabel: string;
  provenance: string;
  certificationId: string | null;
}

export interface ResumeSnapshotInterpretation {
  id: string;
  snapshotId: string;
  schemaVersion: number;
  parserVersion: string;
  normalizationVersion: string;
  parsingStatus: ResumeSnapshotParsingStatus;
  parsingError: string | null;
  skills: ResumeSnapshotSkill[];
  certifications: ResumeSnapshotCertification[];
  createdAt: string;
}

export interface ResumeSnapshot {
  id: string;
  sourceResumeId: string | null;
  liveResumeId: string | null;
  contentHash: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  parserVersion: string;
  normalizationVersion: string;
  parsingStatus: ResumeSnapshotParsingStatus;
  parsingError: string | null;
  reuseKey: string | null;
  createdAt: string;
}

export interface ResumeSnapshotDetail extends ResumeSnapshot {
  interpretation: ResumeSnapshotInterpretation;
}

export interface ResumeSnapshotReuseIdentity {
  sourceResumeId: string | null;
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  parserVersion: string;
  normalizationVersion: string;
  parsingStatus: ResumeSnapshotParsingStatus;
  parsingError: string | null;
}

export function snapshotReuseKey(identity: ResumeSnapshotReuseIdentity): string {
  return [
    identity.sourceResumeId ?? 'no-source',
    identity.contentHash,
    identity.originalFilename,
    identity.mimeType,
    identity.extension,
    identity.sizeBytes,
    identity.parserVersion,
    identity.normalizationVersion,
    identity.parsingStatus,
  ].join('|');
}

export interface ResumeSnapshotInsertInput {
  id: string;
  sourceResumeId: string | null;
  liveResumeId: string | null;
  contentHash: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  parserVersion: string;
  normalizationVersion: string;
  parsingStatus: ResumeSnapshotParsingStatus;
  parsingError: string | null;
  reuseKey: string | null;
  createdAt: string;
  interpretationId: string;
  interpretationSchemaVersion: number;
  normalizedPayloadJson: string;
  skills: {
    rawLabel: string;
    provenance: string;
    skillId: string | null;
  }[];
  certifications: {
    rawLabel: string;
    provenance: string;
    certificationId: string | null;
  }[];
}