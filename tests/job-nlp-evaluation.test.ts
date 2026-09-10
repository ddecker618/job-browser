import { describe, expect, it } from 'vitest';

import {
  NLP_EVALUATION_VERSION,
  REPRESENTATIVE_NLP_CORPUS,
  evaluateSyntheticNlpCase,
  evaluateSyntheticNlpCorpus,
} from '../src/intelligence/nlp/evaluation.js';
import { getSyntheticNlpCase } from '../src/intelligence/nlp/evaluationCorpus.js';

describe('representative NLP evaluation (Stage 17)', () => {
  it('evaluates a 50-plus synthetic representative corpus with bounded metrics', () => {
    const report = evaluateSyntheticNlpCorpus();

    expect(REPRESENTATIVE_NLP_CORPUS.length).toBeGreaterThanOrEqual(50);
    expect(report.evaluationVersion).toBe(NLP_EVALUATION_VERSION);
    expect(report.caseCount).toBe(REPRESENTATIVE_NLP_CORPUS.length);
    expect(report.caseResults).toHaveLength(report.caseCount);
    expect(report.categories.expected).toBeGreaterThan(0);
    expect(report.strengths.total).toBe(report.caseCount);
    expect(report.entities.expected).toBeGreaterThan(0);
    expect(report.critical.cases).toBeGreaterThan(0);

    expect(report.categories.precision).toBeGreaterThanOrEqual(0);
    expect(report.categories.precision).toBeLessThanOrEqual(1);
    expect(report.categories.recall).toBeGreaterThanOrEqual(0);
    expect(report.categories.recall).toBeLessThanOrEqual(1);
    expect(report.strengths.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.strengths.accuracy).toBeLessThanOrEqual(1);
    expect(report.entities.precision).toBeGreaterThanOrEqual(0);
    expect(report.entities.recall).toBeLessThanOrEqual(1);
    expect(report.disagreementRate).toBeGreaterThanOrEqual(0);
    expect(report.disagreementRate).toBeLessThanOrEqual(1);
  });

  it('keeps technical remote terminology out of work arrangement categories', () => {
    const item = getSyntheticNlpCase('adversarial-technical-remote');
    if (item === undefined) throw new Error('critical fixture is missing');

    const result = evaluateSyntheticNlpCase(item);

    expect(result.actualCategories).not.toContain('work-arrangement');
    expect(result.criticalFailures).toEqual([]);
    expect(result.actualArrangement).toBe('unknown');
  });

  it('keeps a clean applicant-clearance adversarial case distinguishable', () => {
    const item = getSyntheticNlpCase('adversarial-cleared-team');
    if (item === undefined) throw new Error('critical fixture is missing');

    const result = evaluateSyntheticNlpCase(item);

    expect(result.actualCategories).not.toContain('clearance');
    expect(result.criticalFailures).not.toContain(
      'forbidden-category:clearance',
    );
  });

  it('keeps employer clearance context out of applicant entities', () => {
    const item = getSyntheticNlpCase('adversarial-secret-company-context');
    if (item === undefined) throw new Error('critical fixture is missing');

    const result = evaluateSyntheticNlpCase(item);

    expect(result.actualEntities).not.toContainEqual({
      type: 'clearance-level',
      value: 'secret',
    });
    expect(result.criticalFailures).not.toContain(
      'forbidden-entity:clearance-level:secret',
    );
  });
});
