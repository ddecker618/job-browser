import {
  NLP_EXTRACTION_VERSION,
  type NlpSegment,
} from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 11 - boilerplate and non-requirement filtering.
//
// This classifier identifies likely non-requirement content for later
// reconciliation. It never removes a segment, and it deliberately preserves
// applicant-directed requirements and real soft-skill statements.
// ---------------------------------------------------------------------------

export const BOILERPLATE_INTELLIGENCE_VERSION = 'boilerplate-intelligence-v1';

export type BoilerplateKind =
  | 'eeo'
  | 'benefits'
  | 'marketing'
  | 'legal'
  | 'accommodation'
  | 'compensation'
  | 'culture'
  | 'company-description';

export type BoilerplateDisposition =
  | 'boilerplate'
  | 'requirement'
  | 'mixed'
  | 'unknown';

export interface BoilerplateSignal {
  kind: BoilerplateKind;
  raw: string;
  span: { start: number; end: number };
}

export interface BoilerplateExtraction {
  segmentIndex: number;
  kinds: BoilerplateKind[];
  signals: BoilerplateSignal[];
  requirementSignals: string[];
  disposition: BoilerplateDisposition;
  isBoilerplate: boolean;
  preserveRequirement: boolean;
  confidence: number;
  method: 'segment-rules';
  version: typeof NLP_EXTRACTION_VERSION;
  boilerplateVersion: typeof BOILERPLATE_INTELLIGENCE_VERSION;
}

interface PatternRule {
  kind: BoilerplateKind;
  patterns: readonly RegExp[];
}

const BOILERPLATE_RULES: readonly PatternRule[] = [
  {
    kind: 'eeo',
    patterns: [
      /equal\s+(?:employment\s+)?opportunity\s+employer/i,
      /affirmative\s+action/i,
      /protected\s+veteran/i,
      /individuals?\s+with\s+disabilities/i,
      /drug[- ]free\s+workplace/i,
      /at[- ]will\s+employment/i,
      /section\s+503\b/i,
    ],
  },
  {
    kind: 'accommodation',
    patterns: [
      /reasonable\s+accommodations?/i,
      /contact\s+(?:human\s+resources|hr)\b/i,
      /accommodations?\s+are\s+available/i,
    ],
  },
  {
    kind: 'benefits',
    patterns: [
      /(?:health|medical|dental|vision|life)\s+(?:insurance|coverage|benefits?)/i,
      /\bemployee\s+benefits?\b/i,
      /\b401\s*\(?k\)?\b/i,
      /\b(?:paid\s+time\s+off|pto|vacation|paid\s+holidays?|parental\s+leave|sick\s+leave)\b/i,
      /\b(?:wellness|tuition|commuter|employee\s+assistance)\s+(?:benefit|program|reimbursement)/i,
    ],
  },
  {
    kind: 'compensation',
    patterns: [
      /\b(?:salary|pay|compensation)\s+(?:range|band|rate)\b/i,
      /\b(?:compensation|payroll)\b/i,
      /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:-|to)\s*\$?\s?\d[\d,]*(?:\.\d+)?/i,
      /\b(?:hourly|annual)\s+(?:rate|salary|pay)\b/i,
      /\b(?:bonus|commission|equity|stock\s+options?)\b/i,
    ],
  },
  {
    kind: 'legal',
    patterns: [
      /\bbackground\s+(?:check|investigation)s?\b/i,
      /\bdrug\s+(?:screen|test|screening)s?\b/i,
      /\bemployment\s+verification\b/i,
      /\bconfidentiality\s+(?:agreement|obligation)\b/i,
      /\bsubject\s+to\s+(?:a\s+)?(?:background|drug)\b/i,
      /\barbitration\b/i,
      /\bright\s+to\s+work\b/i,
    ],
  },
  {
    kind: 'marketing',
    patterns: [
      /\bwe\s+are\s+(?:a|an)\s+(?:leading|award[- ]winning|innovative|global)\b/i,
      /\bjoin\s+our\s+(?:mission|team|journey)\b/i,
      /\b(?:our|the\s+company's?)\s+mission\b/i,
      /\b(?:industry|market)\s+leader\b/i,
      /\bmake\s+an\s+impact\b/i,
      /\babout\s+us\b/i,
    ],
  },
  {
    kind: 'culture',
    patterns: [
      /\b(?:our|a)\s+(?:company\s+)?culture\b/i,
      /\bcompany\s+values?\b/i,
      /\bwe\s+value\b/i,
      /\b(?:inclusive|collaborative|fast[- ]paced|team[- ]oriented)\s+culture\b/i,
      /\bwork[- ]life\s+balance\b/i,
    ],
  },
  {
    kind: 'company-description',
    patterns: [
      /\bwe\s+(?:build|create|develop|provide|deliver|serve)\b/i,
      /\bwe\s+are\s+(?:a|an|the)\s+(?:(?:leading|global|innovative)\s+)?(?:company|organization|business|team)\b/i,
      /\b(?:our|the)\s+(?:team|company|organization|business)\b/i,
      /\bemployee[- ]owned\b/i,
    ],
  },
];

const REQUIREMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:required|mandatory|minimum|must|shall|need(?:s)?\s+to)\b/i,
  /\b(?:candidate|applicant)s?\s+(?:should|must|will)\b/i,
  /\b(?:experience|proficiency|knowledge|familiarity|ability)\s+(?:with|in|to)\b/i,
  /\b(?:responsible\s+for|manage|administer|configure|develop|maintain|support|lead|coordinate|perform)\b/i,
];

const SOFT_SKILL_REQUIREMENT_PATTERN =
  /\b(?:excellent|strong|effective|good)\s+(?:communication|collaboration|teamwork|leadership|organizational|interpersonal)\s+skills?\b|\b(?:communication|collaboration|teamwork|leadership|organizational|interpersonal)\s+skills?\b/i;

export function extractBoilerplate(segment: NlpSegment): BoilerplateExtraction {
  const signals: BoilerplateSignal[] = [];
  for (const rule of BOILERPLATE_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(segment.text);
      if (match === null) continue;
      signals.push({
        kind: rule.kind,
        raw: match[0],
        span: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  const requirementSignals = collectRequirementSignals(segment.text);
  const kinds = uniqueKinds(signals);
  const preserveRequirement = requirementSignals.length > 0;
  const isBoilerplate = kinds.length > 0 && !preserveRequirement;
  const disposition = getDisposition(kinds, preserveRequirement);
  const confidence =
    kinds.length === 0 && !preserveRequirement
      ? 0.4
      : preserveRequirement && kinds.length > 0
        ? 0.8
        : 0.9;

  return {
    segmentIndex: segment.index,
    kinds,
    signals,
    requirementSignals,
    disposition,
    isBoilerplate,
    preserveRequirement,
    confidence,
    method: 'segment-rules',
    version: NLP_EXTRACTION_VERSION,
    boilerplateVersion: BOILERPLATE_INTELLIGENCE_VERSION,
  };
}

export function extractBoilerplateBatch(
  segments: readonly NlpSegment[],
): BoilerplateExtraction[] {
  return segments.map((segment) => extractBoilerplate(segment));
}

function collectRequirementSignals(text: string): string[] {
  const signals = REQUIREMENT_PATTERNS.map(
    (pattern) => pattern.exec(text)?.[0],
  ).filter((match): match is string => match !== undefined);
  const softSkill = SOFT_SKILL_REQUIREMENT_PATTERN.exec(text)?.[0];
  if (softSkill !== undefined) signals.push(softSkill);
  return [...new Set(signals)];
}

function uniqueKinds(signals: readonly BoilerplateSignal[]): BoilerplateKind[] {
  return [...new Set(signals.map((signal) => signal.kind))];
}

function getDisposition(
  kinds: readonly BoilerplateKind[],
  preserveRequirement: boolean,
): BoilerplateDisposition {
  if (kinds.length === 0) {
    return preserveRequirement ? 'requirement' : 'unknown';
  }
  return preserveRequirement ? 'mixed' : 'boilerplate';
}
