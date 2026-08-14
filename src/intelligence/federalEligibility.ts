// Deterministic federal qualification and clearance classification.
//
// These rules are intentionally conservative:
// - They only fire on explicit retained evidence (occupational series, ABET,
//   professional-engineering curriculum language, active-clearance wording).
// - Ambiguous language is never a hard block.
// - Nothing here assumes a clearance from military background or job title.

// ---------------------------------------------------------------------------
// Occupational series.
// ---------------------------------------------------------------------------

const SERIES_PATTERNS: readonly RegExp[] = [
  /job\s+family\s*\(?series?\)?\s*[:.]?\s*(\d{4})/i,
  /\(?series?\)?\s*[:.]?\s*(\d{4})\s+[a-z]+(?:\s+engineering)?/i,
  /occupational\s+series\s*[:.]?\s*(\d{4})/i,
];

/** Returns the four-digit occupational series when explicitly present. */
export function extractOccupationalSeries(text: string): string | null {
  for (const pattern of SERIES_PATTERNS) {
    const match = text.match(pattern);
    const value = match?.[1];
    if (value && /^\d{4}$/.test(value)) {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Professional engineering basic qualification (federal IOR).
// ---------------------------------------------------------------------------

/**
 * Explicit professional-engineering basic-qualification evidence.
 *
 * `explicit` is true only when the retained text unambiguously requires a
 * professional-engineering basic qualification (ABET-accredited engineering
 * program, calculus + engineering science, PE registration, or the 0854 series
 * label). Ordinary "software engineer" titles and vague engineering language
 * never set this flag.
 */
export interface ProfessionalEngineeringQualification {
  explicit: boolean;
  occupationalSeries: string | null;
  evidence: string[];
}

const ABET_PATTERNS: readonly RegExp[] = [
  /abet[- ]accredited\s+(?:professional\s+)?engineering/i,
  /accredited\s+engineering\s+(?:degree|program|curriculum)/i,
  /engineering\s+(?:degree|program|curriculum)\s+accredited/i,
];

const CALCULUS_ENGINEERING_SCIENCE_PATTERNS: readonly RegExp[] = [
  /(?:differential\s+and\s+integral\s+calculus|calculus).{0,120}engineering\s+science/i,
  /engineering\s+science.{0,120}(?:calculus|differential)/i,
];

const PE_REGISTRATION_PATTERNS: readonly RegExp[] = [
  /professional\s+engineering\s+(?:registration|license|licensure)/i,
  /\bpe\s+license\b/i,
  /fundamentals\s+of\s+engineering/i,
];

const BASIC_REQUIREMENT_PATTERNS: readonly RegExp[] = [
  /basic\s+requirement\s*[:.].{0,200}engineering/i,
  /individual\s+occupational\s+requirement\s*[:.].{0,200}engineering/i,
];

const ENGINEERING_CURRICULUM_PATTERNS: readonly RegExp[] = [
  /accredited\s+professional\s+engineering\s+curriculum/i,
  /professional\s+engineering\s+curriculum/i,
];

/**
 * Returns true when explicit basic-qualification wording is immediately
 * followed by "preferred" / "desired" / "nice to have" within a small window.
 */
function softenedByPreference(
  text: string,
  patterns: readonly RegExp[],
): boolean {
  for (const pattern of patterns) {
    for (const match of text.matchAll(asGlobal(pattern))) {
      const start = match.index;
      const windowEnd = Math.min(text.length, start + match[0].length + 120);
      const following = text.slice(start, windowEnd);
      if (
        /\b(preferred|preferable|desired|nice\s+to\s+have|helpful|ideal)\b/i.test(
          following,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function classifyProfessionalEngineeringBasicQualification(
  text: string,
): ProfessionalEngineeringQualification {
  const evidence: string[] = [];

  const add = (patterns: readonly RegExp[]): void => {
    for (const pattern of patterns) {
      for (const match of text.matchAll(asGlobal(pattern))) {
        evidence.push(match[0]);
      }
    }
  };

  const series = extractOccupationalSeries(text);
  if (series === '0854') {
    evidence.push('Occupational series 0854 (Computer Engineering)');
  }

  add(ABET_PATTERNS);
  add(CALCULUS_ENGINEERING_SCIENCE_PATTERNS);
  add(PE_REGISTRATION_PATTERNS);
  add(BASIC_REQUIREMENT_PATTERNS);
  add(ENGINEERING_CURRICULUM_PATTERNS);

  const uniqueEvidence = [...new Set(evidence)];
  if (uniqueEvidence.length === 0) {
    return {
      explicit: false,
      occupationalSeries: series,
      evidence: [],
    };
  }

  // Any candidate evidence immediately softened by "preferred"/"desired" is
  // ambiguous and must not become a hard block.
  const evidencePatterns = [
    ...ABET_PATTERNS,
    ...CALCULUS_ENGINEERING_SCIENCE_PATTERNS,
    ...PE_REGISTRATION_PATTERNS,
    ...BASIC_REQUIREMENT_PATTERNS,
    ...ENGINEERING_CURRICULUM_PATTERNS,
  ];
  const ambiguous =
    softenedByPreference(text, evidencePatterns) ||
    softenedByPreference(text, [/(?:professional\s+)?engineering/i]);
  if (ambiguous) {
    return {
      explicit: false,
      occupationalSeries: series,
      evidence: uniqueEvidence,
    };
  }

  // 0854 series alone is an explicit professional-engineering signal.
  const explicit = series === '0854' || uniqueEvidence.length > 0;
  return {
    explicit,
    occupationalSeries: series,
    evidence: uniqueEvidence,
  };
}

// ---------------------------------------------------------------------------
// Clearance classification.
// ---------------------------------------------------------------------------

export type ClearanceMode =
  | 'active'
  | 'obtainable'
  | 'eligible'
  | 'public-trust'
  | 'ambiguous'
  | 'none';

export interface ClearanceClassification {
  mode: ClearanceMode;
  level: string | null;
  evidence: string[];
}

const ACTIVE_CLEARANCE_PATTERNS: readonly RegExp[] = [
  /(?:active|currently|current)\s+(?:top\s+secret|ts\/sci|secret)\s+clearance/i,
  /active\s+(?:security\s+)?clearance\s+(?:is\s+)?required/i,
  /must\s+(?:have|hold|possess)\s+(?:an?\s+)?active\s+(?:security\s+)?clearance/i,
  /currently\s+(?:hold|possess|maintain)\s+(?:an?\s+)?(?:active\s+)?(?:security\s+)?clearance/i,
  /must\s+currently\s+possess/i,
];

const OBTAINABLE_CLEARANCE_PATTERNS: readonly RegExp[] = [
  /(?:able|willing)\s+to\s+(?:obtain|sponsor|process|acquire)/i,
  /sponsorship\s+(?:is\s+)?(?:available|provided|offered)/i,
  /clearance\s+(?:sponsorship|processing)\s+(?:is\s+)?(?:available|provided)/i,
  /may\s+be\s+eligible\s+to\s+obtain/i,
];

const ELIGIBLE_CLEARANCE_PATTERNS: readonly RegExp[] = [
  /eligible\s+for\s+(?:an?\s+)?(?:security\s+)?clearance/i,
  /clearance\s+eligibility/i,
];

const PUBLIC_TRUST_PATTERNS: readonly RegExp[] = [
  /public\s+trust\s+(?:clearance|position|determination)/i,
];

const CLEARANCE_LEVEL_PATTERNS: readonly RegExp[] = [
  /\bts\/sci\b/i,
  /\btop\s+secret\b/i,
  /\bsecret\s+clearance\b/i,
  /\bconfidential\s+clearance\b/i,
];

function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function asGlobal(pattern: RegExp): RegExp {
  return pattern.flags.includes('g')
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

function collectMatches(text: string, patterns: readonly RegExp[]): string[] {
  const collected: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(asGlobal(pattern))) {
      collected.push(match[0]);
    }
  }
  return [...new Set(collected)];
}

/**
 * Classifies explicit clearance wording.
 *
 * Only `active` is a hard-eligibility signal. "Ability to obtain", "eligible
 * for", "public trust", and ambiguous wording are all non-blocking.
 */
export function classifyActiveClearance(text: string): ClearanceClassification {
  const active = firstMatch(text, ACTIVE_CLEARANCE_PATTERNS);
  const obtainable = firstMatch(text, OBTAINABLE_CLEARANCE_PATTERNS);
  const eligible = firstMatch(text, ELIGIBLE_CLEARANCE_PATTERNS);
  const publicTrust = firstMatch(text, PUBLIC_TRUST_PATTERNS);
  const level = firstMatch(text, CLEARANCE_LEVEL_PATTERNS);

  const evidence = [
    ...collectMatches(text, ACTIVE_CLEARANCE_PATTERNS),
    ...collectMatches(text, OBTAINABLE_CLEARANCE_PATTERNS),
    ...collectMatches(text, ELIGIBLE_CLEARANCE_PATTERNS),
    ...collectMatches(text, PUBLIC_TRUST_PATTERNS),
    ...collectMatches(text, CLEARANCE_LEVEL_PATTERNS),
  ];
  const uniqueEvidence = [...new Set(evidence)];

  // Public trust is not an active national-security clearance.
  if (publicTrust && !active) {
    return {
      mode: 'public-trust',
      level,
      evidence: uniqueEvidence,
    };
  }
  if (active) {
    return {
      mode: 'active',
      level,
      evidence: uniqueEvidence,
    };
  }
  if (obtainable) {
    return {
      mode: 'obtainable',
      level,
      evidence: uniqueEvidence,
    };
  }
  if (eligible) {
    return {
      mode: 'eligible',
      level,
      evidence: uniqueEvidence,
    };
  }
  if (collectMatches(text, [/\bclearance\b/i]).length > 0) {
    return {
      mode: 'ambiguous',
      level,
      evidence: uniqueEvidence,
    };
  }
  return {
    mode: 'none',
    level: null,
    evidence: [],
  };
}
