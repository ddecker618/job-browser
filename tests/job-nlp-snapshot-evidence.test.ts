import { describe, expect, it } from 'vitest';
import {
  matchResumeEvidence,
  type ResumeEvidenceRequirement,
} from '../src/intelligence/nlp/resumeEvidence.js';
import { adaptResumeSnapshotEvidence } from '../src/intelligence/nlp/snapshotEvidence.js';
import type { ResumeSnapshotEvidenceSource } from '../src/models/resume-snapshot.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';
import { createTestDatabase } from './helpers/test-database.js';

const source: ResumeSnapshotEvidenceSource = {
  snapshotId: 'snapshot-1',
  interpretationId: 'interpretation-1',
  schemaVersion: 1,
  parserVersion: 'resume-parser-v1',
  normalizationVersion: 'resume-normalization-v1',
  parsingStatus: 'parsed',
  normalizedText:
    '7 years of professional experience bachelor degree active secret clearance',
  skills: [
    { rawLabel: 'k8s', provenance: 'resume-extract:alias', skillId: null },
  ],
  certifications: [],
};
function requirement(
  requirementId: string,
  kind: ResumeEvidenceRequirement['kind'],
  extra: Partial<ResumeEvidenceRequirement>,
): ResumeEvidenceRequirement {
  return {
    requirementId,
    kind,
    phrase: requirementId,
    targetConcept: null,
    ...extra,
  };
}
describe('P10 resume snapshot evidence adapters', () => {
  it('matches explicitly parsed experience, education, and clearance without claiming possession', () => {
    const evidence = adaptResumeSnapshotEvidence(source);
    const results = matchResumeEvidence({
      requirements: [
        requirement('experience', 'experience', { minimumYears: 5 }),
        requirement('education', 'education', { targetValue: 'bachelor' }),
        requirement('clearance', 'clearance', { targetValue: 'secret' }),
      ],
      evidence,
    });
    expect(results.map((r) => r.status)).toEqual([
      'DIRECT_MATCH',
      'DIRECT_MATCH',
      'DIRECT_MATCH',
    ]);
    expect(results).toMatchObject([
      { assertsPossession: false, productionEffect: 'none' },
      { assertsPossession: false, productionEffect: 'none' },
      { assertsPossession: false, productionEffect: 'none' },
    ]);
    expect(
      results
        .flatMap((r) => r.evidence)
        .filter((e) => e.relationship === 'EXACT')
        .every((e) => e.parserVersion === 'resume-parser-v1'),
    ).toBe(true);
  });
  it('returns UNKNOWN when snapshot parsing or a requirement concept is unavailable', () => {
    const evidence = adaptResumeSnapshotEvidence({
      ...source,
      parsingStatus: 'failed',
      normalizedText: null,
    });
    const results = matchResumeEvidence({
      requirements: [
        requirement('experience', 'experience', { minimumYears: 5 }),
        requirement('education', 'education', { targetValue: null }),
        requirement('clearance', 'clearance', { targetValue: 'secret' }),
      ],
      evidence,
    });
    expect(results.map((r) => r.status)).toEqual([
      'UNKNOWN',
      'UNKNOWN',
      'UNKNOWN',
    ]);
  });
  it('reads normalized payload only through the internal evidence method', () => {
    const database = createTestDatabase();
    const repository = new ResumeSnapshotRepository(database);
    repository.insertSnapshot({
      id: 'snapshot-db',
      sourceResumeId: null,
      liveResumeId: null,
      contentHash: 'hash',
      storageKey: 'key',
      originalFilename: 'resume.txt',
      mimeType: 'text/plain',
      extension: '.txt',
      sizeBytes: 4,
      parserVersion: 'resume-parser-v1',
      normalizationVersion: 'resume-normalization-v1',
      parsingStatus: 'parsed',
      parsingError: null,
      reuseKey: null,
      createdAt: '2026-09-11T00:00:00.000Z',
      interpretationId: 'interpretation-db',
      interpretationSchemaVersion: 1,
      normalizedPayloadJson: JSON.stringify({
        schemaVersion: 1,
        normalizedText: '5 years of experience',
      }),
      skills: [],
      certifications: [],
    });
    const internal = repository.findEvidenceSource('snapshot-db');
    expect(internal?.normalizedText).toBe('5 years of experience');
    expect(repository.findById('snapshot-db')).not.toHaveProperty(
      'normalizedText',
    );
    database.close();
  });
});
