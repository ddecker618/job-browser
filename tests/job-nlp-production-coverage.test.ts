import { describe, expect, it } from 'vitest';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import { projectRequirementCoverage } from '../src/intelligence/nlp/requirementCoverageProjection.js';
import { adaptResumeSnapshotEvidence } from '../src/intelligence/nlp/snapshotEvidence.js';
describe('P11 production diagnostic requirement coverage', () => {
  it('projects supported facts with modality, provenance, and no production authority', async () => {
    const enrichment = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description:
        "Linux required. 5 years of experience required. Bachelor's degree required. Secret clearance required.",
      requirements: null,
      preferredQualifications: null,
    });
    const evidence = adaptResumeSnapshotEvidence({
      snapshotId: 's1',
      interpretationId: 'i1',
      schemaVersion: 1,
      parserVersion: 'resume-parser-v1',
      normalizationVersion: 'resume-normalization-v1',
      parsingStatus: 'parsed',
      normalizedText:
        '7 years of professional experience bachelor degree active secret clearance',
      skills: [
        { rawLabel: 'Linux', provenance: 'resume-extract:name', skillId: null },
      ],
      certifications: [],
    });
    const coverage = projectRequirementCoverage(enrichment, evidence);
    expect(coverage.rows.map((row) => row.status)).toEqual([
      'DIRECT',
      'DIRECT',
      'DIRECT',
      'DIRECT',
    ]);
    expect(coverage.rows.every((row) => row.modalityWeight === 1)).toBe(true);
    expect(coverage.summary.weightedDiagnosticCoverage).toBe(1);
    expect(coverage.productionEffect).toBe('none');
    expect(coverage).not.toHaveProperty('score');
  });
  it('reports unknown rather than missing when the snapshot parser has no structural value', async () => {
    const enrichment = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: '5 years of experience required.',
      requirements: null,
      preferredQualifications: null,
    });
    const evidence = adaptResumeSnapshotEvidence({
      snapshotId: 's2',
      interpretationId: 'i2',
      schemaVersion: 1,
      parserVersion: 'resume-parser-v1',
      normalizationVersion: 'resume-normalization-v1',
      parsingStatus: 'parsed',
      normalizedText: 'employment history available',
      skills: [],
      certifications: [],
    });
    expect(
      projectRequirementCoverage(enrichment, evidence).rows[0]?.status,
    ).toBe('UNKNOWN');
  });
});
