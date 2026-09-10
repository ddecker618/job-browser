import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 7 - certification intelligence.
//
// Normalizes known certifications with a curated deterministic catalog,
// distinguishes local modality (required/preferred/equivalent/after-hire/
// ability-to-obtain/nice-to-have) per certification, and avoids false
// equivalencies (e.g., a school grade "A+" is not the CompTIA A+).
// ---------------------------------------------------------------------------

export const CERTIFICATION_INTELLIGENCE_VERSION =
  'certification-intelligence-v1';

type CertificationVendor =
  | 'comptia'
  | 'isc2'
  | 'isaca'
  | 'cisco'
  | 'aws'
  | 'azure'
  | 'microsoft'
  | 'other';

interface CertificationSynonym {
  key: string;
  name: string;
  vendor: CertificationVendor;
  pattern: RegExp;
  blockWhen?: RegExp;
}

const CERTIFICATION_CATALOG: readonly CertificationSynonym[] = [
  {
    key: 'security-plus',
    name: 'CompTIA Security+',
    vendor: 'comptia',
    pattern: /\bsecurity\+/i,
  },
  {
    key: 'network-plus',
    name: 'CompTIA Network+',
    vendor: 'comptia',
    pattern: /\bnetwork\+/i,
  },
  {
    key: 'a-plus',
    name: 'CompTIA A+',
    vendor: 'comptia',
    pattern: /\ba\+/i,
    blockWhen: /\b(?:grade|gpa)\b/i,
  },
  {
    key: 'cysa-plus',
    name: 'CompTIA CySA+',
    vendor: 'comptia',
    pattern: /\bcysa\+/i,
  },
  {
    key: 'securityx',
    name: 'CompTIA SecurityX',
    vendor: 'comptia',
    pattern: /\bsecurityx\b/i,
  },
  {
    key: 'casp-plus',
    name: 'CompTIA CASP+',
    vendor: 'comptia',
    pattern: /\bcasp\+/i,
  },
  {
    key: 'cissp',
    name: 'ISC2 CISSP',
    vendor: 'isc2',
    pattern: /\bcissp\b/i,
  },
  {
    key: 'cism',
    name: 'ISACA CISM',
    vendor: 'isaca',
    pattern: /\bcism\b/i,
  },
  {
    key: 'ccna',
    name: 'Cisco CCNA',
    vendor: 'cisco',
    pattern: /\bccna\b/i,
  },
  {
    key: 'ccnp',
    name: 'Cisco CCNP',
    vendor: 'cisco',
    pattern: /\bccnp\b/i,
  },
  {
    key: 'ccie',
    name: 'Cisco CCIE',
    vendor: 'cisco',
    pattern: /\bccie\b/i,
  },
  {
    key: 'aws-certified',
    name: 'AWS Certified',
    vendor: 'aws',
    pattern: /\b(?:aws|amazon web services)\b/i,
  },
  {
    key: 'azure-certified',
    name: 'Microsoft Azure Certified',
    vendor: 'azure',
    pattern: /\bazure\b/i,
  },
  {
    key: 'microsoft-certified',
    name: 'Microsoft Certified',
    vendor: 'microsoft',
    pattern: /\bmicrosoft\b/i,
  },
];

const LOCAL_MODALITY_RULES: {
  strength: NlpRequirementStrength;
  pattern: RegExp;
}[] = [
  {
    strength: 'required-after-hire',
    pattern:
      /within \d{1,3} (?:days?|weeks?|months?|years?)|(?:after|upon|post[ -])?(?:hire|hiring|start)|(?:by (?:the )?(?:date|time) of (?:hire|start))|(?:during (?:the )?(?:first|initial) \d{1,3} (?:days?|weeks?|months?|years?))/i,
  },
  {
    strength: 'ability-to-obtain',
    pattern:
      /ability to (obtain|earn|get|secure)|be able to (obtain|earn|get|secure)|eligible(?: to| for)/i,
  },
  {
    strength: 'equivalent-accepted',
    pattern: /equivalent|in lieu of|substitute|comparable/i,
  },
  {
    strength: 'required',
    pattern:
      /required|requirement|mandatory|\bmust\b|\bshall\b|candidates? should|we require|is required/i,
  },
  {
    strength: 'preferred',
    pattern: /preferred|desired|ideally|recommended/i,
  },
  {
    strength: 'nice-to-have',
    pattern: /nice[ -]to[ -]have|good to have|is a plus|\ba plus\b|bonus if/i,
  },
];

export interface CertifiedItem {
  key: string;
  name: string;
  vendor: CertificationVendor;
  raw: string;
  span: { start: number; end: number };
  modality: NlpRequirementStrength;
  equivalency: boolean;
}

export interface CertificationExtraction {
  segmentIndex: number;
  certifications: CertifiedItem[];
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  certificationVersion: typeof CERTIFICATION_INTELLIGENCE_VERSION;
}

export function extractCertifications(
  segment: NlpSegment,
): CertificationExtraction {
  const text = segment.text;
  const normalized = normalizeText(text);
  const certifications: CertifiedItem[] = [];

  for (const synonym of CERTIFICATION_CATALOG) {
    if (synonym.blockWhen?.test(text) === true) continue;
    const match = synonym.pattern.exec(normalized);
    if (match === null) continue;

    const start = match.index;
    const end = start + match[0].length;
    const raw = text.slice(start, end);
    const center = (start + end) / 2;
    const modality = localModality(text, center);
    const equivalency = /\bequivalent\b/i.test(normalized);

    certifications.push({
      key: synonym.key,
      name: synonym.name,
      vendor: synonym.vendor,
      raw,
      span: { start, end },
      modality,
      equivalency,
    });
  }

  certifications.sort((a, b) => a.span.start - b.span.start);

  const confidence =
    certifications.length === 0
      ? 0.4
      : certifications.some((item) => item.vendor !== 'other')
        ? 0.9
        : 0.75;

  return {
    segmentIndex: segment.index,
    certifications,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    certificationVersion: CERTIFICATION_INTELLIGENCE_VERSION,
  };
}

export function extractCertificationsBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): CertificationExtraction[] {
  const results: CertificationExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (!categories.includes('certification')) continue;
    results.push(extractCertifications(segment));
  }
  return results;
}

function localModality(text: string, center: number): NlpRequirementStrength {
  let best: { strength: NlpRequirementStrength; distance: number } | null =
    null;
  for (const rule of LOCAL_MODALITY_RULES) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let hit = pattern.exec(text);
    while (hit !== null) {
      const start = hit.index;
      const end = start + hit[0].length;
      const distance =
        center < start ? start - center : center > end ? center - end : 0;
      if (best === null || distance < best.distance) {
        best = { strength: rule.strength, distance };
      }
      hit = pattern.exec(text);
    }
  }
  return best?.strength ?? 'unknown';
}

export function certificationCatalog(): readonly CertificationSynonym[] {
  return CERTIFICATION_CATALOG;
}
