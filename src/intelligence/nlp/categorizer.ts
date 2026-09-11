import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 3 - requirement category classification.
//
// Deterministic, explainable multi-label classification of segments into the
// 17 contract categories. Strength/modality is a SEPARATE axis (Stage 4).
// Categories never weaken or widen production gates; clearance care is taken
// so company descriptions ("our cleared team ...") are NOT read as applicant
// clearances.
//
// Confidence is 0..1 reliability for the classifier on this segment.
// ---------------------------------------------------------------------------

export const CATEGORY_CLASSIFIER_VERSION = 'category-classifier-v1';

export interface SegmentClassification {
  segmentIndex: number;
  categories: NlpRequirementCategory[];
  confidence: number;
  method: 'category-classifier';
  version: typeof NLP_EXTRACTION_VERSION;
  classificationVersion: typeof CATEGORY_CLASSIFIER_VERSION;
}

interface CategoryRule {
  category: Exclude<NlpRequirementCategory, 'unknown'>;
  detect: (normalized: string) => boolean;
}

const EEO_PATTERNS = [
  /equal opportunity employer/,
  /equal employment opportunity/,
  /\beoe\b/,
  /affirmative action/,
  /protected veteran/,
  /veterans and individuals with disabilities/,
  /status as a protected veteran/,
  /individuals with disabilities/,
  /reasonable accommodation/,
  /section 503\b/,
  /\bvevraa\b/,
  /drug[-\s]?free workplace/,
  /sexual orientation/,
  /gender identity/,
  /at[-\s]?will\b/,
  /report it to (?:corporate )?hr\b/,
  /\.eoe\b/,
];

const APPLICANT_DIRECTED_PATTERNS = [
  /\b(must|candidates?|the candidate|applicants?|you)\b/,
  /\b(required|requirement|should|shall)\b/,
  /\b(ability|eligible|eligibility)\b/,
  /\bpossess(es|ing)?\b/,
  /\bhold(ing|s)? (?:an |a )?\b/,
  /\bmaintain\b/,
  /\bcurrent\b/,
  /\bobtain\b/,
  /\bhave\b/,
];

const CLEARANCE_PATTERNS = [
  /\bclearance\b/,
  /\bsecret\b/,
  /top secret/,
  /\bts\/sci\b/,
  /\bsci\b/,
  /\bq clearance\b/,
  /\bl clearance\b/,
  /\bpolygraph\b/,
  /\bpublic trust\b/,
  /\bsuitability\b/,
  /\bl[0-9] clearance\b/,
];

const CITIZENSHIP_PATTERNS = [
  /\bcitizens?\b/,
  /\bauthorization to work\b/,
  /\bcitizenship\b/,
  /\bus (?:citizen|citizenship)\b/,
  /\bus persons?\b/,
  /\bpermanent resident\b/,
  /\bgreen card\b/,
  /\bwork authorization\b/,
  /\b(?:authorized|eligible)\s+to work\b/,
  /\bsponsorship\b/,
];

const PLUS_CERTIFICATIONS = ['security+', 'network+', 'a+', 'cysa+', 'casp+'];

const CERTIFICATION_PATTERNS = [
  ...PLUS_CERTIFICATIONS.map(
    (label) => new RegExp(`\\b${label.replace(/\+/g, '\\+')}`),
  ),
  /\bsecurityx\b/,
  /\bcissp\b/,
  /\bcism\b/,
  /\bccna\b/,
  /\bcertification\b/,
  /\bcertified\b/,
  /\blicen[cs]e[ds]?\b/,
  /\bprofessional engineer(?:ing)?\b/,
  /\bpe license\b/,
];

const EDUCATION_PATTERNS = [
  /\bbachelor'?s\b/,
  /\bmaster'?s\b/,
  /\bmaster of\b/,
  /\bph\.?d\.?\b/,
  /\bdoctorate\b/,
  /\bassociate'?s\b/,
  /\bb\.?s\.?\b/,
  /\bb\.?a\.?\b/,
  /\bm\.?s\.?\b/,
  /\bm\.?a\.?\b/,
  /\bm\.?b\.?a\.?\b/,
  /\bm\.?e\.?\b/,
  /\bhigh school diploma\b/,
  /\bged\b/,
  /\bdegree\b/,
  /\bdiploma\b/,
  /\b(university|college) (?:degree|education)\b/,
  /\b(?:undergraduate|graduate) (?:degree|education)\b/,
  /\bmajor(?:ing)? in\b/,
  /\bfield of study\b/,
];

const LOCATION_PATTERNS = [
  /\b(resid(e|ing|es)|located|based) (?:in|near|within|out of)\b/,
  /\bcommut(e|ing|er|es)\b/,
  /\bwithin \d+ miles\b/,
  /\bmiles of\b/,
  /\bin the (?:greater |metro |metro )?(?:st\.? louis|chicago|washington|d\.?c\.?|san antonio|minneapolis|denver|dallas|austin|houston|phoenix|seattle|portland|atlanta|boston|new york|northern virginia|virginia|maryland) area\b/,
  /\b(?:st\.? louis|missouri|illinois|iowa|kentucky)\b/,
  /\b(self[-\s]?relocation|relocat(e|ion))\b/,
  /\bzip code\b/,
];

const WORK_ARRANGEMENT_PATTERNS = [
  /\bremote\b/,
  /\bhybrid\b/,
  /\bon[-\s]?site\b/,
  /\bonsite\b/,
  /\bin[-\s]?office\b/,
  /\btelework\b/,
  /\btelecommut\b/,
  /\bwork from home\b/,
  /\bwfh\b/,
  /\boffice( |-)(based|requirement|presence)\b/,
  /\b(?:onsite|hybrid|remote)[ :,\n]*(?:requirement|position|work|role|schedule)\b/,
];

const TECHNICAL_REMOTE_PATTERNS = [
  /\bremote\s+(?:support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics|infrastructure)\b/,
  /\bon[- ]?premises\s+and\s+remote\s+infrastructure\b/,
];

const TRAVEL_PATTERNS = [
  /\btravel\b/,
  /\bovernight (?:travel|stays)\b/,
  /\b\d{1,2}%\s*(?:travel|time)\b/,
  /\b(?:5|10|15|20|25|30|40|50)%\b/,
  /\bwilling(?:ness)? to travel\b/,
  /\binternational travel\b/,
  /\bdomestic travel\b/,
  /\bability to travel\b/,
];

const SCHEDULE_PATTERNS = [
  /\bshift(?:s)?\b/,
  /\bschedule\b/,
  /\bovertime\b/,
  /\bflexible hours\b/,
  /\bmonday[-\s]?friday\b/,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend)\b/,
  /\bsecond (?:shift|watch)\b/,
  /\bnight(?:s)? (?:shift|watch|hours)\b/,
  /\brotating (?:shifts?|schedule)\b/,
  /\b12[-\s]?hour (?:shifts?|schedules?)\b/,
  /\b(?:hours per week|hrs? per week|40[-\s]?hour)\b/,
];

const EMPLOYMENT_TYPE_PATTERNS = [
  /\bfull[-\s]?time\b/,
  /\bpart[-\s]?time\b/,
  /\bcontract(?:ual)?\b/,
  /\btemporary\b/,
  /\bpermanent\b/,
  /\bw-?2\b/,
  /\b1099\b/,
  /\bsalaried\b/,
  /\bexempt\b/,
  /\bnon[-\s]?exempt\b/,
  /\bintern(?:ship)?\b/,
  /\bseasonal\b/,
];

const COMPENSATION_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d{2})?\b/,
  /\bsalary\b/,
  /\bsalaries\b/,
  /\bpay range\b/,
  /\bpay band\b/,
  /\bhourly rate\b/,
  /\bannual base\b/,
  /\bcompensation\b/,
  /\bsign[-\s]?on\b/,
  /\bbonus\b/,
  /\bcommensurate (?:with|to)\b/,
  /\bwage(?:s)?\b/,
  /\btotal rewards\b/,
];

const BENEFIT_PATTERNS = [
  /\bbenefit(?:s)?\b/,
  /\bhealth insurance\b/,
  /\bmedical[^\n;]*dental\b/,
  /\bdental\b/,
  /\bvision insurance\b/,
  /\b401 ?k\b/,
  /\bretirement\b/,
  /\bpto\b/,
  /\bpaid (?:time off|leave|vacation|holidays|sick)\b/,
  /\btuition (?:reimbursement|assistance)\b/,
  /\bstock options\b/,
  /\brelocation assistance\b/,
  /\bwellness (?:program|benefit)s?\b/,
  /\bparental leave\b/,
  /\bfsa\b/,
  /\bhsa\b/,
];

const SKILL_PATTERNS = [
  /\bskill(?:s)?\b/,
  /\blinux\b/,
  /\bunix\b/,
  /\bwindows\b/,
  /\baws\b/,
  /\bazure\b/,
  /\bgcp\b/,
  /\bpython\b/,
  /\bjava\b/,
  /\bsql\b/,
  /\bnosql\b/,
  /\bkubernetes\b/,
  /\bdocker\b/,
  /\bterraform\b/,
  /\bansible\b/,
  /\bjenkins\b/,
  /\bgit\b/,
  /\bci\/cd\b/,
  /\bnetworking\b/,
  /\bfirewall\b/,
  /\bendpoint\b/,
  /\bsiem\b/,
  /\bsplunk\b/,
  /\bsoc\b/,
  /\bactive directory\b/,
  /\bproficiency\b/,
  /\bproficient in\b/,
  /\bknowledge of\b/,
  /\bfamiliarity with\b/,
  /\bexpertise in\b/,
  /\bsolid understanding of\b/,
  /\bworking knowledge of\b/,
  /\bpassion for\b/,
  /\battention to detail\b/,
  /\bproblem[-\s]?solving\b/,
  /\bteamwork\b/,
  /\bleadership\b/,
  /\bcommunication\b/,
  /\borganizational skills?\b/,
  /\bwritten and verbal\b/,
];

const EXPERIENCE_PATTERNS = [
  /\b\d{1,2}\s*(?:\+|[-]|to|-)?\s*(?:years?|yrs?|months?)\b/,
  /\b(?:years?|yrs?)\s+(?:of\s+)?(?:experience|work)\b/,
  /\bhands[-\s]?on\b/,
  /\bexperienced\b/,
  /\bprior (?:experience|work|background)\b/,
  /\bprogressive (?:experience|responsibility)\b/,
  /\b(?:experience|background)\s+(?:in|with|working|using|developing)\b/,
  /\brelevant (?:experience|background)\b/,
  /\bprofessional (?:experience|background)\b/,
];

const RESPONSIBILITY_PATTERNS = [
  /\bresponsible for\b/,
  /\bresponsibi(?:lities|lity)\s+(?:will|include|are)\b/,
  /\bprimary (?:responsibilit|dut)ies?\b/,
  /\bduties (?:will|include|are)\b/,
  /\byou (?:will|would(?: be)?)\b/,
  /\bthe (?:role|position) (?:will|involves)\b/,
  /\bwill (?:lead|manage|oversee|drive|own|develop|maintain|design|implement|operate|support)\b/,
  /\b(?:act|serve) as\b/,
];

const COMPANY_DESCRIPTION_PATTERNS = [
  /\bwe are\b/,
  /\bour\s+[\w-]*\s*(?:team|organization|company|clients)\b/,
  /\bwe (?:are|provide|offer|specialize|work|partner|believe|pride|focus|support)\b/,
  /\babout us\b/,
  /\bwho we are\b/,
  /\b(?:leading|top|global) (?:company|provider|firm)\b/,
  /\b(?:founded|headquartered) in\b/,
  /\bserving (?:customers|clients)\b/,
  /\bmission[-\s]?driven\b/,
  /\b(?:certified|recognized) (?:as|by)\b/,
];

const CATEGORY_RULES: CategoryRule[] = [
  { category: 'legal-eeo-boilerplate', detect: matchesAny(EEO_PATTERNS) },
  { category: 'compensation', detect: matchesAny(COMPENSATION_PATTERNS) },
  { category: 'benefit', detect: matchesAny(BENEFIT_PATTERNS) },
  { category: 'location', detect: matchesAny(LOCATION_PATTERNS) },
  {
    category: 'work-arrangement',
    detect: (normalized) =>
      matchesAny(WORK_ARRANGEMENT_PATTERNS)(normalized) &&
      !matchesAny(TECHNICAL_REMOTE_PATTERNS)(normalized),
  },
  { category: 'travel', detect: matchesAny(TRAVEL_PATTERNS) },
  { category: 'schedule', detect: matchesAny(SCHEDULE_PATTERNS) },
  { category: 'employment-type', detect: matchesAny(EMPLOYMENT_TYPE_PATTERNS) },
  { category: 'citizenship', detect: matchesAny(CITIZENSHIP_PATTERNS) },
  { category: 'education', detect: matchesAny(EDUCATION_PATTERNS) },
  {
    category: 'certification',
    detect: (normalized) =>
      matchesAny(CERTIFICATION_PATTERNS)(normalized) &&
      !(/\ba\+/.test(normalized) && /\b(?:grade|gpa)\b/.test(normalized)),
  },
  { category: 'experience', detect: matchesAny(EXPERIENCE_PATTERNS) },
  { category: 'skill', detect: matchesAny(SKILL_PATTERNS) },
  { category: 'responsibility', detect: matchesAny(RESPONSIBILITY_PATTERNS) },
  {
    category: 'company-description',
    detect: matchesAny(COMPANY_DESCRIPTION_PATTERNS),
  },
  {
    category: 'clearance',
    detect: (normalized) =>
      matchesAny(CLEARANCE_PATTERNS)(normalized) &&
      matchesAny(APPLICANT_DIRECTED_PATTERNS)(normalized),
  },
];

const STRONG_CATEGORIES = new Set<NlpRequirementCategory>([
  'legal-eeo-boilerplate',
  'compensation',
  'benefit',
  'location',
  'work-arrangement',
  'travel',
  'schedule',
  'employment-type',
  'citizenship',
  'education',
  'clearance',
]);

const WEAK_CATEGORIES = new Set<NlpRequirementCategory>([
  'company-description',
  'responsibility',
  'unknown',
]);

export function classifySegment(segment: NlpSegment): SegmentClassification {
  const normalized = normalizeText(segment.text);
  const matched = CATEGORY_RULES.filter((rule) => rule.detect(normalized)).map(
    (rule) => rule.category,
  );

  const finalCategories: NlpRequirementCategory[] = [];
  if (matched.includes('legal-eeo-boilerplate')) {
    finalCategories.push('legal-eeo-boilerplate');
    if (matched.includes('company-description')) {
      finalCategories.push('company-description');
    }
  } else {
    finalCategories.push(...dedupe(matched));
  }
  if (finalCategories.length === 0) {
    finalCategories.push('unknown');
  }
  if (finalCategories.includes('unknown') && finalCategories.length > 1) {
    finalCategories.splice(finalCategories.indexOf('unknown'), 1);
  }

  const confidence = segmentConfidence(finalCategories);
  return {
    segmentIndex: segment.index,
    categories: finalCategories,
    confidence,
    method: 'category-classifier',
    version: NLP_EXTRACTION_VERSION,
    classificationVersion: CATEGORY_CLASSIFIER_VERSION,
  };
}

export function classifySegments(
  segments: NlpSegment[],
): SegmentClassification[] {
  return segments.map(classifySegment);
}

function segmentConfidence(categories: NlpRequirementCategory[]): number {
  if (categories.includes('legal-eeo-boilerplate')) return 0.9;
  const hasStrong = categories.some((category) =>
    STRONG_CATEGORIES.has(category),
  );
  const hasWeak = categories.some((category) => WEAK_CATEGORIES.has(category));
  if (hasStrong && !hasWeak) return 0.85;
  if (hasStrong && hasWeak) return 0.7;
  if (categories.length === 1 && categories[0] === 'unknown') return 0.4;
  return 0.6;
}

function dedupe(values: string[]): NlpRequirementCategory[] {
  return [...new Set(values)] as NlpRequirementCategory[];
}

function matchesAny(
  patterns: readonly RegExp[],
): (normalized: string) => boolean {
  return (normalized: string) =>
    patterns.some((pattern) => pattern.test(normalized));
}

export function asSegmentInputs(
  pieces: readonly { index: number; text: string; kind: NlpSegment['kind'] }[],
): NlpSegment[] {
  return pieces.map((piece) => ({
    index: piece.index,
    text: piece.text,
    normalized: normalizeText(piece.text),
    kind: piece.kind,
    sourceField: 'description' as const,
    charStart: 0,
    charEnd: piece.text.length,
  }));
}
