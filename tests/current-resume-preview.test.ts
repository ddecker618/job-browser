import { describe, expect, it } from 'vitest';

import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { adaptCurrentResumeEvidence } from '../src/intelligence/nlp/currentResumePreview.js';
import { buildRequirementCoverage } from '../src/intelligence/nlp/requirementCoverage.js';
import {
  matchResumeEvidence,
  type ResumeEvidenceRequirement,
} from '../src/intelligence/nlp/resumeEvidence.js';
import { skillConcepts } from '../src/intelligence/nlp/skillNormalization.js';
import type { ResumeEvidenceExtraction } from '../src/resumes/resumeService.js';

const scoring = scoringConfigSchema.parse({
  weights: {
    title: 25,
    skills: 25,
    certifications: 15,
    location: 10,
    remotePreference: 5,
    salary: 5,
    experience: 5,
    employmentType: 5,
    recency: 5,
  },
  recommendationThresholds: {
    applyImmediately: 80,
    strongMatch: 60,
    possibleMatch: 40,
  },
  recency: { freshDays: 7, recentDays: 30 },
  skills: [
    { name: 'Linux', aliases: ['linux'] },
    { name: 'Splunk', aliases: ['splunk'] },
    { name: 'SIEM', aliases: ['siem'] },
    { name: 'AWS', aliases: ['aws'] },
  ],
  certifications: [{ name: 'CISSP', aliases: ['cissp'] }],
});

describe('P38 current resume evidence adapter', () => {
  it('reuses reviewed direct, related, missing, and unknown coverage rules', () => {
    const extraction: ResumeEvidenceExtraction = {
      parsingStatus: 'parsed',
      skillTerms: [
        { label: 'Linux', rawLabel: 'linux', matchedBy: 'name' },
        { label: 'SIEM', rawLabel: 'siem', matchedBy: 'name' },
      ],
      certificationTerms: [
        { label: 'CISSP', rawLabel: 'cissp', matchedBy: 'name' },
      ],
    };
    const evidence = adaptCurrentResumeEvidence(
      'resume-1',
      extraction,
      'resume-parser-v1',
      'resume-normalization-v1',
    );
    const concepts = skillConcepts(scoring.skills);
    const concept = (label: string) =>
      concepts.find((item) => item.label === label) ?? null;
    const certificationConcepts = skillConcepts(scoring.certifications);
    const requirements: ResumeEvidenceRequirement[] = [
      {
        requirementId: 'direct',
        phrase: 'Linux',
        kind: 'skill',
        targetConcept: concept('Linux'),
      },
      {
        requirementId: 'related',
        phrase: 'Splunk',
        kind: 'skill',
        targetConcept: concept('Splunk'),
      },
      {
        requirementId: 'missing',
        phrase: 'AWS',
        kind: 'skill',
        targetConcept: concept('AWS'),
      },
      {
        requirementId: 'unknown',
        phrase: 'Uncatalogued skill',
        kind: 'skill',
        targetConcept: null,
      },
    ];
    const matches = matchResumeEvidence({
      requirements,
      evidence,
      catalog: scoring.skills,
    });
    const certificationMatch = matchResumeEvidence({
      requirements: [
        {
          requirementId: 'certification',
          phrase: 'CISSP',
          kind: 'certification',
          targetConcept:
            certificationConcepts.find((item) => item.label === 'CISSP') ??
            null,
        },
      ],
      evidence,
      catalog: scoring.certifications,
    })[0];
    const coverage = buildRequirementCoverage(
      requirements.map((requirement, index) => ({
        ...requirement,
        category: 'skill',
        strength: 'required',
        evidence: matches[index]!,
      })),
    );

    expect(coverage.rows.map((row) => row.status)).toEqual([
      'DIRECT',
      'STRONG_RELATED',
      'MISSING',
      'UNKNOWN',
    ]);
    expect(certificationMatch?.status).toBe('DIRECT_MATCH');
    expect(coverage.productionEffect).toBe('none');
    expect(
      evidence.every((item) =>
        item.provenance.startsWith('current-resume-preview:'),
      ),
    ).toBe(true);
    expect(
      evidence.every((item) => item.parserVersion === 'resume-parser-v1'),
    ).toBe(true);
  });

  it('does not adapt parser failure into missing evidence', () => {
    const extraction: ResumeEvidenceExtraction = {
      parsingStatus: 'failed',
      skillTerms: [],
      certificationTerms: [],
    };
    expect(
      adaptCurrentResumeEvidence(
        'resume-1',
        extraction,
        'resume-parser-v1',
        'resume-normalization-v1',
      ),
    ).toEqual([]);
  });
});
