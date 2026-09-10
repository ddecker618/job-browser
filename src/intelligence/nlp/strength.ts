import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 4 - requirement strength / modality classification.
//
// Strength is a SEPARATE axis from category (Stage 3). A statement receives
// exactly one strength. Precedence (first match wins, deterministic):
//   required-after-hire > ability-to-obtain > equivalent-accepted
//   > required > preferred > nice-to-have > informational > unknown
//
// "informational" is applied to non-requirement categories (benefit,
// compensation, company description, EEO boilerplate, responsibility,
// unknown) when no modality marker is present.
// ---------------------------------------------------------------------------

export const STRENGTH_CLASSIFIER_VERSION = 'modality-classifier-v1';

export interface SegmentStrength {
  segmentIndex: number;
  categories: NlpRequirementCategory[];
  strength: NlpRequirementStrength;
  confidence: number;
  method: 'modality-classifier';
  version: typeof NLP_EXTRACTION_VERSION;
  strengthVersion: typeof STRENGTH_CLASSIFIER_VERSION;
}

interface StrengthRule {
  strength: NlpRequirementStrength;
  confidence: number;
  detect: (normalized: string) => boolean;
}

const REQUIRED_PATTERNS = [
  /\bmust\b/,
  /\brequirement(s)?\b/,
  /\benforces?\b/,
  /\brequire(?:s|d)?\b/,
  /\bmandatory\b/,
  /\bits essential that\b/,
  /\bshould have\b/,
  /\bshall\b/,
  /\b(expected|need(?:ed)?|requires) (?:to have|to be|that candidates)\b/,
  /\bwill need\b/,
  /\bwe (?:are|'re) looking for\b/,
  /\bcandidates? should\b/,
];

const PREFERRED_PATTERNS = [
  /\bprefer(?:red)?\b/,
  /\bideally\b/,
  /\bdesire(?:d)?\b/,
  /\brecommend(?:ed)?\b/,
  /\bplus if\b/,
  /\bwe would like\b/,
  /\bwe (?:are|'re) interested in candidates with\b/,
  /\bideally (?:you|candidates?)\b/,
];

const NICE_TO_HAVE_PATTERNS = [
  /nice[ -]to[ -]have/,
  /\bgood to have\b/,
  /\bis a plus\b/,
  /\ba plus\b/,
  /\bits a bonus if\b/,
  /\bbonus points if\b/,
];

const ABILITY_TO_OBTAIN_PATTERNS = [
  /\bability to (obtain|get|secure|earn|attain|certify)\b/,
  /\bbe able to (obtain|get|secure|earn|attain|certify)\b/,
  /\b(?:eligible|eligibility)(?: to| for (?:obtain|get|secure)| for)\b/,
  /\bcandidates? who can (obtain|secure|get)\b/,
  /\bshould be able to (obtain|get|secure)\b/,
  /\bmay be asked to (obtain|get|secure)\b/,
];

const REQUIRED_AFTER_HIRE_PATTERNS = [
  /within \d{1,3} (?:days?|weeks?|months?|years?)\b/,
  /\b(?:after|upon|once|at the time of) (?:hire|hiring|start(?: date)?|joining|employment|onboarding)\b/,
  /\bpost[ -]hire\b/,
  /\b(?:during|by end of) (?:the )?(?:first|initial) \d{1,3} (?:days?|weeks?|months?|years?)\b/,
  /\bby (?:the )?(?:date|time) of (?:hire|start|joining)\b/,
  /\b(?:must|will|shall|has to) (?:obtain|complete|earn|gain) (?:it|this|their|the)? ?[a-z]* (?:within|by|after|upon)\b/,
  /\b(?:hire|hiring) (?:date|start)\b/,
];

const EQUIVALENT_ACCEPTED_PATTERNS = [
  /\bequivalent\b/,
  /\bin lieu of\b/,
  /\bsubstitute(?:d)?\b/,
  /\bcomparable (?:experience|credentials|education|degree)\b/,
  /\bor combination of\b/,
  /\brelated (?:experience|education) (?:will be|is|may be|can be) considered\b/,
];

const MODALITY_CAPABLE_CATEGORIES = new Set<NlpRequirementCategory>([
  'skill',
  'experience',
  'education',
  'certification',
  'clearance',
  'citizenship',
]);

const STRENGTH_RULES: StrengthRule[] = [
  {
    strength: 'required-after-hire',
    confidence: 0.85,
    detect: matchesAny(REQUIRED_AFTER_HIRE_PATTERNS),
  },
  {
    strength: 'ability-to-obtain',
    confidence: 0.85,
    detect: matchesAny(ABILITY_TO_OBTAIN_PATTERNS),
  },
  {
    strength: 'equivalent-accepted',
    confidence: 0.85,
    detect: matchesAny(EQUIVALENT_ACCEPTED_PATTERNS),
  },
  {
    strength: 'required',
    confidence: 0.9,
    detect: matchesAny(REQUIRED_PATTERNS),
  },
  {
    strength: 'preferred',
    confidence: 0.9,
    detect: matchesAny(PREFERRED_PATTERNS),
  },
  {
    strength: 'nice-to-have',
    confidence: 0.8,
    detect: matchesAny(NICE_TO_HAVE_PATTERNS),
  },
];

const INFORMATIONAL_CONFIDENCE = 0.8;
const UNKNOWN_CONFIDENCE = 0.4;

export function classifyStrength(
  segment: NlpSegment,
  categories: readonly NlpRequirementCategory[],
): SegmentStrength {
  const normalized = normalizeText(segment.text);

  for (const rule of STRENGTH_RULES) {
    if (rule.detect(normalized)) {
      return {
        segmentIndex: segment.index,
        categories: [...categories],
        strength: rule.strength,
        confidence: rule.confidence,
        method: 'modality-classifier',
        version: NLP_EXTRACTION_VERSION,
        strengthVersion: STRENGTH_CLASSIFIER_VERSION,
      };
    }
  }

  const hasModalityCapableCategory = categories.some((category) =>
    MODALITY_CAPABLE_CATEGORIES.has(category),
  );

  if (!hasModalityCapableCategory) {
    return {
      segmentIndex: segment.index,
      categories: [...categories],
      strength: 'informational',
      confidence: INFORMATIONAL_CONFIDENCE,
      method: 'modality-classifier',
      version: NLP_EXTRACTION_VERSION,
      strengthVersion: STRENGTH_CLASSIFIER_VERSION,
    };
  }

  return {
    segmentIndex: segment.index,
    categories: [...categories],
    strength: 'unknown',
    confidence: UNKNOWN_CONFIDENCE,
    method: 'modality-classifier',
    version: NLP_EXTRACTION_VERSION,
    strengthVersion: STRENGTH_CLASSIFIER_VERSION,
  };
}

function matchesAny(
  patterns: readonly RegExp[],
): (normalized: string) => boolean {
  return (normalized: string) =>
    patterns.some((pattern) => pattern.test(normalized));
}
