import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canPromoteNlpLevel,
  NLP_TRUST_LEVELS,
  NLP_TRUST_LEVEL_RANK,
  NLP_TRUST_LEVEL_DESCRIPTORS,
  SPRINT_MAXIMUM_LEVEL,
} from '../src/intelligence/nlp/trustLevel.js';

const FULL_ENRICHMENT_EVIDENCE = [
  ...NLP_TRUST_LEVEL_DESCRIPTORS.explanation.requiredEvidence,
  'content-hash + extraction-version cache',
  'bounded background materialization',
  'rollback flag restores prior behavior exactly',
];

describe('NLP production trust levels (Phase 2)', () => {
  it('defines exactly five levels mapped onto the numeric 0-4 ladder', () => {
    expect(NLP_TRUST_LEVELS).toEqual([
      'shadow',
      'explanation',
      'enrichment',
      'scoring',
      'hard-gate',
    ]);
    expect(NLP_TRUST_LEVEL_RANK).toEqual({
      shadow: 0,
      explanation: 1,
      enrichment: 2,
      scoring: 3,
      'hard-gate': 4,
    });
    for (const key of NLP_TRUST_LEVELS) {
      expect(NLP_TRUST_LEVEL_DESCRIPTORS[key].level).toBe(
        NLP_TRUST_LEVEL_RANK[key],
      );
      expect(
        NLP_TRUST_LEVEL_DESCRIPTORS[key].requiredEvidence.length,
      ).toBeGreaterThan(0);
    }
  });

  it('requires every evidence item of an explanation level before allowing it', () => {
    const decision = canPromoteNlpLevel({
      from: 'shadow',
      to: 'explanation',
      evidence: ['acceptance gate passed'],
    });
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) => r.includes('missing required evidence')),
    ).toBe(true);
  });

  it('is monotonic: a valid one-step promotion to the sprint maximum passes', () => {
    const shadowToExplanation = canPromoteNlpLevel({
      from: 'shadow',
      to: 'explanation',
      evidence: [...NLP_TRUST_LEVEL_DESCRIPTORS.explanation.requiredEvidence],
    });
    expect(shadowToExplanation.allowed).toBe(true);

    const explanationToEnrichment = canPromoteNlpLevel({
      from: 'explanation',
      to: 'enrichment',
      evidence: [...NLP_TRUST_LEVEL_DESCRIPTORS.enrichment.requiredEvidence],
    });
    expect(explanationToEnrichment.allowed).toBe(true);

    const viaFullEvidence = canPromoteNlpLevel({
      from: 'shadow',
      to: 'enrichment',
      evidence: FULL_ENRICHMENT_EVIDENCE,
    });
    expect(viaFullEvidence.allowed).toBe(false);
    expect(viaFullEvidence.reasons.some((r) => r.includes('cannot skip'))).toBe(
      true,
    );
  });

  it('rejects evidence outside the level checklist (fail-closed)', () => {
    const decision = canPromoteNlpLevel({
      from: 'shadow',
      to: 'explanation',
      evidence: [
        ...NLP_TRUST_LEVEL_DESCRIPTORS.explanation.requiredEvidence,
        'a random unrelated claim',
      ],
    });
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) => r.includes('outside the level checklist')),
    ).toBe(true);
  });

  it('enforces the sprint maximum of enrichment (Level 2)', () => {
    expect(SPRINT_MAXIMUM_LEVEL).toBe('enrichment');
    expect(NLP_TRUST_LEVEL_RANK[SPRINT_MAXIMUM_LEVEL]).toBe(2);

    const scoring = canPromoteNlpLevel({
      from: 'enrichment',
      to: 'scoring',
      evidence: [...NLP_TRUST_LEVEL_DESCRIPTORS.scoring.requiredEvidence],
    });
    expect(scoring.allowed).toBe(false);
    expect(
      scoring.reasons.some((r) =>
        r.includes('exceeds the current sprint maximum'),
      ),
    ).toBe(true);
  });

  it('keeps the documented ladder consistent with the module', () => {
    const doc = readFileSync(
      join(process.cwd(), 'docs', 'NLP_TRUST_LEVELS.md'),
      'utf8',
    );

    for (const key of NLP_TRUST_LEVELS) {
      const descriptor = NLP_TRUST_LEVEL_DESCRIPTORS[key];
      expect(doc).toContain(`| ${descriptor.level}     | ${key}`);
      expect(doc).toContain(descriptor.label);
    }
    expect(doc).toContain("SPRINT_MAXIMUM_LEVEL = 'enrichment'");
    expect(doc).toContain('deterministic eligibility gates');
  });

  it('has no production scoring, eligibility, or search consumer of trust levels yet', () => {
    const protectedFiles = [
      'src/intelligence/scoringEngine.ts',
      'src/intelligence/intelligenceEngine.ts',
      'src/intelligence/verifiedMatches.ts',
      'src/intelligence/nlp/resumeEvidence.ts',
      'src/intelligence/nlp/requirementCoverage.ts',
      'src/intelligence/nlp/reconciliation.ts',
    ];
    for (const file of protectedFiles) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/from\s+['"].*trustLevel/);
    }
  });
});
