import { describe, expect, it } from 'vitest';

import { asSegmentInputs } from '../src/intelligence/nlp/categorizer.js';
import { extractSkills } from '../src/intelligence/nlp/skills.js';
import {
  SKILL_NORMALIZATION_INTELLIGENCE_VERSION,
  SKILL_NORMALIZATION_MODEL_VERSION,
  compareSkillMention,
  normalizeSkillPhrase,
  skillConcepts,
} from '../src/intelligence/nlp/skillNormalization.js';

const concepts = skillConcepts();

function concept(label: string) {
  const result = concepts.find((item) => item.label === label);
  if (result === undefined) throw new Error(`Missing concept ${label}`);
  return result;
}

describe('NLP skill normalization shadow mode (Stage 21)', () => {
  it('retains exact canonical matches and versioned explainability', () => {
    const result = normalizeSkillPhrase('Linux', concept('Linux'));

    expect(result).toMatchObject({
      phrase: 'Linux',
      sourceConceptKey: 'linux',
      conceptKey: 'linux',
      relationship: 'EXACT',
      score: 1,
      method: 'deterministic-fallback',
      modelVersion: SKILL_NORMALIZATION_MODEL_VERSION,
      version: SKILL_NORMALIZATION_INTELLIGENCE_VERSION,
    });
  });

  it('distinguishes a canonical alias from an exact label', () => {
    const result = normalizeSkillPhrase('k8s', concept('Kubernetes'));

    expect(result.relationship).toBe('CANONICAL_ALIAS');
    expect(result.matchedAlias).toBe('k8s');
    expect(result.conceptKey).toBe('kubernetes');
    expect(result.score).toBe(0.99);
  });

  it('normalizes an extracted alias mention without losing the source phrase', () => {
    const segment = asSegmentInputs([
      { index: 0, text: 'Experience with k8s required.', kind: 'sentence' },
    ])[0];
    if (segment === undefined) throw new Error('Missing test segment');
    const mention = extractSkills(segment).mentions.find(
      (item) => item.normalizedName === 'kubernetes',
    );
    if (mention === undefined) throw new Error('Missing Kubernetes mention');

    const result = compareSkillMention(mention, concept('Kubernetes'));

    expect(result.phrase).toBe('k8s');
    expect(result.relationship).toBe('CANONICAL_ALIAS');
    expect(result.matchedAlias).toBe('k8s');
  });

  it('reports reviewed strong and weak relationships without claiming equivalence', () => {
    const strong = normalizeSkillPhrase('Splunk', concept('SIEM'));
    const weak = normalizeSkillPhrase('AWS', concept('Azure'));

    expect(strong.relationship).toBe('STRONG_RELATED');
    expect(strong.score).toBe(0.8);
    expect(strong.explanation).toContain('equivalence is not claimed');
    expect(weak.relationship).toBe('WEAK_RELATED');
    expect(weak.score).toBe(0.6);
  });

  it('distinguishes unrelated concepts and abstains on unknown/adversarial text', () => {
    const unrelated = normalizeSkillPhrase('Python', concept('AWS'));
    const unknown = normalizeSkillPhrase('Grade A+ in mathematics');
    const adversarial = normalizeSkillPhrase(
      'Secret clearance',
      concept('SIEM'),
    );

    expect(unrelated.relationship).toBe('UNRELATED');
    expect(unrelated.score).toBe(0.1);
    expect(unknown.relationship).toBe('UNKNOWN');
    expect(unknown.conceptKey).toBeNull();
    expect(adversarial.relationship).toBe('UNKNOWN');
    expect(adversarial.conceptKey).toBe('siem');
  });

  it('does not mutate the catalog and keeps concepts unique', () => {
    const before = JSON.stringify(concepts);
    const result = normalizeSkillPhrase('Docker', concept('Kubernetes'));

    expect(result.relationship).toBe('STRONG_RELATED');
    expect(new Set(concepts.map((item) => item.key)).size).toBe(
      concepts.length,
    );
    expect(JSON.stringify(concepts)).toBe(before);
  });
});
