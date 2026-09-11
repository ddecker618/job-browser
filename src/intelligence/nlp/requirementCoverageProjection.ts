import type { JobNlpEnrichment, NlpFact } from '../../schemas/job-nlp.js';
import type { SkillCatalogEntry } from './skills.js';
import {
  normalizeSkillPhrase,
  skillConcepts,
  type SkillConcept,
} from './skillNormalization.js';
import {
  matchResumeEvidence,
  type ResumeEvidenceItem,
  type ResumeEvidenceRequirement,
} from './resumeEvidence.js';
import {
  buildRequirementCoverage,
  type RequirementCoverageInput,
  type RequirementCoverageProjection,
} from './requirementCoverage.js';

export interface RequirementCoverageProjectionOptions {
  certificationCatalog?: readonly SkillCatalogEntry[];
}

/** Builds diagnostic coverage from immutable snapshot evidence. It has no write
 * path and no score, ranking, eligibility, or lifecycle authority. */
export function projectRequirementCoverage(
  enrichment: JobNlpEnrichment,
  evidence: readonly ResumeEvidenceItem[],
  options: RequirementCoverageProjectionOptions = {},
): RequirementCoverageProjection {
  const skillTargets = skillConcepts();
  const certificationCatalog = options.certificationCatalog ?? [];
  const certificationTargets = skillConcepts(certificationCatalog);
  const inputs: RequirementCoverageInput[] = [];

  for (const fact of enrichment.facts) {
    if (fact.meta?.isBoilerplate === true) continue;
    const requirements = requirementsForFact(
      fact,
      skillTargets,
      certificationTargets,
    );
    for (const requirement of requirements) {
      const catalog =
        requirement.kind === 'certification' ? certificationCatalog : undefined;
      const result = matchResumeEvidence({
        requirements: [requirement],
        evidence,
        ...(catalog === undefined ? {} : { catalog }),
      })[0];
      if (result === undefined) {
        throw new Error('Requirement evidence matching returned no row');
      }
      inputs.push({
        requirementId: requirement.requirementId,
        phrase: requirement.phrase,
        category: fact.category,
        strength: fact.strength,
        evidence: result,
      });
    }
  }
  return buildRequirementCoverage(inputs);
}

function requirementsForFact(
  fact: NlpFact,
  skillTargets: readonly SkillConcept[],
  certificationTargets: readonly SkillConcept[],
): ResumeEvidenceRequirement[] {
  if (fact.category === 'skill') {
    return fact.entities.map((entity, index) => {
      const normalized = normalizeSkillPhrase(entity.raw);
      return requirement(
        fact,
        index,
        'skill',
        entity.raw,
        skillTargets.find(
          (concept) => concept.key === normalized.sourceConceptKey,
        ) ?? null,
      );
    });
  }
  if (fact.category === 'certification') {
    return fact.entities.map((entity, index) =>
      requirement(
        fact,
        index,
        'certification',
        fact.meta?.certification?.raw ?? entity.normalized,
        certificationTargets.find(
          (concept) =>
            concept.label.toLocaleLowerCase('en-US') ===
            entity.normalized.toLocaleLowerCase('en-US'),
        ) ?? null,
      ),
    );
  }
  if (fact.category === 'experience') {
    return [
      {
        ...requirement(fact, 0, 'experience', fact.evidence.segmentText, null),
        minimumYears: minimumYears(fact),
      },
    ];
  }
  if (fact.category === 'education') {
    return fact.entities.flatMap((entity, index) => {
      const level = educationLevel(entity.normalized);
      return level === null
        ? []
        : [
            {
              ...requirement(
                fact,
                index,
                'education',
                fact.evidence.segmentText,
                null,
              ),
              targetValue: level,
            },
          ];
    });
  }
  if (fact.category === 'clearance') {
    return fact.entities.map((entity, index) => ({
      ...requirement(fact, index, 'clearance', fact.evidence.segmentText, null),
      targetValue: entity.normalized.replace(/\s*\([^)]*\)\s*$/, ''),
    }));
  }
  return [];
}

function requirement(
  fact: NlpFact,
  index: number,
  kind: ResumeEvidenceRequirement['kind'],
  phrase: string,
  targetConcept: SkillConcept | null,
): ResumeEvidenceRequirement {
  return {
    requirementId: fact.factId + ':coverage:' + String(index),
    phrase,
    kind,
    targetConcept,
  };
}

function minimumYears(fact: NlpFact): number | null {
  const nested = fact.meta?.experience?.nestedYears?.[0]?.minimum;
  if (nested !== undefined && Number.isFinite(nested)) return nested;
  for (const entity of fact.entities) {
    try {
      const parsed = JSON.parse(entity.normalized) as {
        years?: { minimum?: unknown } | null;
      };
      const value = parsed.years?.minimum;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    } catch {
      continue;
    }
  }
  return null;
}

function educationLevel(value: string): string | null {
  const level = value.split(' in ')[0]?.trim();
  return level === 'high-school' ||
    level === 'associate' ||
    level === 'bachelor' ||
    level === 'master' ||
    level === 'doctorate'
    ? level
    : null;
}
