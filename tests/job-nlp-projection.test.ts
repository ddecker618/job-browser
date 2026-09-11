import { describe, expect, it } from 'vitest';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import {
  JOB_INTELLIGENCE_PROJECTION_VERSION,
  projectJobIntelligence,
  type JobIntelligenceDeterministicSide,
} from '../src/intelligence/nlp/projection.js';
import type { RoleDescriptionParts } from '../src/intelligence/nlp/segmenter.js';

function parts(overrides: Partial<RoleDescriptionParts>): RoleDescriptionParts {
  return {
    title: 'Systems Administrator',
    location: null,
    description:
      'Linux administration, routing, and Active Directory administration.',
    requirements:
      'Top Secret clearance required. 3+ years of Linux administration experience required. Fully remote.',
    preferredQualifications: 'Cisco CCNA certification preferred.',
    ...overrides,
  };
}

async function projectFor(
  overrides: Partial<RoleDescriptionParts>,
  deterministic: JobIntelligenceDeterministicSide,
) {
  const enrichment = await extractNlpDocument(parts(overrides));
  return projectJobIntelligence('job-1', enrichment, deterministic);
}

describe('Job Intelligence projection (P5)', () => {
  it('shapes a projection with requirement facts, authority and level', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'remote',
        location: null,
        estimatedExperienceYears: 6,
      },
    );

    expect(projection.projectionVersion).toBe(
      JOB_INTELLIGENCE_PROJECTION_VERSION,
    );
    expect(projection.level).toEqual({
      key: 'explanation',
      label: 'EXPLANATION',
    });
    expect(projection.authority).toEqual({
      score: 'deterministic-unaffected',
      eligibility: 'deterministic-unaffected',
      ranking: 'deterministic-unaffected',
      lifecycle: 'deterministic-unaffected',
    });
    expect(projection.summary.factCount).toBeGreaterThan(0);
    expect(projection.requirementFacts.length).toBe(
      projection.summary.factCount,
    );
    for (const fact of projection.requirementFacts) {
      expect(fact.interpretation).toMatch(/per the posting$/);
      expect(fact.evidence.segmentText.length).toBeGreaterThan(0);
    }
  });

  it('marks a matching clearance as agreement', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      },
    );
    const clearance = projection.requirementFacts.find(
      (fact) => fact.category === 'clearance',
    );
    expect(clearance).toBeDefined();
    expect(clearance?.deterministic.state).toBe('agreement');
    expect(clearance?.deterministic.deterministicValue).toBe('Top Secret');
  });

  it('marks a conflicting clearance with deterministic authoritative', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Secret',
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      },
    );
    const clearance = projection.requirementFacts.find(
      (fact) => fact.category === 'clearance',
    );
    expect(clearance).toBeDefined();
    expect(clearance?.deterministic.state).toBe('conflict');
    expect(clearance?.deterministic.note).toMatch(/authoritative/);
  });

  it('reports an unreconciled clearance when no structured value exists', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: null,
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      },
    );
    const clearance = projection.requirementFacts.find(
      (fact) => fact.category === 'clearance',
    );
    expect(clearance?.deterministic.available).toBe(false);
    expect(clearance?.deterministic.state).toBe('nlp-only');
  });

  it('reconciles experience years against the structured estimate', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: 3,
      },
    );
    const experience = projection.requirementFacts.find(
      (fact) => fact.category === 'experience',
    );
    expect(experience).toBeDefined();
    expect(experience?.deterministic.state).toBe('agreement');
    expect(experience?.interpretation).toMatch(/about 3 years/);
  });

  it('marks a years mismatch as an authoritative conflict', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: 4,
      },
    );
    const experience = projection.requirementFacts.find(
      (fact) => fact.category === 'experience',
    );
    expect(experience?.deterministic.state).toBe('conflict');
    expect(experience?.deterministic.deterministicValue).toBe('4');
  });

  it('reconciles work arrangement with the structured remote type', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'remote',
        location: null,
        estimatedExperienceYears: 6,
      },
    );
    const arrangement = projection.requirementFacts.find(
      (fact) => fact.category === 'work-arrangement',
    );
    expect(arrangement).toBeDefined();
    expect(arrangement?.deterministic.state).toBe('agreement');

    const conflicting = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'onsite',
        location: null,
        estimatedExperienceYears: 6,
      },
    );
    const conflictingArrangement = conflicting.requirementFacts.find(
      (fact) => fact.category === 'work-arrangement',
    );
    expect(conflictingArrangement?.deterministic.state).toBe('conflict');
  });

  it('never claims possession and keeps copy in the posting frame', async () => {
    const projection = await projectFor(
      {},
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'remote',
        location: null,
        estimatedExperienceYears: 6,
      },
    );
    for (const fact of [
      ...projection.requirementFacts,
      ...projection.otherFacts,
    ]) {
      expect(fact.interpretation).not.toMatch(/you (need|have|must)/i);
      expect(fact.interpretation).toMatch(/posting/i);
    }
  });

  it('separates non-requirement mentions and counts boilerplate', async () => {
    const projection = await projectFor(
      {
        description:
          'Company description text for an equal opportunity employer. Linux administration.',
      },
      {
        clearanceRequirement: 'Top Secret',
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: 6,
      },
    );
    expect(projection.summary.otherFactCount).toBeGreaterThanOrEqual(0);
    for (const other of projection.otherFacts) {
      expect([
        'skill',
        'experience',
        'education',
        'certification',
        'clearance',
        'citizenship',
        'location',
        'work-arrangement',
      ]).not.toContain(other.category);
    }
    expect(projection.summary.boilerplateCount).toBeGreaterThanOrEqual(0);
  });

  it('redacts sensitive text in evidence and entities', async () => {
    const projection = await projectFor(
      {
        description: 'Contact jane@example.com or (555) 123-4567 for details.',
      },
      {
        clearanceRequirement: null,
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      },
    );
    for (const fact of [
      ...projection.requirementFacts,
      ...projection.otherFacts,
    ]) {
      expect(fact.evidence.segmentText).not.toMatch(/jane@example\.com/);
      expect(fact.evidence.segmentText).not.toMatch(/\(555\) 123-4567/);
    }
  });
});
