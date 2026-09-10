import {
  DEFAULT_SKILL_CATALOG,
  type SkillCatalogEntry,
  type SkillEntityKind,
  type SkillMention,
} from './skills.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 21 - semantic skill normalization shadow mode.
//
// This module is deliberately conservative. Exact and alias relationships
// come from the existing catalog; relatedness comes only from this reviewed
// table. Unknown phrases never become canonical skills by lexical optimism.
// ---------------------------------------------------------------------------

export const SKILL_NORMALIZATION_INTELLIGENCE_VERSION =
  'skill-normalization-v1';
export const SKILL_NORMALIZATION_MODEL_VERSION =
  'deterministic-skill-catalog-v1';

export type SkillRelationship =
  | 'EXACT'
  | 'CANONICAL_ALIAS'
  | 'STRONG_RELATED'
  | 'WEAK_RELATED'
  | 'UNRELATED'
  | 'UNKNOWN';

export interface SkillConcept {
  key: string;
  label: string;
  aliases: readonly string[];
  kind: SkillEntityKind;
}

export interface SkillNormalizationResult {
  phrase: string;
  sourceConceptKey: string | null;
  conceptKey: string | null;
  conceptLabel: string | null;
  matchedAlias: string | null;
  relationship: SkillRelationship;
  score: number;
  method: 'deterministic-fallback';
  modelVersion: typeof SKILL_NORMALIZATION_MODEL_VERSION;
  version: typeof SKILL_NORMALIZATION_INTELLIGENCE_VERSION;
  explanation: string;
}

interface RelationshipPair {
  left: string;
  right: string;
  relationship: Exclude<
    SkillRelationship,
    'EXACT' | 'CANONICAL_ALIAS' | 'UNKNOWN'
  >;
}

const REVIEWED_RELATIONSHIPS: readonly RelationshipPair[] = [
  { left: 'splunk', right: 'siem', relationship: 'STRONG_RELATED' },
  {
    left: 'active directory',
    right: 'windows server',
    relationship: 'STRONG_RELATED',
  },
  { left: 'tcp/ip', right: 'networking', relationship: 'STRONG_RELATED' },
  { left: 'nmap', right: 'networking', relationship: 'STRONG_RELATED' },
  { left: 'docker', right: 'kubernetes', relationship: 'STRONG_RELATED' },
  { left: 'aws', right: 'azure', relationship: 'WEAK_RELATED' },
  { left: 'powershell', right: 'windows server', relationship: 'WEAK_RELATED' },
];

export function skillConcepts(
  catalog: readonly SkillCatalogEntry[] = DEFAULT_SKILL_CATALOG,
): SkillConcept[] {
  const concepts = new Map<string, SkillConcept>();
  for (const entry of catalog) {
    const key = skillKey(entry.name);
    if (concepts.has(key)) continue;
    concepts.set(key, {
      key,
      label: entry.name,
      aliases: [...new Set([entry.name, ...entry.aliases])],
      kind: entry.kind ?? 'skill',
    });
  }
  return [...concepts.values()];
}

export function normalizeSkillPhrase(
  phrase: string,
  targetConcept: SkillConcept | null = null,
  catalog: readonly SkillCatalogEntry[] = DEFAULT_SKILL_CATALOG,
): SkillNormalizationResult {
  const concepts = skillConcepts(catalog);
  const source = findPhraseConcept(phrase, concepts);
  return comparePhraseToConcept(phrase, source, targetConcept);
}

export function compareSkillMention(
  mention: SkillMention,
  targetConcept: SkillConcept,
  catalog: readonly SkillCatalogEntry[] = DEFAULT_SKILL_CATALOG,
): SkillNormalizationResult {
  const sourceConcept = skillConcepts(catalog).find(
    (concept) => skillKey(concept.label) === skillKey(mention.name),
  );
  const source =
    sourceConcept === undefined
      ? undefined
      : {
          concept: sourceConcept,
          matchedAlias: mention.matchedAlias,
          exactLabel:
            normalizeText(mention.raw) === normalizeText(mention.name),
        };
  return comparePhraseToConcept(
    mention.raw,
    source,
    targetConcept,
    mention.matchedAlias,
  );
}

function comparePhraseToConcept(
  phrase: string,
  source: PhraseConcept | undefined,
  targetConcept: SkillConcept | null,
  matchedAliasOverride?: string,
): SkillNormalizationResult {
  if (source === undefined) {
    return {
      phrase,
      sourceConceptKey: null,
      conceptKey: targetConcept?.key ?? null,
      conceptLabel: targetConcept?.label ?? null,
      matchedAlias: null,
      relationship: 'UNKNOWN',
      score: 0,
      method: 'deterministic-fallback',
      modelVersion: SKILL_NORMALIZATION_MODEL_VERSION,
      version: SKILL_NORMALIZATION_INTELLIGENCE_VERSION,
      explanation:
        'No reviewed canonical or related concept was found; abstained.',
    };
  }

  const target = targetConcept ?? source.concept;
  const relationship = relationshipBetween(phrase, source, target);
  return {
    phrase,
    sourceConceptKey: source.concept.key,
    conceptKey: target.key,
    conceptLabel: target.label,
    matchedAlias:
      matchedAliasOverride ?? (source.exactLabel ? null : source.matchedAlias),
    relationship,
    score: scoreForRelationship(relationship),
    method: 'deterministic-fallback',
    modelVersion: SKILL_NORMALIZATION_MODEL_VERSION,
    version: SKILL_NORMALIZATION_INTELLIGENCE_VERSION,
    explanation: explanationFor(relationship),
  };
}

interface PhraseConcept {
  concept: SkillConcept;
  matchedAlias: string;
  exactLabel: boolean;
}

function findPhraseConcept(
  phrase: string,
  concepts: readonly SkillConcept[],
): PhraseConcept | undefined {
  const normalizedPhrase = normalizeText(phrase);
  const matches = concepts.flatMap((concept) =>
    concept.aliases
      .filter((alias) => normalizeText(alias) === normalizedPhrase)
      .map((alias) => ({
        concept,
        matchedAlias: alias,
        exactLabel: normalizeText(concept.label) === normalizedPhrase,
      })),
  );
  return matches.sort(
    (left, right) =>
      Number(right.exactLabel) - Number(left.exactLabel) ||
      right.matchedAlias.length - left.matchedAlias.length ||
      left.concept.key.localeCompare(right.concept.key),
  )[0];
}

function relationshipBetween(
  phrase: string,
  source: PhraseConcept,
  target: SkillConcept,
): SkillRelationship {
  if (source.concept.key === target.key) {
    return normalizeText(phrase) === normalizeText(target.label)
      ? 'EXACT'
      : 'CANONICAL_ALIAS';
  }
  return (
    REVIEWED_RELATIONSHIPS.find(
      (pair) =>
        (pair.left === source.concept.key && pair.right === target.key) ||
        (pair.right === source.concept.key && pair.left === target.key),
    )?.relationship ?? 'UNRELATED'
  );
}

function scoreForRelationship(relationship: SkillRelationship): number {
  switch (relationship) {
    case 'EXACT':
      return 1;
    case 'CANONICAL_ALIAS':
      return 0.99;
    case 'STRONG_RELATED':
      return 0.8;
    case 'WEAK_RELATED':
      return 0.6;
    case 'UNRELATED':
      return 0.1;
    case 'UNKNOWN':
      return 0;
  }
}

function explanationFor(relationship: SkillRelationship): string {
  switch (relationship) {
    case 'EXACT':
      return 'Phrase matches the canonical skill label.';
    case 'CANONICAL_ALIAS':
      return 'Phrase matches a reviewed catalog alias for the canonical skill.';
    case 'STRONG_RELATED':
      return 'Concept pair is explicitly reviewed as strongly related; equivalence is not claimed.';
    case 'WEAK_RELATED':
      return 'Concept pair is explicitly reviewed as weakly related; equivalence is not claimed.';
    case 'UNRELATED':
      return 'Concepts are not related in the reviewed table; no equivalence is claimed.';
    case 'UNKNOWN':
      return 'No reviewed canonical or related concept was found; abstained.';
  }
}

function skillKey(value: string): string {
  return normalizeText(value);
}
