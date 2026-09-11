import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 5 - education intelligence.
//
// Extracts and normalizes degree level, field of study, equivalency, and
// experience-substitution clauses from education segments. Deterministic and
// conservative: bare "degree" yields an unknown level, never guessed.
// ---------------------------------------------------------------------------

export const EDUCATION_INTELLIGENCE_VERSION = 'education-intelligence-v1';

export type DegreeLevel =
  | 'high-school'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctorate'
  | 'unknown';

export type EducationEquivalency =
  | 'experience'
  | 'education'
  | 'credential'
  | 'combination'
  | 'none'
  | 'unknown';

interface Span {
  start: number;
  end: number;
}

export interface ParsedDegree {
  level: DegreeLevel;
  levelConfidence: number;
  field: string | null;
  fieldConfidence: number;
  degreeSpan: Span;
}

export interface EducationExtraction {
  segmentIndex: number;
  degrees: ParsedDegree[];
  equivalency: EducationEquivalency;
  substitutionYears: number | null;
  combined: boolean;
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  educationVersion: typeof EDUCATION_INTELLIGENCE_VERSION;
}

interface LevelRule {
  level: DegreeLevel;
  confidence: number;
  pattern: RegExp;
}

const LEVEL_RULES: LevelRule[] = [
  {
    level: 'doctorate',
    confidence: 0.95,
    pattern: /\bph\.?d\.?|\bdoctorate\b|\bdoctoral\b/i,
  },
  {
    level: 'master',
    confidence: 0.9,
    pattern:
      /\bmaster'?s\b|\bm\.?s\b|\bm\.?a\b|\bm\.?b\.?a\.?\b|\bgraduate (?:degree|level)\b/i,
  },
  {
    level: 'bachelor',
    confidence: 0.9,
    pattern:
      /\bbachelor'?s\b|\bb\.?s\b|\bb\.?a\b|\bbaccalaureate\b|\bundergraduate degree\b|\b(?:4|four)[-\s]?year degree\b/i,
  },
  {
    level: 'associate',
    confidence: 0.9,
    pattern: /\bassociate'?s\b|\ba\.?a\b|\ba\.?s\b|\b2[-\s]?year degree\b/i,
  },
  {
    level: 'high-school',
    confidence: 0.9,
    pattern: /\bhigh school (?:diploma|education|graduate)\b|\bged\b/i,
  },
];

const GENERIC_DEGREE_PATTERN = /\bdegree\b/i;

const FIELD_CAPTURE_PATTERN =
  /\b(?:in|of|majoring in)\s+([A-Za-z][A-Za-z -]{1,40}?[A-Za-z])(?=\s*(?:required|preferred|must|is|are|or|and|;|,|\(|\)|\.|$))/i;

const KNOWN_FIELDS = [
  'computer science',
  'cybersecurity',
  'information technology',
  'information systems',
  'information security',
  'software engineering',
  'computer engineering',
  'electrical engineering',
  'mechanical engineering',
  'engineering',
  'mathematics',
  'math',
  'statistics',
  'science',
  'business administration',
  'business',
  'finance',
  'accounting',
  'criminal justice',
  'liberal arts',
  'network engineering',
  'data science',
  'computer information systems',
];

const EXPERIENCE_EQUIVALENCY_PATTERNS = [
  /\bor equivalent (?:experience|work|background)\b/i,
  /\bor\s+\d{1,2}\s*(?:\+|[-to]*)?\s*years?\s*(?:of\s+)?(?:related\s+)?(?:experience|work)\b/i,
  /\b(?:experience|work)\s+(?:equivalent|substitut(?:e|ing|ed))\b/i,
  /\b(?:in lieu of|instead of) (?:a |the |an )?degree\b/i,
];

const EDUCATION_EQUIVALENCY_PATTERNS = [
  /\bor equivalent education\b/i,
  /\b(?:equivalent|comparable) (?:credentials|education|training)\b/i,
  /\bcombination of (?:education|training|coursework|schooling)\b/i,
];

const SUBSTITUTION_YEARS_PATTERN =
  /(?:or\s+)?(\d{1,2})\s*(?:\+|[-to]*)?\s*years?\s*(?:of\s+)?(?:related\s+)?(?:experience|work)\b/i;

export function extractEducation(segment: NlpSegment): EducationExtraction {
  const text = segment.text;
  const degrees: ParsedDegree[] = [];

  for (const rule of LEVEL_RULES) {
    if (rule.pattern.test(text)) {
      degrees.push({
        level: rule.level,
        levelConfidence: rule.confidence,
        field: captureField(text),
        fieldConfidence: 0.8,
        degreeSpan: spanOf(rule.pattern, text),
      });
    }
  }

  if (degrees.length === 0 && GENERIC_DEGREE_PATTERN.test(text)) {
    degrees.push({
      level: 'unknown',
      levelConfidence: 0.5,
      field: captureField(text),
      fieldConfidence: 0.6,
      degreeSpan: spanOf(GENERIC_DEGREE_PATTERN, text),
    });
  }

  const equivalency = detectEquivalency(text);
  const substitutionYears = extractSubstitutionYears(text);

  const combined = degrees.length > 1 || /\b(?:and|&)\b/i.test(text);

  const confidence = computeEducationConfidence(degrees, equivalency);
  return {
    segmentIndex: segment.index,
    degrees,
    equivalency,
    substitutionYears,
    combined,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    educationVersion: EDUCATION_INTELLIGENCE_VERSION,
  };
}

export function extractEducationBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): EducationExtraction[] {
  const results: EducationExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (!categories.includes('education')) continue;
    results.push(extractEducation(segment));
  }
  return results;
}

function captureField(text: string): string | null {
  const match = FIELD_CAPTURE_PATTERN.exec(text);
  if (match?.[1] === undefined) return null;
  const raw = match[1].trim();
  const normalized = raw.toLowerCase();
  const known = KNOWN_FIELDS.find((field) => normalized === field);
  return known ?? normalized;
}

function detectEquivalency(text: string): EducationEquivalency {
  if (EXPERIENCE_EQUIVALENCY_PATTERNS.some((p) => p.test(text))) {
    return 'experience';
  }
  if (EDUCATION_EQUIVALENCY_PATTERNS.some((p) => p.test(text))) {
    return 'education';
  }
  const years = extractSubstitutionYears(text);
  if (years !== null) return 'experience';
  if (/\bequivalent\b/i.test(text)) return 'credential';
  return 'none';
}

function extractSubstitutionYears(text: string): number | null {
  const match = SUBSTITUTION_YEARS_PATTERN.exec(text);
  if (match?.[1] === undefined) return null;
  const years = Number.parseInt(match[1], 10);
  if (Number.isNaN(years) || years < 0 || years > 30) return null;
  return years;
}

function computeEducationConfidence(
  degrees: readonly ParsedDegree[],
  equivalency: EducationEquivalency,
): number {
  const levelConfidence = degrees[0]?.levelConfidence ?? 0.3;
  let confidence = levelConfidence;
  if (degrees.some((degree) => degree.field !== null)) {
    confidence = Math.min(0.95, confidence + 0.05);
  }
  if (equivalency !== 'none' && equivalency !== 'unknown') {
    confidence = Math.min(0.95, confidence + 0.05);
  }
  if (degrees.length === 0) return 0.3;
  return confidence;
}

function spanOf(pattern: RegExp, text: string): Span {
  const match = pattern.exec(text);
  if (match === null) return { start: 0, end: 0 };
  return { start: match.index, end: match.index + match[0].length };
}
