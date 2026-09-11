import { describe, expect, it } from 'vitest';

import {
  NLP_ACCEPTANCE_THRESHOLDS,
  NLP_ACCEPTANCE_VERSION,
  evaluateNlpAcceptanceGate,
  type NlpAcceptanceEvidence,
} from '../src/intelligence/nlp/acceptance.js';
import { evaluateSyntheticNlpCorpus } from '../src/intelligence/nlp/evaluation.js';

const verifiedEvidence: NlpAcceptanceEvidence = {
  productionFieldsUnchanged: true,
  persistenceVersioningWorks: true,
  staleReprocessingWorks: true,
  evidenceRetained: true,
  conflictsVisible: true,
  inspectorWorks: true,
};

describe('NLP shadow-mode acceptance gate (Stage 18)', () => {
  it('passes the observed evaluation only with all safety evidence present', () => {
    const result = evaluateNlpAcceptanceGate(
      evaluateSyntheticNlpCorpus(),
      verifiedEvidence,
    );

    expect(result).toMatchObject({
      acceptanceVersion: NLP_ACCEPTANCE_VERSION,
      passed: true,
      caseCount: 66,
      failures: [],
      thresholds: NLP_ACCEPTANCE_THRESHOLDS,
      evidence: verifiedEvidence,
    });
  });

  it('fails closed when any production-safety evidence is absent', () => {
    const evidence = {
      ...verifiedEvidence,
      productionFieldsUnchanged: false,
      conflictsVisible: false,
    };

    const result = evaluateNlpAcceptanceGate(
      evaluateSyntheticNlpCorpus(),
      evidence,
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      'missing safety evidence: productionFieldsUnchanged',
    );
    expect(result.failures).toContain(
      'missing safety evidence: conflictsVisible',
    );
  });

  it('reports quality threshold failures without exposing production operations', () => {
    const result = evaluateNlpAcceptanceGate(
      evaluateSyntheticNlpCorpus(),
      verifiedEvidence,
      { ...NLP_ACCEPTANCE_THRESHOLDS, minimumCategoryPrecision: 1 },
    );

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('category precision');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('eligibility');
    expect(result).not.toHaveProperty('archive');
  });
});
