import { describe, expect, it } from 'vitest';

import {
  getSyntheticNlpCase,
  getSyntheticNlpCorpus,
  syntheticNlpCorpusCategories,
  syntheticNlpCorpusStrengths,
} from '../src/intelligence/nlp/evaluationCorpus.js';
import {
  nlpRequirementCategorySchema,
  nlpRequirementStrengthSchema,
} from '../src/schemas/job-nlp.js';

describe('synthetic NLP evaluation corpus (Stage 16)', () => {
  it('covers every contract category and every strength label', () => {
    expect(syntheticNlpCorpusCategories()).toEqual(
      nlpRequirementCategorySchema.options,
    );
    expect(syntheticNlpCorpusStrengths()).toEqual(
      nlpRequirementStrengthSchema.options,
    );
  });

  it('has unique, labeled, non-empty cases with at least two examples per category', () => {
    const corpus = getSyntheticNlpCorpus();
    const ids = corpus.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(corpus.length).toBeGreaterThanOrEqual(40);

    for (const category of nlpRequirementCategorySchema.options) {
      expect(
        corpus.filter((item) => item.expectedCategories.includes(category))
          .length,
      ).toBeGreaterThanOrEqual(2);
    }
    for (const item of corpus) {
      expect(item.text.trim().length).toBeGreaterThan(0);
      expect(item.expectedCategories.length).toBeGreaterThan(0);
      expect(item.rationale.trim().length).toBeGreaterThan(0);
      expect(item.kind).toMatch(/^(coverage|paraphrase|adversarial)$/);
      if (item.kind === 'adversarial') {
        expect(item.rationale.length).toBeGreaterThan(20);
      }
    }
  });

  it('retains the critical negative and arrangement cases', () => {
    expect(getSyntheticNlpCase('adversarial-cleared-team')).toMatchObject({
      expectedCategories: ['company-description'],
      forbiddenCategories: ['clearance'],
    });
    expect(getSyntheticNlpCase('adversarial-grade-a-plus')).toMatchObject({
      expectedCategories: ['unknown'],
      forbiddenCategories: ['certification'],
    });
    expect(getSyntheticNlpCase('adversarial-technical-remote')).toMatchObject({
      forbiddenCategories: ['work-arrangement'],
      expectedArrangement: 'unknown',
    });
    expect(getSyntheticNlpCase('adversarial-remote-denied')).toMatchObject({
      expectedArrangement: 'onsite',
    });
  });
});
