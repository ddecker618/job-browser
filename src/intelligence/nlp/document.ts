import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import {
  jobNlpEnrichmentSchema,
  NLP_EXTRACTION_VERSION,
  type JobNlpEnrichment,
  type NlpFact,
  type NlpRequirementStrength,
} from '../../schemas/job-nlp.js';
import {
  segmentRoleDescription,
  type RoleDescriptionParts,
} from './segmenter.js';
import { classifySegment } from './categorizer.js';
import { classifyStrength } from './strength.js';
import { extractSkills } from './skills.js';
import { extractEducation } from './education.js';
import { extractExperience } from './experience.js';
import { extractCertifications } from './certifications.js';
import { extractClearance } from './clearance.js';
import { extractLocation } from './location.js';

export const NLP_DOCUMENT_VERSION = 'document-v1';
export const MAX_NLP_DOCUMENT_CHARACTERS = 50000;
export function documentHash(parts: RoleDescriptionParts): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        pipeline: NLP_DOCUMENT_VERSION,
        schema: NLP_EXTRACTION_VERSION,
        title: parts.title,
        location: parts.location,
        description: parts.description,
        requirements: parts.requirements,
        preferredQualifications: parts.preferredQualifications,
      }),
    )
    .digest('hex');
}
export async function extractNlpDocument(
  parts: RoleDescriptionParts,
  signal?: AbortSignal,
): Promise<JobNlpEnrichment> {
  if (
    Object.values(parts).reduce((n, s) => n + (s?.length ?? 0), 0) >
    MAX_NLP_DOCUMENT_CHARACTERS
  )
    throw new RangeError(
      'Description exceeds the 50,000 character analysis limit.',
    );
  const segments = segmentRoleDescription(parts);
  if (segments.length > 1000)
    throw new RangeError(
      'Description exceeds the 1,000 segment analysis limit.',
    );
  const facts: NlpFact[] = [];
  let field = '';
  let inherited: NlpRequirementStrength = 'unknown';
  for (const segment of segments) {
    signal?.throwIfAborted();
    if (segment.index % 10 === 0) await setImmediate(undefined, { signal });
    if (field !== segment.sourceField) {
      field = segment.sourceField;
      inherited =
        field === 'requirements'
          ? 'required'
          : field === 'preferredQualifications'
            ? 'preferred'
            : 'unknown';
    }
    if (segment.kind === 'heading') {
      if (segment.sourceField === 'title') continue;
      inherited = /^(required|minimum|essential|core)\b/i.test(segment.text)
        ? 'required'
        : /^(preferred|desired|bonus|nice.to.have)\b/i.test(segment.text)
          ? 'preferred'
          : 'unknown';
      continue;
    }
    const categories = classifySegment(segment).categories;
    const base = classifyStrength(segment, categories);
    const strength = base.strength === 'unknown' ? inherited : base.strength;
    const skills = extractSkills(segment);
    const education = extractEducation(segment);
    const experience = extractExperience(segment);
    const certifications = extractCertifications(segment);
    const clearance = extractClearance(segment);
    const location = extractLocation(segment);
    const source =
      parts[segment.sourceField as keyof RoleDescriptionParts] ?? '';
    const evidence = {
      segmentText: source.slice(segment.charStart, segment.charEnd),
      sourceField: segment.sourceField,
      segmentIndex: segment.index,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
    };
    function add(
      category: NlpFact['category'],
      values: string[],
      modality = strength,
    ) {
      const factId =
        String(segment.index) + ':' + category + ':' + String(facts.length);
      facts.push({
        factId,
        category,
        strength: modality,
        entities: values.map((value, index) => ({
          id: factId + ':' + String(index),
          raw: segment.text,
          normalized: value,
          type: 'text',
          confidence: base.confidence,
          evidenceText: evidence.segmentText,
        })),
        confidence: base.confidence,
        extractionMethod: 'entity-normalizer',
        extractionVersion: NLP_EXTRACTION_VERSION,
        evidence,
        conflict: {
          state: 'unknown',
          nature: [],
          deterministicValue: null,
          nlpValue: null,
          note: 'Not reconciled against production interpretation. Shadow only.',
        },
      });
    }
    for (const mention of skills.mentions)
      add(
        'skill',
        [mention.name],
        mention.context === 'required' || mention.context === 'preferred'
          ? mention.context
          : strength,
      );
    if (education.degrees.length)
      add('education', [
        ...education.degrees.map(
          (d) => d.level + (d.field ? ' in ' + d.field : ''),
        ),
        'Equivalency: ' + education.equivalency,
        ...(education.substitutionYears === null
          ? []
          : ['Substitution years: ' + String(education.substitutionYears)]),
      ]);
    if (
      experience.years ||
      experience.months.length ||
      experience.alternatives.length
    )
      add('experience', [
        JSON.stringify({
          years: experience.years,
          months: experience.months,
          alternatives: experience.alternatives,
          domains: experience.domains,
        }),
      ]);
    for (const item of certifications.certifications)
      add(
        'certification',
        [item.name],
        item.modality === 'unknown' ? strength : item.modality,
      );
    for (const item of clearance.clearances)
      add(
        'clearance',
        [item.name + ' (' + item.status + ')'],
        item.status === 'ability-to-obtain'
          ? 'ability-to-obtain'
          : item.status === 'preferred'
            ? 'preferred'
            : strength,
      );
    for (const item of clearance.citizenship)
      add(
        'citizenship',
        [item.status],
        item.modality === 'unknown' ? strength : item.modality,
      );
    if (location.arrangement !== 'unknown')
      add('work-arrangement', [location.arrangement]);
    if (location.locations.length)
      add(
        'location',
        location.locations.map((item) => item.normalized),
      );
    if (location.travel.mentioned)
      add('travel', [JSON.stringify(location.travel)]);
    for (const category of categories)
      if (
        !facts.some(
          (f) =>
            f.evidence.segmentIndex === segment.index &&
            f.category === category,
        )
      )
        add(category, []);
  }
  return jobNlpEnrichmentSchema.parse({
    version: NLP_EXTRACTION_VERSION,
    generatedAt: new Date().toISOString(),
    sourceTextHash: documentHash(parts),
    segmentation: { segments, method: 'segmentation-v1' },
    facts,
  });
}
