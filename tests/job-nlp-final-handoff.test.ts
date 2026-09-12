import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('NLP final handoff (Stage 29)', () => {
  it('contains exactly 43 reconciled report points and explicit final status', () => {
    const handoff = readFileSync(
      join(process.cwd(), 'docs', 'NLP_FINAL_HANDOFF.md'),
      'utf8',
    );
    const numberedPoints = [...handoff.matchAll(/^\d+\. /gm)];

    expect(numberedPoints).toHaveLength(43);
    expect(handoff).toContain(
      'NLP EXPLANATION AND ENRICHMENT PROMOTION VALIDATED',
    );
    expect(handoff).toContain(
      'NLP SCORING AND HARD-GATE PROMOTION NOT AUTHORIZED',
    );
    expect(handoff).toContain("productionEffect: 'none'");
  });
});
