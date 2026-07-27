import { describe, expect, it } from 'vitest';

import { loadScoringConfig } from '../src/config/scoring-config.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';

describe('scoring configuration', () => {
  it('loads weights totaling 100 and descending recommendation thresholds', () => {
    const config = loadScoringConfig();
    expect(
      Object.values(config.weights).reduce((sum, weight) => sum + weight, 0),
    ).toBe(100);
    expect(config.recommendationThresholds.applyImmediately).toBeGreaterThan(
      config.recommendationThresholds.strongMatch,
    );
  });

  it('rejects invalid total weights', () => {
    const config = loadScoringConfig();
    expect(
      scoringConfigSchema.safeParse({
        ...config,
        weights: { ...config.weights, title: config.weights.title + 1 },
      }).success,
    ).toBe(false);
  });
});
