import {
  describeNlpConfidence,
  type JobNlpEnrichment,
  type NlpConflictState,
  type NlpFact,
  type NlpFactMeta,
  type NlpRequirementCategory,
} from '../../schemas/job-nlp.js';
import { redactSensitiveText } from './inspector.js';

// ---------------------------------------------------------------------------
// P5 - production Job Intelligence projection (EXPLANATION level).
//
// A read-only, type-safe projection of the enriched envelope rendered for the
// user Job Intelligence panel. It is generated at read time from the stored
// envelope plus the deterministic job fields; it never persists and never
// feeds a decide path. Every claim is interpreted (plain-language, anchored to
// the posting text), evidence is shown, and when a fact is comparable with the
// app's structured (deterministic) record the structured value is authoritative.
//
// Safety constraints honored here:
//   - never states possession ("you have") or mirrors a hard gate silently;
//   - never alters score, eligibility, ranking, filtering, or lifecycle;
//   - boilerplate and non-requirement mentions are reported separately, never
//     presented as requirements.
// ---------------------------------------------------------------------------

export const JOB_INTELLIGENCE_PROJECTION_VERSION =
  'job-intelligence-projection-v1';

export interface JobIntelligenceDeterministicSide {
  clearanceRequirement: string | null;
  remoteType: string | null;
  location: string | null;
  estimatedExperienceYears: number | null;
}

export interface ProjectedFact {
  factId: string;
  category: NlpRequirementCategory;
  interpretation: string;
  strength: string;
  confidence: number;
  confidenceBand: string;
  entities: { normalized: string; type: string }[];
  evidence: {
    sourceField: string;
    segmentText: string;
    segmentIndex: number;
  };
  deterministic: {
    available: boolean;
    state: NlpConflictState;
    deterministicValue: string | null;
    nlpValue: string | null;
    note: string | null;
  };
  meta: NlpFactMeta | undefined;
}

export interface JobIntelligenceProjection {
  projectionVersion: typeof JOB_INTELLIGENCE_PROJECTION_VERSION;
  jobId: string;
  generatedAt: string;
  extractionVersion: string;
  sourceTextHash: string;
  level: { key: 'explanation'; label: string };
  summary: {
    factCount: number;
    otherFactCount: number;
    boilerplateCount: number;
    segmentCount: number;
    conflictCount: number;
    unreconciledCount: number;
  };
  requirementFacts: ProjectedFact[];
  otherFacts: ProjectedFact[];
  authority: {
    score: 'deterministic-unaffected';
    eligibility: 'deterministic-unaffected';
    ranking: 'deterministic-unaffected';
    lifecycle: 'deterministic-unaffected';
  };
}

const REQUIREMENT_CATEGORIES: readonly NlpRequirementCategory[] = [
  'skill',
  'experience',
  'education',
  'certification',
  'clearance',
  'citizenship',
  'location',
  'work-arrangement',
];

const CATEGORY_WORD: Record<NlpRequirementCategory, string> = {
  skill: 'skill',
  experience: 'experience',
  education: 'education',
  certification: 'certification',
  clearance: 'clearance',
  citizenship: 'citizenship',
  location: 'location',
  'work-arrangement': 'work arrangement',
  travel: 'travel',
  schedule: 'schedule',
  'employment-type': 'employment type',
  responsibility: 'responsibility',
  compensation: 'compensation',
  benefit: 'benefit',
  'company-description': 'company description',
  'legal-eeo-boilerplate': 'boilerplate',
  unknown: 'observation',
};

const STRENGTH_DISPLAY: Record<string, string> = {
  required: 'Required',
  preferred: 'Preferred',
  'nice-to-have': 'Nice-to-have',
  'ability-to-obtain': 'Ability to obtain',
  'required-after-hire': 'Required after hire',
  'equivalent-accepted': 'Equivalent accepted',
  informational: 'Informational mention',
  unknown: 'Mentioned',
};

const UNRECONCILED_NOTE =
  'No structured counterpart for this claim in the app record; treated as an unverified interpretation of the posting text.';

export function projectJobIntelligence(
  jobId: string,
  enrichment: JobNlpEnrichment,
  deterministic: JobIntelligenceDeterministicSide,
): JobIntelligenceProjection {
  let boilerplateCount = 0;
  const requirementFacts: ProjectedFact[] = [];
  const otherFacts: ProjectedFact[] = [];

  for (const fact of [...enrichment.facts].sort(compareFacts)) {
    const isBoilerplate = fact.meta?.isBoilerplate === true;
    if (isBoilerplate) boilerplateCount += 1;
    const projected = projectFact(fact, deterministic);
    if (REQUIREMENT_CATEGORIES.includes(fact.category) && !isBoilerplate) {
      requirementFacts.push(projected);
    } else {
      otherFacts.push(projected);
    }
  }

  const conflictCount = requirementFacts.filter(
    (fact) => fact.deterministic.state === 'conflict',
  ).length;
  const unreconciledCount = requirementFacts.filter(
    (fact) =>
      !fact.deterministic.available ||
      fact.deterministic.state === 'unknown' ||
      fact.deterministic.state === 'nlp-only',
  ).length;

  return {
    projectionVersion: JOB_INTELLIGENCE_PROJECTION_VERSION,
    jobId,
    generatedAt: enrichment.generatedAt,
    extractionVersion: enrichment.version,
    sourceTextHash: enrichment.sourceTextHash,
    level: { key: 'explanation', label: 'EXPLANATION' },
    summary: {
      factCount: requirementFacts.length,
      otherFactCount: otherFacts.length,
      boilerplateCount,
      segmentCount: enrichment.segmentation.segments.length,
      conflictCount,
      unreconciledCount,
    },
    requirementFacts,
    otherFacts,
    authority: {
      score: 'deterministic-unaffected',
      eligibility: 'deterministic-unaffected',
      ranking: 'deterministic-unaffected',
      lifecycle: 'deterministic-unaffected',
    },
  };
}

function projectFact(
  fact: NlpFact,
  deterministic: JobIntelligenceDeterministicSide,
): ProjectedFact {
  const reconciliation = reconcileFact(fact, deterministic);
  return {
    factId: redact(fact.factId),
    category: fact.category,
    interpretation: interpretFact(fact),
    strength: STRENGTH_DISPLAY[fact.strength] ?? fact.strength,
    confidence: fact.confidence,
    confidenceBand: describeNlpConfidence(fact.confidence),
    entities: fact.entities.map((entity) => ({
      normalized: redact(entity.normalized),
      type: entity.type,
    })),
    evidence: {
      sourceField: fact.evidence.sourceField,
      segmentText: redact(fact.evidence.segmentText),
      segmentIndex: fact.evidence.segmentIndex,
    },
    deterministic: {
      available: reconciliation.available,
      state: reconciliation.state,
      deterministicValue: reconciliation.deterministicValue,
      nlpValue: reconciliation.nlpValue,
      note: reconciliation.note,
    },
    meta: fact.meta,
  };
}

function interpretFact(fact: NlpFact): string {
  const word = CATEGORY_WORD[fact.category];
  const role = STRENGTH_DISPLAY[fact.strength] ?? 'Mentioned';
  if (fact.category === 'experience') {
    const years = minimumExperienceYears(fact);
    return years === null
      ? `${role} experience per the posting`
      : `${role} experience, about ${formatYears(years)} years, per the posting`;
  }
  return `${role} ${word} per the posting`;
}

interface Reconciliation {
  available: boolean;
  state: NlpConflictState;
  deterministicValue: string | null;
  nlpValue: string | null;
  note: string | null;
}

function reconcileFact(
  fact: NlpFact,
  deterministic: JobIntelligenceDeterministicSide,
): Reconciliation {
  switch (fact.category) {
    case 'clearance': {
      const nlpRaw = fact.entities[0]?.normalized ?? null;
      if (deterministic.clearanceRequirement === null || nlpRaw === null) {
        return {
          available: false,
          state: 'nlp-only',
          deterministicValue: deterministic.clearanceRequirement,
          nlpValue: fact.entities[0]?.normalized ?? null,
          note: 'Clearance is not present in the structured job record; this is an unverified interpretation of the posting text.',
        };
      }
      const agreement = clearanceMatches(
        nlpRaw,
        deterministic.clearanceRequirement,
      );
      return {
        available: true,
        state: agreement ? 'agreement' : 'conflict',
        deterministicValue: deterministic.clearanceRequirement,
        nlpValue: fact.entities[0]?.normalized ?? null,
        note: agreement
          ? 'Matches the structured job record (posting wording may differ).'
          : 'The posting text and the structured record differ. The structured record is authoritative.',
      };
    }
    case 'work-arrangement': {
      const nlpValue = fact.entities[0]?.normalized ?? null;
      const nlpNormalized = workArrangementToken(nlpValue);
      const deterministicToken = workArrangementToken(deterministic.remoteType);
      if (deterministic.remoteType === null || deterministicToken === null) {
        return {
          available: false,
          state: 'unknown',
          deterministicValue: deterministic.remoteType,
          nlpValue,
          note: UNRECONCILED_NOTE,
        };
      }
      const agreement =
        nlpNormalized !== null && nlpNormalized === deterministicToken;
      return {
        available: true,
        state: agreement ? 'agreement' : 'conflict',
        deterministicValue: deterministic.remoteType,
        nlpValue,
        note: agreement
          ? 'Matches the structured work arrangement record.'
          : 'The posting text and the structured record differ. The structured record is authoritative.',
      };
    }
    case 'experience': {
      const nlpYears = minimumExperienceYears(fact);
      if (
        nlpYears === null ||
        deterministic.estimatedExperienceYears === null
      ) {
        return {
          available: false,
          state: 'nlp-only',
          deterministicValue:
            deterministic.estimatedExperienceYears === null
              ? null
              : formatYears(deterministic.estimatedExperienceYears),
          nlpValue: nlpYears === null ? null : formatYears(nlpYears),
          note: 'Experience requirement is not comparable with the structured record; treated as an unverified interpretation.',
        };
      }
      const agreement = nlpYears === deterministic.estimatedExperienceYears;
      return {
        available: true,
        state: agreement ? 'agreement' : 'conflict',
        deterministicValue: formatYears(deterministic.estimatedExperienceYears),
        nlpValue: formatYears(nlpYears),
        note: agreement
          ? 'Matches the structured experience record.'
          : 'The posting text and the structured record differ. The structured record is authoritative.',
      };
    }
    default:
      return {
        available: false,
        state: 'unknown',
        deterministicValue: null,
        nlpValue: fact.entities[0]?.normalized ?? null,
        note: UNRECONCILED_NOTE,
      };
  }
}

function minimumExperienceYears(fact: NlpFact): number | null {
  const nested = fact.meta?.experience?.nestedYears?.[0];
  if (nested?.minimum !== undefined && Number.isFinite(nested.minimum)) {
    return nested.minimum;
  }
  for (const entity of fact.entities) {
    const years = parseExperienceEntity(entity.normalized);
    if (years !== null) return years;
  }
  return null;
}

function parseExperienceEntity(value: string): number | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value) as unknown;
  } catch {
    candidate = null;
  }
  if (typeof candidate === 'object' && candidate !== null) {
    const yearsValue = (candidate as Record<string, unknown>)['years'];
    if (typeof yearsValue === 'number' && Number.isFinite(yearsValue)) {
      return yearsValue;
    }
    if (typeof yearsValue === 'object' && yearsValue !== null) {
      const minimum = (yearsValue as Record<string, unknown>)['minimum'];
      if (typeof minimum === 'number' && Number.isFinite(minimum)) {
        return minimum;
      }
    }
  }
  const matches = /^(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)?$/i.exec(
    value.trim(),
  );
  if (matches === null) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function workArrangementToken(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normText(value);
  if (normalized === 'unknown' || normalized === 'unspecified') return null;
  if (/^(fully\s+|100%?\s*)?remote$/.test(normalized)) return 'remote';
  if (normalized === 'hybrid' || normalized === 'partial-remote') {
    return 'hybrid';
  }
  if (
    normalized === 'onsite' ||
    normalized === 'in-office' ||
    normalized === 'on-site' ||
    normalized === 'office'
  ) {
    return 'onsite';
  }
  return normalized;
}

function formatYears(value: number): string {
  return String(value);
}

const CLEARANCE_NOISE = new Set([
  'required',
  'requirements',
  'require',
  'clearance',
  'security',
  'eligibility',
  'eligible',
  'ability',
  'able',
  'obtain',
  'maintain',
  'current',
  'active',
  'holding',
  'possess',
  'possession',
  'sought',
  'per',
  'and',
  'or',
  'to',
  'must',
  'be',
  'with',
  'candidate',
  'candidates',
]);

function clearanceTokenSet(value: string): string[] {
  return normText(value)
    .split(' ')
    .filter((word) => word.length > 0 && !CLEARANCE_NOISE.has(word));
}

function clearanceMatches(nlp: string, deterministic: string): boolean {
  const left = clearanceTokenSet(nlp);
  const right = clearanceTokenSet(deterministic);
  if (left.length === 0 || right.length === 0) return false;
  const equalSets =
    left.length === right.length &&
    left.every((word, index) => word === right[index]);
  if (equalSets) return true;
  if (left.length >= 2 && right.length >= 2) {
    const longer = left.length > right.length ? left : right;
    const shorter = left.length > right.length ? right : left;
    return shorter.every((word) => longer.includes(word));
  }
  return false;
}

function normText(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9/+ -]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function redact(value: string): string {
  return redactSensitiveText(value).value;
}

function compareFacts(left: NlpFact, right: NlpFact): number {
  return (
    left.evidence.segmentIndex - right.evidence.segmentIndex ||
    left.evidence.charStart - right.evidence.charStart ||
    left.factId.localeCompare(right.factId)
  );
}
