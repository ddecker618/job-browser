import type { JobNlpEnrichment } from '../../schemas/job-nlp.js';
import type { ResumeEvidenceExtraction } from '../../resumes/resumeService.js';
import type { SkillCatalogEntry } from './skills.js';
import { projectRequirementCoverage } from './requirementCoverageProjection.js';
import type { RequirementCoverageProjection } from './requirementCoverage.js';
import type { ResumeEvidenceItem } from './resumeEvidence.js';

export const CURRENT_RESUME_PREVIEW_SOURCE = 'current_resume_preview';

export interface CurrentResumePreviewCatalogs {
  skills: readonly SkillCatalogEntry[];
  certifications: readonly SkillCatalogEntry[];
}

/**
 * Adapts only catalog-matched facts from an explicit current-resume parse.
 * This is a transient projection: it creates no snapshot and asserts no
 * possession. Failed parsing yields no evidence rather than false absences.
 */
export function adaptCurrentResumeEvidence(
  resumeId: string,
  extraction: ResumeEvidenceExtraction,
  parserVersion: string,
  normalizationVersion: string,
): ResumeEvidenceItem[] {
  if (extraction.parsingStatus !== 'parsed') return [];

  return [
    ...extraction.skillTerms.map((term, index) => ({
      evidenceId: resumeId + ':current-resume-preview:skill:' + String(index),
      kind: 'skill' as const,
      rawLabel: term.rawLabel,
      provenance: `current-resume-preview:resume-extract:${term.matchedBy}`,
      parserVersion,
      normalizationVersion,
      normalizedValue: term.label,
    })),
    ...extraction.certificationTerms.map((term, index) => ({
      evidenceId:
        resumeId + ':current-resume-preview:certification:' + String(index),
      kind: 'certification' as const,
      rawLabel: term.rawLabel,
      provenance: `current-resume-preview:resume-extract:${term.matchedBy}`,
      parserVersion,
      normalizationVersion,
      normalizedValue: term.label,
    })),
  ];
}

export function projectCurrentResumeCoverage(
  enrichment: JobNlpEnrichment,
  resumeId: string,
  extraction: ResumeEvidenceExtraction,
  parserVersion: string,
  normalizationVersion: string,
  catalogs: CurrentResumePreviewCatalogs,
): RequirementCoverageProjection | null {
  if (extraction.parsingStatus !== 'parsed') return null;
  return projectRequirementCoverage(
    enrichment,
    adaptCurrentResumeEvidence(
      resumeId,
      extraction,
      parserVersion,
      normalizationVersion,
    ),
    {
      skillCatalog: catalogs.skills,
      certificationCatalog: catalogs.certifications,
    },
  );
}
