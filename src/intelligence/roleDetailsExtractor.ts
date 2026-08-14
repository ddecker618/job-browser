import { createHash } from 'node:crypto';

import type { EmploymentType, RemoteType } from '../domain/job.js';
import { normalizeText } from '../utilities/normalization.js';
import { nowUtc } from '../utilities/timestamps.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import {
  ROLE_DETAILS_VERSION,
  type DegreeLevel,
  type RoleDetails,
  type ScheduleFlag,
  type WorkplaceArrangement,
} from '../schemas/role-details.js';
import { extractTermsFromText } from '../skills/skillExtractor.js';
import { classifyWorkArrangement } from '../domain/work-arrangement.js';
import { verifyPosting } from './verificationService.js';

// ---------------------------------------------------------------------------
// Role Details extractor.
//
// Single deterministic extraction boundary that turns retained job evidence
// (description, requirements, preferred qualifications) plus structured
// provider fields into a versioned, auditable RoleDetails document.
//
// Precedence for every fact:
//   1. structured provider evidence (fields normalized by the provider)
//   2. explicit labeled description language
//   3. conservative prose inference
//   4. unknown
//
// No fact is ever inferred from a job title alone, and evidence is always
// recorded so downstream consumers can audit how a value was reached.
// ---------------------------------------------------------------------------

export interface RoleDetailsInput {
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  state: string | null;
  remoteType: RemoteType;
  teleworkEligible: boolean | null;
  employmentType: EmploymentType;
  workSchedule: string | null;
  appointmentType: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
}

const DEGREE_LEVEL_ORDER: readonly { level: DegreeLevel; patterns: RegExp[] }[] =
  [
    {
      level: 'doctorate',
      patterns: [
        /(?:doctorate|doctoral|ph\.?d\.?)\s+degree/i,
        /\bph\.?d\.?\b/i,
      ],
    },
    {
      level: 'master',
      patterns: [
        /master(?:'s)?\s+degree/i,
        /\bm\.s\.\b/i,
        /master(?:'s)?\s+in\s+(?:science|engineering|technology|administration|business)/i,
      ],
    },
    {
      level: 'bachelor',
      patterns: [
        /bachelor(?:'s)?\s+degree/i,
        /\bb\.s\.\b/i,
        /\bb\.a\.\b/i,
      ],
    },
    {
      level: 'associate',
      patterns: [
        /associate(?:'s)?\s+(?:degree|of\s+applied\s+science|certificate)/i,
        /\ba\.a\.\b/i,
        /\ba\.s\.\b/i,
      ],
    },
  ];

const DEGREE_FIELD_PATTERNS: readonly RegExp[] = [
  /degree\s+in\s+([a-z\s&+]{2,40}?)(?:\s+(?:or\s+equivalent|required|is\s+required|preferred)|[,.]|$)/i,
  /(?:computer\s+science|information\s+(?:technology|security|systems)|cybersecurity|engineering|related\s+field)/i,
];

const SUBSTITUTION_PATTERNS: readonly RegExp[] = [
  /or\s+equivalent\s+(?:work\s+)?(?:experience|combination\s+of\s+education\s+and\s+experience|education)/i,
  /equivalent\s+combination\s+of\s+education\s+and\s+experience/i,
  /(?:an\s+)?equivalent\s+combination\b/i,
  /education\s+substitution/i,
  /substitution\s+of\s+education/i,
  /(?:may\s+)?(?:be\s+)?substituted\s+for\s+\d+\s*(?:years?|yrs?)/i,
  /(?:bachelor|master|associate|doctorate|phd)(?:'s)?\s+degree\s+(?:may\s+)?(?:be\s+)?substituted\s+for/i,
];

const CITIZENSHIP_PATTERNS: readonly RegExp[] = [
  /u\.?s\.?\s+citizenship\s+(?:is\s+)?required/i,
  /citizenship\s+required/i,
  /\bmust\s+be\s+(?:a\s+)?(?:u\.?s\.?|united\s+states)\s+citizen/i,
  /\bmust\s+hold\s+(?:u\.?s\.?|united\s+states)\s+citizenship/i,
];

const TRAVEL_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /(\d+)\s*%\s*(?:travel|overnight)/i,
  /travel\s+up\s+to\s+(\d+)\s*%/i,
  /travel\s+(?:of\s+)?(\d+)\s*%/i,
  /travel\s+(?:is\s+)?(?:required|requirement|necessary)/i,
];

const CONTINGENT_ON_AWARD_PATTERNS: readonly RegExp[] = [
  /contingent\s+(?:upon|on)\s+(?:the\s+)?(?:contract|task\s+order|work)\s+award/i,
  /contingent\s+(?:upon|on)\s+award/i,
  /position\s+is\s+contingent\s+(?:upon|on)/i,
];

// Required/Desired section heading detection. Headings are matched as
// standalone labels (line-anchored plain text, HTML block headings, or
// colon-terminated labels) so a single retained description can still be
// split into required vs preferred qualifications deterministically.
const REQUIRED_SECTION_HEADINGS: readonly RegExp[] = [
  /(?:^|\n)\s*(?:required|minimum|essential|core)\s+(?:qualifications?|requirements?|skills?)\s*[:.]?\s*$/mi,
  /<h[1-6][^>]*>\s*(?:required|minimum)\s+(?:qualifications?|requirements?|skills?)\s*<\/h[1-6]>/i,
  /(?:^|\n)\s*(?:required|minimum)\s*(?:qualifications?|requirements?|skills?)\s*[:.]?\s*$/mi,
];

const PREFERRED_SECTION_HEADINGS: readonly RegExp[] = [
  /(?:^|\n)\s*(?:preferred|desired|nice[-\s]?to[-\s]?have|bonus)\s+(?:qualifications?|requirements?|skills?|experience)\s*[:.]?\s*$/mi,
  /<h[1-6][^>]*>\s*(?:preferred|desired|nice[-\s]?to[-\s]?have)\s+(?:qualifications?|requirements?|skills?|experience)\s*<\/h[1-6]>/i,
  /(?:^|\n)\s*(?:preferred|desired)\s*(?:qualifications?|requirements?|skills?|experience)\s*[:.]?\s*$/mi,
];

export function extractRoleDetails(
  input: RoleDetailsInput,
  config: ScoringConfig,
): RoleDetails {
  const text = buildEvidenceText(input);
  const sections = splitQualificationSections(text);
  const configured = extractTermsFromText(text, config.skills).map(
    (term) => term.name,
  );
  const certTerms = extractTermsFromText(
    text,
    config.certifications,
  ).map((term) => term.name);
  const requirementsText =
    input.requirements ?? sections.required ?? text;
  const preferredText = input.preferredQualifications ?? sections.preferred ?? '';
  const requirementsTerms = extractTermsFromText(
    requirementsText,
    config.skills,
  ).map((term) => term.name);
  const preferredTerms = extractTermsFromText(
    preferredText,
    config.skills,
  ).map((term) => term.name);
  const requiredCertTerms = extractTermsFromText(
    requirementsText,
    config.certifications,
  ).map((term) => term.name);
  const preferredCertTerms = extractTermsFromText(
    preferredText,
    config.certifications,
  ).map((term) => term.name);

  const verification = verifyPosting(text, null, null);

  const workplace = classifyWorkplace(input, text);
  const employment = classifyEmployment(input, text);
  const locations = classifyLocations(input, workplace.arrangement);
  const clearance = {
    mode: verification.extractedRequirements.clearanceMode as RoleDetails['clearance']['mode'],
    level: verification.extractedRequirements.clearanceLevel,
    sponsorable: verification.extractedRequirements.clearancesSponsorable,
    evidence: verification.extractedRequirements.clearanceEvidence,
  };
  const education = classifyEducation(
    text,
    verification.extractedRequirements.degreeRequired,
    verification.extractedRequirements.degreeInProgressOk,
  );
  const experience = classifyExperience(text);
  const citizenship = classifyCitizenship(text);
  const travel = classifyTravel(text);

  const flags = scheduleFlags(verification.schedule.classification);
  if (
    verification.schedule.classification === 'unknown' &&
    flags.length === 0 &&
    input.workSchedule !== null
  ) {
    const scheduleText = normalizeText(input.workSchedule);
    if (scheduleText.includes('rotat') && !flags.includes('rotating')) {
      flags.push('rotating');
    }
  }

  const conditions = classifyConditions(text);

  return {
    version: ROLE_DETAILS_VERSION,
    generatedAt: nowUtc(),
    sourceTextHash: hashText(text),
    workplace,
    employment,
    locations,
    clearance,
    education,
    experience,
    skills: {
      required: dedupe(requirementsTerms.length > 0 ? requirementsTerms : configured),
      preferred: dedupe(preferredTerms),
    },
    technologies: dedupe(configured),
    certifications: {
      required: dedupe(requiredCertTerms.length > 0 ? requiredCertTerms : certTerms),
      preferred: dedupe(preferredCertTerms),
    },
    occupationalSeries:
      verification.extractedRequirements.occupationalSeries === null
        ? []
        : [verification.extractedRequirements.occupationalSeries],
    citizenship,
    travel,
    schedule: {
      classification: verification.schedule.classification,
      flags: dedupe(flags) as ScheduleFlag[],
      evidence:
        verification.schedule.evidence.length > 0
          ? verification.schedule.evidence
          : verification.schedule.riskIndicators,
    },
    contingentConditions: {
      commissionBased: verification.extractedRequirements.commissionBased,
      physicalRequirements:
        verification.extractedRequirements.physicalRequirements.length > 0,
      fieldInstallation: verification.extractedRequirements.fieldInstallation,
      developmentFocused: verification.extractedRequirements.developmentFocused,
      professionalEngineering:
        verification.extractedRequirements.professionalEngineering,
      contingentOnAward: conditions.contingentOnAward,
      evidence:
        verification.extractedRequirements.physicalRequirements.length > 0
          ? verification.extractedRequirements.physicalRequirements
          : [
              ...verification.extractedRequirements.professionalEngineeringEvidence,
              ...conditions.evidence,
            ],
    },
  };
}

const EMPLOYMENT_TEXT_PATTERNS: readonly { type: EmploymentType; patterns: RegExp[] }[] =
  [
    {
      type: 'full-time',
      patterns: [
        /full[\s-]?time\b/i,
        /\bforty\s+hours\s+[a-z\s]*per\s+week\b/i,
      ],
    },
    {
      type: 'part-time',
      patterns: [
        /part[\s-]?time\b/i,
        /\bpart\s+time\s*$/i,
      ],
    },
    {
      type: 'contract',
      patterns: [
        /\bcontract\b/i,
        /contractor\s+(?:role|position)/i,
        /\bw-?2\b/i,
        /\b1099\b/i,
      ],
    },
    {
      type: 'temporary',
      patterns: [
        /\btemporary\b/i,
        /\btemp\s+(?:to\s+perm|position|role|assignment)\b/i,
      ],
    },
    {
      type: 'internship',
      patterns: [
        /\binternship\b/i,
        /\bintern\s+(?:role|position|program)\b/i,
      ],
    },
  ];

// ONSITE_EVIDENCE_PATTERNS removed or unused

function classifyEmployment(
  input: RoleDetailsInput,
  text: string,
): RoleDetails['employment'] {
  if (input.employmentType !== 'unknown') {
    return {
      type: input.employmentType,
      source: 'provider',
      evidence: [`Provider employment type: ${input.employmentType}`],
    };
  }
  for (const { type, patterns } of EMPLOYMENT_TEXT_PATTERNS) {
    const evidence = patterns
      .map((pattern) => pattern.exec(text)?.[0])
      .filter((match): match is string => match !== undefined);
    if (evidence.length > 0) {
      return { type, source: 'description', evidence };
    }
  }
  return { type: 'unknown', source: 'unknown', evidence: [] };
}

function classifyWorkplace(
  input: RoleDetailsInput,
  text: string,
): RoleDetails['workplace'] {
  const textResult = classifyWorkArrangement(text);
  const explicitRemoteType =
    input.remoteType === 'remote' || input.remoteType === 'hybrid';

  if (input.remoteType === 'remote') {
    return {
      arrangement: 'remote',
      source: 'provider',
      evidence: [`Provider remote type: ${input.remoteType}`],
    };
  }
  if (input.remoteType === 'hybrid') {
    return {
      arrangement: 'hybrid',
      source: 'provider',
      evidence: [`Provider remote type: ${input.remoteType}`],
    };
  }
  if (input.teleworkEligible === true) {
    const arrangement: WorkplaceArrangement =
      textResult.arrangement === 'remote' ? 'remote' : 'hybrid';
    return {
      arrangement,
      source: 'provider',
      evidence: [
        'Provider telework eligible: true',
        ...textResult.evidence.slice(0, 2),
      ],
    };
  }
  if (explicitRemoteType) {
    return {
      arrangement: input.remoteType as WorkplaceArrangement,
      source: 'provider',
      evidence: [`Provider remote type: ${input.remoteType}`],
    };
  }
  if (input.teleworkEligible === false && input.remoteType === 'onsite') {
    return {
      arrangement: 'onsite',
      source: 'provider',
      evidence: ['Provider telework eligible: false'],
    };
  }
  if (textResult.arrangement !== 'unknown') {
    return {
      arrangement: textResult.arrangement,
      source: 'description',
      evidence: textResult.evidence,
    };
  }
  return {
    arrangement: 'unknown',
    source: 'unknown',
    evidence: [],
  };
}

function classifyLocations(
  input: RoleDetailsInput,
  arrangement: WorkplaceArrangement,
): RoleDetails['locations'] {
  const evidence: string[] = [];
  const primaryCity =
    input.city ??
    (input.location ? parseLocationCityState(input.location).city : null);
  const primaryState =
    input.state ??
    (input.location ? parseLocationCityState(input.location).state : null);

  const multiple =
    input.location !== null &&
    /(?:;\s|[;/]|\band\b|multiple\s+locations|,\s+[A-Z]{2},\s)/i.test(
      input.location,
    );

  if (input.city !== null || input.state !== null) {
    evidence.push('Provider location fields');
  } else if (input.location !== null) {
    evidence.push(`Provider location: ${input.location}`);
  }

  return {
    primaryCity,
    primaryState,
    remoteCapable: arrangement === 'remote' || arrangement === 'hybrid',
    multiple,
    evidence,
  };
}

function parseLocationCityState(
  location: string,
): { city: string | null; state: string | null } {
  if (/remote/i.test(location)) return { city: null, state: null };
  const match = /^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s*$/.exec(location);
  if (match?.[1] && match[2]) {
    return { city: match[1].trim(), state: match[2].trim().toUpperCase() };
  }
  return { city: null, state: null };
}

function classifyEducation(
  text: string,
  degreeRequired: boolean,
  degreeInProgressOk: boolean,
): RoleDetails['education'] {
  const evidence: string[] = [];
  let field: string | null = null;
  for (const pattern of DEGREE_FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      field = normalizeText(match[1]);
      evidence.push(match[0]);
      break;
    }
  }

  const inferred = inferDegreeLevel(text);
  const preferredOnly =
    !degreeRequired &&
    /(?:degree|bachelor|master|associate|doctorate|phd)\s+preferred|preferred\s+(?:is\s+)?(?:a\s+)?(?:bachelor|master|associate|doctorate|phd)\s+degree/i.test(
      text,
    );
  const required = degreeRequired || (inferred !== 'unknown' && !preferredOnly);

  if (preferredOnly) {
    evidence.push('Degree preferred, not required');
  }

  return {
    degreeRequired: required ? inferred : 'none',
    degreeInProgressOk,
    field,
    evidence,
  };
}

function inferDegreeLevel(text: string): DegreeLevel {
  for (const { level, patterns } of DEGREE_LEVEL_ORDER) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return level;
    }
  }
  return 'unknown';
}

function classifyExperience(
  text: string,
): RoleDetails['experience'] {
  const requiredYears = extractYears(text, [
    /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience\s+(?:is\s+)?required/i,
    /requires?\s+(?:at\s+least\s+)?(\d+)\+?\s*(?:years?|yrs?)/i,
    /minimum\s+of\s+(\d+)\+?\s*(?:years?|yrs?)/i,
    /(?:bachelor|master|associate|doctorate|phd)(?:'s)?\s+degree[^.]*?plus\s+(\d+)\+?\s*(?:years?|yrs?)/i,
    /plus\s+(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience/i,
    /(\d+)\+?\s*(?:years?|yrs?)\s+of\s+(?:relevant\s+)?[a-z][a-z\s-]{2,40}?\s+experience\b(?!\s+(?:is\s+)?preferred)/i,
  ]);
  const preferredYears = extractYears(text, [
    /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\s+(?:is\s+)?preferred/i,
    /(\d+)\+?\s*years?\s+preferred/i,
    /preferably\s+(?:with\s+)?(\d+)\+?\s*(?:years?|yrs?)/i,
  ]);

  const substitution = findMatches(text, SUBSTITUTION_PATTERNS);
  const evidence = [
    ...(requiredYears === null
      ? []
      : [`Required experience: ${String(requiredYears)} years`]),
    ...(preferredYears === null
      ? []
      : [`Preferred experience: ${String(preferredYears)} years`]),
    ...substitution,
  ];

  return {
    requiredYears,
    preferredYears,
    substitution,
    evidence,
  };
}

function classifyCitizenship(text: string): RoleDetails['citizenship'] {
  const evidence = findMatches(text, CITIZENSHIP_PATTERNS);
  return {
    usCitizenRequired: evidence.length > 0,
    evidence,
  };
}

function classifyTravel(text: string): RoleDetails['travel'] {
  const evidence = findMatches(text, TRAVEL_EVIDENCE_PATTERNS);
  const percent = extractTravelPercent(text);
  return {
    required: evidence.length > 0,
    percent,
    evidence,
  };
}

function scheduleFlags(classification: string): ScheduleFlag[] {
  switch (classification) {
    case 'weekend':
      return ['weekends'];
    case 'onCall':
      return ['onCall'];
    case 'rotating':
      return ['rotating'];
    case 'overnight':
      return ['overnight'];
    case 'evening':
      return ['evening'];
    default:
      return [];
  }
}

function classifyConditions(text: string): {
  contingentOnAward: boolean;
  evidence: string[];
} {
  const evidence = findMatches(text, CONTINGENT_ON_AWARD_PATTERNS);
  return {
    contingentOnAward: evidence.length > 0,
    evidence,
  };
}

function splitQualificationSections(
  text: string,
): { required: string | null; preferred: string | null } {
  const requiredHeading = findSectionHeading(text, REQUIRED_SECTION_HEADINGS);
  const preferredHeading = findSectionHeading(
    text,
    PREFERRED_SECTION_HEADINGS,
  );

  if (requiredHeading === null && preferredHeading === null) {
    return { required: null, preferred: null };
  }

  let required: string | null = null;
  let preferred: string | null = null;

  if (preferredHeading !== null) {
    preferred = text.slice(preferredHeading.end).trim();
    if (requiredHeading !== null && requiredHeading.start < preferredHeading.start) {
      required = text
        .slice(requiredHeading.end, preferredHeading.start)
        .trim();
    }
  }
  if (required === null && requiredHeading !== null) {
    required = text.slice(requiredHeading.end).trim();
  }

  return {
    required: required === '' ? null : required,
    preferred: preferred === '' ? null : preferred,
  };
}

function findSectionHeading(
  text: string,
  headings: readonly RegExp[],
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const pattern of headings) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = match.index;
    const candidate = {
      start,
      end: start + match[0].length,
    };
    if (best === null || start < best.start) best = candidate;
  }
  return best;
}

function buildEvidenceText(input: RoleDetailsInput): string {
  const parts: string[] = [`${input.title} at ${input.company}`];
  if (input.location !== null) parts.push(`Location: ${input.location}`);
  if (input.description !== null) parts.push(input.description);
  if (input.requirements !== null) parts.push(input.requirements);
  if (input.preferredQualifications !== null)
    parts.push(input.preferredQualifications);
  return parts.join('\n\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function extractYears(
  text: string,
  patterns: readonly RegExp[],
): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const years = parseInt(match[1], 10);
      if (!isNaN(years)) return years;
    }
  }
  return null;
}

function extractTravelPercent(text: string): number | null {
  const patterns = [
    /(\d+)\s*%\s*(?:travel|overnight)/i,
    /travel\s+up\s+to\s+(\d+)\s*%/i,
    /travel\s+(?:of\s+)?(\d+)\s*%/i,
    /up\s+to\s+(\d+)\s*%\s+travel/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const pct = parseInt(match[1], 10);
      if (!isNaN(pct)) return pct;
    }
  }
  return null;
}

function findMatches(text: string, patterns: readonly RegExp[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) results.push(match[0]);
  }
  return results;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}