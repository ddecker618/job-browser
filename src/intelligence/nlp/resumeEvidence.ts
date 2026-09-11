import { DEFAULT_SKILL_CATALOG, type SkillCatalogEntry } from './skills.js';
import {
  type SkillConcept,
  type SkillRelationship,
  normalizeSkillPhrase,
} from './skillNormalization.js';

export const RESUME_EVIDENCE_MATCHING_VERSION = 'resume-evidence-v2';
export type ResumeEvidenceKind =
  | 'skill'
  | 'certification'
  | 'experience'
  | 'education'
  | 'clearance';
export type ResumeEvidenceStatus =
  | 'DIRECT_MATCH'
  | 'STRONG_RELATED_EVIDENCE'
  | 'WEAK_RELATED_EVIDENCE'
  | 'NO_EVIDENCE'
  | 'UNKNOWN';

export interface ResumeEvidenceRequirement {
  requirementId: string;
  phrase: string;
  kind: ResumeEvidenceKind;
  targetConcept: SkillConcept | null;
  targetValue?: string | null;
  minimumYears?: number | null;
}
export interface ResumeEvidenceItem {
  evidenceId: string;
  kind: ResumeEvidenceKind;
  rawLabel: string;
  provenance: string;
  parserVersion: string;
  normalizationVersion: string;
  normalizedValue?: string | null;
  years?: number | null;
}
export interface ResumeEvidenceMatch {
  evidenceId: string;
  kind: ResumeEvidenceKind;
  rawLabel: string;
  provenance: string;
  parserVersion: string;
  sourceNormalizationVersion: string;
  relationship: SkillRelationship | null;
  score: number | null;
  normalizationVersion: string | null;
  explanation: string;
}
export interface ResumeEvidenceRequirementResult {
  requirementId: string;
  phrase: string;
  kind: ResumeEvidenceKind;
  status: ResumeEvidenceStatus;
  evidence: ResumeEvidenceMatch[];
  consideredEvidenceCount: number;
  assertsPossession: false;
  productionEffect: 'none';
  method: 'deterministic-fallback';
  version: typeof RESUME_EVIDENCE_MATCHING_VERSION;
  explanation: string;
}
export interface ResumeEvidenceMatchingInput {
  requirements: readonly ResumeEvidenceRequirement[];
  evidence: readonly ResumeEvidenceItem[];
  catalog?: readonly SkillCatalogEntry[];
}

export function matchResumeEvidence(
  input: ResumeEvidenceMatchingInput,
): ResumeEvidenceRequirementResult[] {
  const catalog = input.catalog ?? DEFAULT_SKILL_CATALOG;
  return input.requirements.map((requirement) => {
    const evidence = input.evidence.map((item) =>
      matchEvidenceItem(requirement, item, catalog),
    );
    const status = statusFor(requirement, evidence);
    return {
      requirementId: requirement.requirementId,
      phrase: requirement.phrase,
      kind: requirement.kind,
      status,
      evidence,
      consideredEvidenceCount: input.evidence.length,
      assertsPossession: false,
      productionEffect: 'none',
      method: 'deterministic-fallback',
      version: RESUME_EVIDENCE_MATCHING_VERSION,
      explanation: explanationFor(status),
    };
  });
}

function matchEvidenceItem(
  requirement: ResumeEvidenceRequirement,
  item: ResumeEvidenceItem,
  catalog: readonly SkillCatalogEntry[],
): ResumeEvidenceMatch {
  const base = {
    evidenceId: item.evidenceId,
    kind: item.kind,
    rawLabel: item.rawLabel,
    provenance: item.provenance,
    parserVersion: item.parserVersion,
    sourceNormalizationVersion: item.normalizationVersion,
  };
  if (item.kind !== requirement.kind)
    return {
      ...base,
      relationship: null,
      score: null,
      normalizationVersion: null,
      explanation: 'Evidence kind does not match this requirement kind.',
    };
  if (requirement.kind === 'skill' || requirement.kind === 'certification') {
    const n = normalizeSkillPhrase(
      item.rawLabel,
      requirement.targetConcept,
      catalog,
    );
    return {
      ...base,
      relationship: n.relationship,
      score: n.score,
      normalizationVersion: n.version,
      explanation: n.explanation,
    };
  }
  if (requirement.kind === 'experience') {
    if (requirement.minimumYears == null || item.years == null)
      return unknown(base, 'Structured years were not parsed on both sides.');
    const direct = item.years >= requirement.minimumYears;
    return {
      ...base,
      relationship: direct ? 'EXACT' : 'UNRELATED',
      score: direct ? 1 : 0.1,
      normalizationVersion: item.normalizationVersion,
      explanation: direct
        ? 'Snapshot evidence meets the stated year threshold; this does not assert possession.'
        : 'Snapshot evidence does not meet the stated year threshold; this does not assert possession.',
    };
  }
  const target = normal(requirement.targetValue);
  const value = normal(item.normalizedValue);
  if (target === null || value === null)
    return unknown(
      base,
      'A reviewed structured value was not parsed on both sides.',
    );
  const direct = target === value;
  return {
    ...base,
    relationship: direct ? 'EXACT' : 'UNRELATED',
    score: direct ? 1 : 0.1,
    normalizationVersion: item.normalizationVersion,
    explanation: direct
      ? 'Snapshot evidence directly matches the reviewed requirement value; this does not assert possession.'
      : 'Snapshot evidence is different from the reviewed requirement value; this does not assert possession.',
  };
}
function unknown(
  base: Omit<
    ResumeEvidenceMatch,
    'relationship' | 'score' | 'normalizationVersion' | 'explanation'
  >,
  explanation: string,
): ResumeEvidenceMatch {
  return {
    ...base,
    relationship: 'UNKNOWN',
    score: 0,
    normalizationVersion: null,
    explanation,
  };
}
function statusFor(
  requirement: ResumeEvidenceRequirement,
  evidence: readonly ResumeEvidenceMatch[],
): ResumeEvidenceStatus {
  if (!hasTarget(requirement)) return 'UNKNOWN';
  const same = evidence.filter((item) => item.kind === requirement.kind);
  if (
    same.some(
      (item) =>
        item.relationship === 'EXACT' ||
        item.relationship === 'CANONICAL_ALIAS',
    )
  )
    return 'DIRECT_MATCH';
  if (same.some((item) => item.relationship === 'STRONG_RELATED'))
    return 'STRONG_RELATED_EVIDENCE';
  if (same.some((item) => item.relationship === 'WEAK_RELATED'))
    return 'WEAK_RELATED_EVIDENCE';
  if (same.length === 0)
    return requirement.kind === 'skill' || requirement.kind === 'certification'
      ? 'NO_EVIDENCE'
      : 'UNKNOWN';
  if (same.some((item) => item.relationship === 'UNKNOWN')) return 'UNKNOWN';
  return 'NO_EVIDENCE';
}
function hasTarget(r: ResumeEvidenceRequirement): boolean {
  if (r.kind === 'skill' || r.kind === 'certification')
    return r.targetConcept !== null;
  if (r.kind === 'experience') return r.minimumYears != null;
  return normal(r.targetValue) !== null;
}
function normal(value: string | null | undefined): string | null {
  const n = value
    ?.trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9/+ -]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (n === undefined || n.length === 0) return null;
  return n;
}
function explanationFor(status: ResumeEvidenceStatus): string {
  const suffix =
    ' This is evidence of a match only and never a claim that the applicant possesses it.';
  switch (status) {
    case 'DIRECT_MATCH':
      return (
        'Parsed snapshot evidence directly matches the requirement.' + suffix
      );
    case 'STRONG_RELATED_EVIDENCE':
      return (
        'Parsed snapshot evidence is strongly related under the reviewed table; equivalence is not claimed.' +
        suffix
      );
    case 'WEAK_RELATED_EVIDENCE':
      return (
        'Parsed snapshot evidence is weakly related under the reviewed table; equivalence is not claimed.' +
        suffix
      );
    case 'NO_EVIDENCE':
      return (
        'Parsed snapshot evidence was supplied but did not match the requirement.' +
        suffix
      );
    case 'UNKNOWN':
      return 'The snapshot or requirement lacks a reviewed structured value, so the matcher abstained; no possession claim is made.';
  }
}
