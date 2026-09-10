import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('NLP promotion design (Stage 27)', () => {
  it('documents all levels and keeps the current program shadow-only', () => {
    const design = readFileSync(
      join(process.cwd(), 'docs', 'NLP_PROMOTION_DESIGN.md'),
      'utf8',
    );

    for (const level of [0, 1, 2, 3, 4]) {
      expect(design).toMatch(new RegExp(`\\|\\s*${String(level)}\\s+\\|`));
    }
    expect(design).toContain('NLP SHADOW MODE remains active');
    expect(design).toContain("productionEffect: 'none'");
    expect(design).toContain('false-positive count');
    expect(design).toContain('false-negative count');
    expect(design).toContain('rollback');
  });
});
