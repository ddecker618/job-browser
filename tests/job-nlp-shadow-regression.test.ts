import { describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import { buildRequirementCoverage } from '../src/intelligence/nlp/requirementCoverage.js';
import { evaluateSyntheticNlpCorpus } from '../src/intelligence/nlp/evaluation.js';
import { matchResumeEvidence } from '../src/intelligence/nlp/resumeEvidence.js';
import { classifySegment } from '../src/intelligence/nlp/categorizer.js';
import { segmentRoleDescription } from '../src/intelligence/nlp/segmenter.js';
import { classifyStrength } from '../src/intelligence/nlp/strength.js';
import { extractSkills } from '../src/intelligence/nlp/skills.js';
import { skillConcepts } from '../src/intelligence/nlp/skillNormalization.js';
import { createJobFixture } from './helpers/job-fixture.js';

describe('NLP shadow regression (Stage 28)', () => {
  it('leaves the deterministic production recommendation unchanged', () => {
    const job = createJobFixture({
      title: 'Cloud Security Analyst',
      description: 'Monitor Splunk SIEM alerts with Python on AWS.',
      requirements: 'Security+ certification required.',
      preferredQualifications: 'Kubernetes experience preferred.',
    });
    const profile = loadCandidateProfile();
    const config = loadScoringConfig();
    const analyzedAt = '2026-09-10T00:00:00.000Z';
    const before = scoreJob(job, profile, config, analyzedAt);
    const jobBeforeShadow = JSON.stringify(job);

    const segments = segmentRoleDescription({
      title: job.title,
      location: job.location,
      description: job.description,
      requirements: job.requirements,
      preferredQualifications: job.preferredQualifications,
    });
    const classifications = segments.map((segment) => {
      const classification = classifySegment(segment);
      classifyStrength(segment, classification.categories);
      extractSkills(segment);
      return classification;
    });
    expect(classifications.length).toBeGreaterThan(0);
    expect(evaluateSyntheticNlpCorpus().caseCount).toBe(54);

    const concepts = skillConcepts();
    const python =
      concepts.find((concept) => concept.label === 'Python') ?? null;
    const evidence = matchResumeEvidence({
      requirements: [
        {
          requirementId: 'shadow-regression-python',
          phrase: 'Python',
          kind: 'skill',
          targetConcept: python,
        },
      ],
      evidence: [
        {
          evidenceId: 'shadow-regression-evidence',
          kind: 'skill',
          rawLabel: 'Python',
          provenance: 'test:snapshot',
          parserVersion: 'test-parser-v1',
          normalizationVersion: 'test-normalization-v1',
        },
      ],
    });
    const coverage = buildRequirementCoverage(
      evidence.map((result) => ({
        requirementId: result.requirementId,
        phrase: result.phrase,
        category: 'skill',
        strength: 'required',
        evidence: result,
      })),
    );

    const after = scoreJob(job, profile, config, analyzedAt);

    expect(coverage.productionEffect).toBe('none');
    expect(after).toEqual(before);
    expect(JSON.stringify(job)).toBe(jobBeforeShadow);
  });
});
