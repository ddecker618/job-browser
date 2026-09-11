import type { JobNlpEnrichment } from '../../schemas/job-nlp.js';
import { normalizeSkillPhrase, skillConcepts } from './skillNormalization.js';
import {
  matchResumeEvidence,
  type ResumeEvidenceItem,
} from './resumeEvidence.js';
import { buildRequirementCoverage } from './requirementCoverage.js';

/** Read-only adapter: preserve posting wording, and compare only reviewed concepts. */
export function projectSkillCoverage(
  enrichment: JobNlpEnrichment,
  evidence: readonly ResumeEvidenceItem[],
) {
  const concepts = skillConcepts();
  const inputs = enrichment.facts
    .filter((f) => f.category === 'skill' && f.meta?.isBoilerplate !== true)
    .flatMap((fact) => {
      const mentions = fact.entities.length
        ? fact.entities.map((e) => e.raw)
        : [fact.evidence.segmentText];
      return mentions.map((phrase, index) => {
        const normalized = normalizeSkillPhrase(phrase);
        const requirement = {
          requirementId: fact.factId + ':' + String(index),
          phrase,
          kind: 'skill' as const,
          targetConcept:
            concepts.find((c) => c.key === normalized.sourceConceptKey) ?? null,
        };
        const matched = matchResumeEvidence({
          requirements: [requirement],
          evidence,
        })[0];
        if (matched === undefined)
          throw new Error('Requirement matching returned no result');
        return {
          requirementId: requirement.requirementId,
          phrase,
          category: fact.category,
          strength: fact.strength,
          evidence: matched,
        };
      });
    });
  return buildRequirementCoverage(inputs);
}
