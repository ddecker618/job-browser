import { describe, expect, it } from 'vitest';

import { skillConcepts } from '../src/intelligence/nlp/skillNormalization.js';
import {
  matchResumeEvidence,
  type ResumeEvidenceRequirement,
} from '../src/intelligence/nlp/resumeEvidence.js';
import {
  REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION,
  buildRequirementCoverage,
  type RequirementCoverageInput,
} from '../src/intelligence/nlp/requirementCoverage.js';

const concepts = skillConcepts();

function concept(label: string) {
  const result = concepts.find((item) => item.label === label);
  if (result === undefined) throw new Error(`Missing concept ${label}`);
  return result;
}

function input(
  requirementId: string,
  phrase: string,
  strength: RequirementCoverageInput['strength'],
  targetLabel: string | null,
  evidenceLabel: string | null,
): RequirementCoverageInput {
  const requirement: ResumeEvidenceRequirement = {
    requirementId,
    phrase,
    kind: 'skill',
    targetConcept: targetLabel === null ? null : concept(targetLabel),
  };
  const evidenceResult = matchResumeEvidence({
    requirements: [requirement],
    evidence:
      evidenceLabel === null
        ? []
        : [
            {
              evidenceId: `${requirementId}-evidence`,
              kind: 'skill',
              rawLabel: evidenceLabel,
              provenance: 'snapshot:skills',
              parserVersion: 'parser-v1',
              normalizationVersion: 'normalization-v1',
            },
          ],
  })[0];
  if (evidenceResult === undefined) throw new Error('Missing evidence result');
  return {
    requirementId,
    phrase,
    category: 'skill',
    strength,
    evidence: evidenceResult,
  };
}

describe('NLP requirement coverage model (Stage 23)', () => {
  it('maps direct, strong, weak, missing, and unknown evidence states', () => {
    const result = buildRequirementCoverage([
      input('req-direct', 'Python', 'required', 'Python', 'Python'),
      input('req-strong', 'SIEM', 'preferred', 'SIEM', 'Splunk'),
      input('req-weak', 'Azure', 'nice-to-have', 'Azure', 'AWS'),
      input('req-missing', 'Python', 'required-after-hire', 'Python', null),
      input('req-unknown', 'Unresolved', 'unknown', null, 'Python'),
    ]);

    expect(result.rows.map((row) => row.status)).toEqual([
      'DIRECT',
      'STRONG_RELATED',
      'WEAK_RELATED',
      'MISSING',
      'UNKNOWN',
    ]);
    expect(result.summary.counts).toEqual({
      DIRECT: 1,
      STRONG_RELATED: 1,
      WEAK_RELATED: 1,
      MISSING: 1,
      UNKNOWN: 1,
    });
  });

  it('weights modality only for a diagnostic coverage ratio', () => {
    const result = buildRequirementCoverage([
      input('req-required', 'Python', 'required', 'Python', 'Python'),
      input('req-preferred', 'SIEM', 'preferred', 'SIEM', 'Splunk'),
      input('req-missing', 'Azure', 'nice-to-have', 'Azure', null),
    ]);

    expect(result.summary.weightedEligibleTotal).toBe(1.75);
    expect(result.summary.weightedDiagnosticEvidence).toBe(1.375);
    expect(result.summary.weightedDiagnosticCoverage).toBeCloseTo(0.7857, 4);
    expect(result.summary.productionEffect).toBe('none');
  });

  it('keeps informational requirements out of weighted diagnostic coverage', () => {
    const result = buildRequirementCoverage([
      input('req-info', 'Python', 'informational', 'Python', null),
    ]);

    expect(result.summary.weightedEligibleTotal).toBe(0);
    expect(result.summary.weightedDiagnosticCoverage).toBe(0);
    expect(result.rows[0]?.productionEffect).toBe('none');
    expect(result).toMatchObject({
      version: REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION,
      method: 'coverage-projection',
    });
  });

  it('rejects duplicate or mismatched requirement identities', () => {
    const first = input('req-duplicate', 'Python', 'required', 'Python', null);
    expect(() => buildRequirementCoverage([first, first])).toThrow(
      'Duplicate requirement coverage id',
    );
    expect(() =>
      buildRequirementCoverage([
        {
          ...first,
          evidence: { ...first.evidence, requirementId: 'different' },
        },
      ]),
    ).toThrow('does not match');
  });

  it('preserves evidence and exposes no scoring or write operation', () => {
    const source = input(
      'req-python',
      'Python',
      'required',
      'Python',
      'Python',
    );
    const before = JSON.stringify(source);
    const result = buildRequirementCoverage([source]);

    expect(result.rows[0]?.evidence[0]?.rawLabel).toBe('Python');
    expect(result.rows[0]).not.toHaveProperty('score');
    expect(result.rows[0]).not.toHaveProperty('save');
    expect(result).not.toHaveProperty('eligibility');
    expect(JSON.stringify(source)).toBe(before);
  });
});
