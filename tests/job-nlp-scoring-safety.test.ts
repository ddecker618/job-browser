import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateShadowRecommendationContribution,
  MAX_SHADOW_RECOMMENDATION_CONTRIBUTION,
} from '../src/intelligence/nlp/scoringSafety.js';
const signal = (signalId: string, overrides = {}) => ({
  signalId,
  weight: 1,
  confidence: 0.95,
  current: true,
  evidenceSpanValid: true,
  deterministicState: 'agreement' as const,
  approvedForScoring: true,
  ...overrides,
});
describe('P13 scoring safety invariants', () => {
  it('caps contribution and cannot cross the next deterministic threshold', () => {
    const capped = calculateShadowRecommendationContribution({
      baselineScore: 50,
      eligibilityPassed: true,
      nextDeterministicThreshold: null,
      signals: [signal('a', { weight: 2 }), signal('b', { weight: 2 })],
    });
    expect(capped.contribution).toBe(MAX_SHADOW_RECOMMENDATION_CONTRIBUTION);
    const guarded = calculateShadowRecommendationContribution({
      baselineScore: 69,
      eligibilityPassed: true,
      nextDeterministicThreshold: 70,
      signals: [signal('a', { weight: 3 })],
    });
    expect(guarded.experimentalRecommendationMetric).toBeLessThan(70);
  });
  it('is zero without eligibility, current evidence, confidence, agreement, or future approval', () => {
    for (const input of [
      { eligibilityPassed: false, signals: [signal('a')] },
      { eligibilityPassed: true, signals: [] },
      { eligibilityPassed: true, signals: [signal('a', { confidence: null })] },
      { eligibilityPassed: true, signals: [signal('a', { current: false })] },
      {
        eligibilityPassed: true,
        signals: [signal('a', { evidenceSpanValid: false })],
      },
      {
        eligibilityPassed: true,
        signals: [signal('a', { deterministicState: 'conflict' })],
      },
      {
        eligibilityPassed: true,
        signals: [signal('a', { approvedForScoring: false })],
      },
    ])
      expect(
        calculateShadowRecommendationContribution({
          baselineScore: 50,
          nextDeterministicThreshold: null,
          ...input,
        }).contribution,
      ).toBe(0);
  });
  it('is monotone as qualifying corroborated evidence is added and preserves the baseline fields', () => {
    const before = {
      score: 55,
      eligibilityPassed: true,
      recommendation: 'Possible Match',
    };
    const serialized = JSON.stringify(before);
    const one = calculateShadowRecommendationContribution({
      baselineScore: before.score,
      eligibilityPassed: before.eligibilityPassed,
      nextDeterministicThreshold: 70,
      signals: [signal('a')],
    });
    const two = calculateShadowRecommendationContribution({
      baselineScore: before.score,
      eligibilityPassed: before.eligibilityPassed,
      nextDeterministicThreshold: 70,
      signals: [signal('a'), signal('b')],
    });
    expect(two.contribution).toBeGreaterThanOrEqual(one.contribution);
    expect(JSON.stringify(before)).toBe(serialized);
    expect(two.productionEffect).toBe('none');
  });
  it('keeps production scoring engines isolated from the shadow calculator', () => {
    for (const file of [
      'src/intelligence/scoringEngine.ts',
      'src/intelligence/intelligenceEngine.ts',
    ]) {
      const source = readFileSync(
        new URL('../' + file, import.meta.url),
        'utf8',
      );
      expect(source).not.toContain('scoringSafety');
      expect(source).not.toContain('/nlp/');
    }
  });
});
