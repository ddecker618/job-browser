import { DEFAULT_SKILL_CATALOG, type SkillCatalogEntry } from './skills.js';
import {
  type SkillConcept,
  type SkillRelationship,
  normalizeSkillPhrase,
} from './skillNormalization.js';

// ---------------------------------------------------------------------------
// Stage 22 - resume evidence matching shadow mode.
//
// This module compares a requirement with caller-supplied parsed snapshot
// evidence. It does not parse, edit, save, or assert possession of resume data,
// and it has no production score or eligibility operation.
// ---------------------------------------------------------------------------

export const RESUME_EVIDENCE_MATCHING_VERSION = 'resume-evidence-v1';

export type ResumeEvidenceKind = 'skill' | 'certification';

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
}

export interface ResumeEvidenceItem {
  evidenceId: string;
  kind: ResumeEvidenceKind;
  rawLabel: string;
  provenance: string;
  parserVersion: string;
  normalizationVersion: string;
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
  if (item.kind !== requirement.kind) {
    return {
      evidenceId: item.evidenceId,
      kind: item.kind,
      rawLabel: item.rawLabel,
      provenance: item.provenance,
      parserVersion: item.parserVersion,
      sourceNormalizationVersion: item.normalizationVersion,
      relationship: null,
      score: null,
      normalizationVersion: null,
      explanation: 'Evidence kind does not match this requirement kind.',
    };
  }

  const normalization = normalizeSkillPhrase(
    item.rawLabel,
    requirement.targetConcept,
    catalog,
  );
  return {
    evidenceId: item.evidenceId,
    kind: item.kind,
    rawLabel: item.rawLabel,
    provenance: item.provenance,
    parserVersion: item.parserVersion,
    sourceNormalizationVersion: item.normalizationVersion,
    relationship: normalization.relationship,
    score: normalization.score,
    normalizationVersion: normalization.version,
    explanation: normalization.explanation,
  };
}

function statusFor(
  requirement: ResumeEvidenceRequirement,
  evidence: readonly ResumeEvidenceMatch[],
): ResumeEvidenceStatus {
  if (requirement.targetConcept === null) return 'UNKNOWN';
  const sameKind = evidence.filter((item) => item.kind === requirement.kind);
  if (sameKind.some((item) => isDirect(item.relationship))) {
    return 'DIRECT_MATCH';
  }
  if (sameKind.some((item) => item.relationship === 'STRONG_RELATED')) {
    return 'STRONG_RELATED_EVIDENCE';
  }
  if (sameKind.some((item) => item.relationship === 'WEAK_RELATED')) {
    return 'WEAK_RELATED_EVIDENCE';
  }
  if (sameKind.some((item) => item.relationship === 'UNKNOWN')) {
    return 'UNKNOWN';
  }
  return 'NO_EVIDENCE';
}

function isDirect(relationship: SkillRelationship | null): boolean {
  return relationship === 'EXACT' || relationship === 'CANONICAL_ALIAS';
}

function explanationFor(status: ResumeEvidenceStatus): string {
  switch (status) {
    case 'DIRECT_MATCH':
      return 'Parsed snapshot evidence directly matches the requirement concept; this is evidence only, not a possession claim.';
    case 'STRONG_RELATED_EVIDENCE':
      return 'Parsed snapshot evidence is strongly related under the reviewed table; equivalence and possession are not claimed.';
    case 'WEAK_RELATED_EVIDENCE':
      return 'Parsed snapshot evidence is weakly related under the reviewed table; equivalence and possession are not claimed.';
    case 'NO_EVIDENCE':
      return 'No matching parsed snapshot evidence was supplied.';
    case 'UNKNOWN':
      return 'Evidence or requirement normalization is unknown; no possession claim is made.';
  }
}
