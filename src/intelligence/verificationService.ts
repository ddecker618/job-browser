import type {
  VerificationEvidence,
  WorkArrangement,
  ScheduleType,
  ScheduleEvidence,
  IllinoisEligibility,
  EligibilityResult,
} from '../domain/verification.js';
import { nowUtc } from '../utilities/timestamps.js';

export interface VerificationResult {
  evidence: VerificationEvidence;
  workArrangement: WorkArrangement;
  workArrangementEvidence: string[];
  illinoisEligibility: IllinoisEligibility;
  illinoisEvidence: string[];
  schedule: ScheduleEvidence;
  eligibility: EligibilityResult;
  extractedRequirements: {
    requiredYears: number | null;
    preferredYears: number | null;
    degreeRequired: boolean;
    degreeInProgressOk: boolean;
    clearancesRequired: string[];
    clearancesSponsorable: boolean;
    travelRequired: boolean;
    travelPercent: number | null;
    physicalRequirements: string[];
    commissionBased: boolean;
    developmentFocused: boolean;
    fieldInstallation: boolean;
    weekendsRequired: boolean;
    onCallRequired: boolean;
    rotatingShifts: boolean;
    overnightRequired: boolean;
  };
}

const CLOSED_INDICATORS = [
  /job\s+(no\s+longer\s+)?(?:is\s+)?(?:no\s+longer\s+)?(available|filled|accepting\s+applications)/i,
  /(?:this\s+)?position\s+(has been\s+)?filled/i,
  /(?:no\s+longer\s+)?accepting\s+applications/i,
  /requisition\s+closed/i,
  /application\s+deadline\s+has\s+passed/i,
  /sorry,?\s+this\s+(position|job|requisition)\s+(has\s+)?(closed|filled|expired)/i,
];

const ONSITE_EVIDENCE = [
  /this\s+is\s+not\s+a\s+remote\s+position/i,
  /not\s+a\s+remote\s+(role|job|opportunity)/i,
  /must\s+(?:live|reside|be\s+located)\s+within\s+(?:commuting\s+)?distance/i,
  /must\s+report\s+to\s+(?:the\s+)?office/i,
  /work\s+from\s+our\s+office/i,
  /local\s+candidates?\s+only/i,
  /on[- ]?site\s+(?:five|5)\s+days\s+per\s+week/i,
  /in[- ]?office\s+(?:five|5)\s+days/i,
  /relocation\s+(?:assistance\s+)?is\s+not\s+available/i,
];

const HYBRID_EVIDENCE = [
  /\bhybrid\b/i,
  /three\s+days?\s+(?:per\s+week|a\s+week|in\s+the\s+office)/i,
  /two\s+days?\s+(?:per\s+week|a\s+week|in\s+the\s+office)/i,
  /mix\s+of\s+(?:in[- ]?office|on[- ]?site)\s+and\s+remote/i,
  /split\s+(?:week|time)\s+between/i,
  /flexible\s+(?:remote|work\s+from\s+home)\s+(?:policy|arrangement)/i,
  /some\s+(?:days?\s+)?in\s+(?:the\s+)?office/i,
];

const REMOTE_EVIDENCE = [
  /\b(?:fully\s+)?remote\b(?!\s+(?:support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics))/i,
  /work\s+(?:from\s+)?home/i,
  /telecommute/i,
  /remote\s+(?:position|role|job|opportunity|work)/i,
  /anywhere\s+in\s+(?:the\s+)?(?:us|united\s+states)/i,
  /nationwide\s+remote/i,
  /remote\s+first/i,
  /100%\s+remote/i,
  /fully\s+distributed/i,
];

const REMOTE_TECH_LANGUAGE = [
  /\bremote\s+(support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics)\b/i,
];

const ILLINOIS_INCLUDED = [
  /illinois/i,
  /il\b(?!\s+(?:only|exclu))/i,
  /all\s+(?:50\s+)?states/i,
  /nationwide/i,
  /anywhere\s+in\s+(?:the\s+)?(?:us|united\s+states)/i,
  /remote\s+(?:in\s+)?(?:the\s+)?(?:us|united\s+states)/i,
];

const ILLINOIS_EXCLUDED = [
  /not\s+(?:available\s+in|open\s+to)\s+illinois/i,
  /excludes?\s+illinois/i,
  /except\s+illinois/i,
  /illinois\s+excluded/i,
  /cannot\s+(?:reside|work)\s+in\s+illinois/i,
];

const SCHEDULE_POSITIVE = [
  /monday\s+(?:through|to|[-])\s+friday/i,
  /(?:standard|normal|regular|core)\s+business\s+hours/i,
  /first\s+shift/i,
  /day\s+shift/i,
  /no\s+nights/i,
  /no\s+weekends/i,
  /no\s+on[-]?call/i,
  /daytime\s+(?:hours|schedule)/i,
  /weekdays?\s+only/i,
];

const SCHEDULE_RISK = [
  /24\/7/i,
  /rotating\s+(?:shifts?|schedule)/i,
  /nights?,\s+weekends?\s+(?:and|&)\s+holidays/i,
  /(?:regular|mandatory|required)\s+on[-]?call/i,
  /follow[- ]?the[- ]?sun/i,
  /schedule\s+(?:based\s+on|determined\s+by|assigned\s+after)/i,
  /shift\s+(?:work|differential|assignment)/i,
  /overnight\s+shift/i,
  /night\s+shift/i,
  /evening\s+shift/i,
  /weekend\s+(?:coverage|work|shift)/i,
  /on[-]?call\s+(?:rotation|schedule|duty)/i,
];

const EXPERIENCE_REQUIRED = [
  /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience\s+(?:is\s+)?required/i,
  /requires?\s+(?:at\s+least\s+)?(\d+)\+?\s*(?:years?|yrs?)/i,
  /minimum\s+of\s+(\d+)\+?\s*(?:years?|yrs?)/i,
];

const EXPERIENCE_PREFERRED = [
  /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\s+(?:is\s+)?preferred/i,
  /(\d+)\+?\s*(?:years?|yrs?)\s+preferred/i,
  /preferably\s+(?:with\s+)?(\d+)\+?\s*(?:years?|yrs?)/i,
];

const DEGREE_REQUIRED = [
  /(?:bachelor|master|associate|doctorate|phd)\s+(?:'?s\s+)?degree\s+(?:is\s+)?required/i,
  /requires?\s+(?:a\s+)?(?:bachelor|master|associate|doctorate|phd)/i,
  /(?:bachelor|master|associate|doctorate|phd)\s+(?:degree\s+)?(?:or\s+equivalent\s+)?required/i,
  /degree\s+in\s+(?:computer\s+science|information\s+(?:technology|security|systems)|cybersecurity|engineering|related\s+field)\s+required/i,
];

const DEGREE_IN_PROGRESS_OK = [
  /(?:in\s+progress|pursuing|currently\s+enrolled)\s+(?:toward\s+)?(?:a\s+)?degree/i,
  /or\s+equivalent\s+(?:work\s+)?experience/i,
  /(?:years?|yrs?)\s+of\s+experience\s+(?:may\s+)?(?:substitute|replace|suffice)/i,
];

const TRAVEL = [
  /(\d+)\s*%\s*(?:travel|overnight)/i,
  /travel\s+(?:of\s+)?(\d+)\s*%/i,
  /up\s+to\s+(\d+)\s*%\s+travel/i,
  /travel\s+(?:required|requirement|necessary)/i,
];

const PHYSICAL = [
  /(?:heavy\s+)?(?:lifting|lift)\s+(?:up\s+to\s+)?\d+/i,
  /ability\s+to\s+lift\s+\d+/i,
  /climb\s+(?:ladders?|towers?|poles?)/i,
  /work\s+(?:at\s+heights|on\s+(?:a\s+)?ladder)/i,
  /(?:extensive|heavy|frequent)\s+(?:cabling|wiring)/i,
  /field\s+(?:installation|work|service|technician)/i,
  /tower\s+(?:work|climbing)/i,
];

const COMMISSION = [
  /commission[-\s]?(?:based|only|driven|heavy)/i,
  /(?:100%\s+)?commission\s+(?:structure|pay|compensation)/i,
];

const DEVELOPMENT = [
  /(?:software|full[-\s]?stack|back[-\s]?end|front[-\s]?end)\s+(?:engineer|developer|architect)/i,
  /(?:develop|build|write|coding)\s+(?:software|applications?|features?|code)/i,
  /software\s+development\s+(?:lifecycle|life\s+cycle|process)/i,
  /agile\s+(?:development|methodology|software)/i,
];

const CLEARANCE_REQUIRED = [
  /active\s+(?:security\s+)?clearance\s+(?:is\s+)?required/i,
  /must\s+(?:have|hold|possess)\s+(?:an?\s+)?active\s+(?:security\s+)?clearance/i,
  /(?:top\s+secret|secret|ts\/sci)\s+clearance\s+required/i,
  /clearance\s+requirement/i,
];

const CLEARANCE_SPONSORABLE = [
  /(?:able|willing)\s+to\s+(?:sponsor|obtain|process)/i,
  /(?:sponsorship|sponsor)\s+(?:is\s+)?(?:available|provided|offered)/i,
  /(?:clearance|security\s+clearance)\s+(?:sponsorship|processing)\s+(?:is\s+)?(?:available|provided)/i,
];

export function verifyPosting(
  text: string,
  url: string | null,
  httpStatus: number | null,
): VerificationResult {
  const now = nowUtc();
  const closedIndicators = findMatches(text, CLOSED_INDICATORS);
  const isClosed = closedIndicators.length > 0;
  const evidence: VerificationEvidence = {
    status: isClosed
      ? 'closed'
      : httpStatus !== null && httpStatus >= 200 && httpStatus < 400
        ? 'verified'
        : 'unverified',
    verifiedAt: now,
    verificationSource: url ?? 'unknown',
    httpStatus,
    applicationStatus: isClosed ? 'closed' : null,
    evidence: [],
    closedIndicators,
  };

  const workArrangementResult = classifyWorkArrangement(text);
  const illinoisResult = classifyIllinoisEligibility(
    text,
    workArrangementResult.arrangement,
  );
  const scheduleResult = classifySchedule(text);

  const eligibility = evaluateEligibility(
    text,
    workArrangementResult.arrangement,
    illinoisResult.eligibility,
    scheduleResult.classification,
  );

  const requirements = extractStructuredRequirements(text);

  return {
    evidence,
    workArrangement: workArrangementResult.arrangement,
    workArrangementEvidence: workArrangementResult.evidence,
    illinoisEligibility: illinoisResult.eligibility,
    illinoisEvidence: illinoisResult.evidence,
    schedule: scheduleResult,
    eligibility,
    extractedRequirements: requirements,
  };
}

function classifyWorkArrangement(text: string): {
  arrangement: WorkArrangement;
  evidence: string[];
} {
  const hasOnsite = findMatches(text, ONSITE_EVIDENCE).length > 0;
  const hasTechLang = findMatches(text, REMOTE_TECH_LANGUAGE).length > 0;
  const hasRemote = findMatches(text, REMOTE_EVIDENCE).length > 0;
  const hasHybrid = findMatches(text, HYBRID_EVIDENCE).length > 0;

  if (hasOnsite) {
    return {
      arrangement: 'onsite',
      evidence: ['Strong onsite evidence found in posting'],
    };
  }
  if (hasTechLang && !hasRemote) {
    return {
      arrangement: 'onsite',
      evidence: [
        'Remote language refers to technical support, not work arrangement',
      ],
    };
  }
  if (hasHybrid && hasRemote) {
    return { arrangement: 'hybrid', evidence: ['Hybrid schedule indicated'] };
  }
  if (hasHybrid) {
    return { arrangement: 'hybrid', evidence: ['Hybrid schedule indicated'] };
  }
  if (hasRemote) {
    return { arrangement: 'remote', evidence: ['Remote work indicated'] };
  }

  return { arrangement: 'unknown', evidence: ['Work arrangement not stated'] };
}

function classifyIllinoisEligibility(
  text: string,
  arrangement: WorkArrangement,
): { eligibility: IllinoisEligibility; evidence: string[] } {
  if (arrangement !== 'remote') {
    return {
      eligibility: 'unknown',
      evidence: ['Not a remote position; location-based eligibility applies'],
    };
  }

  const excluded = findMatches(text, ILLINOIS_EXCLUDED);
  if (excluded.length > 0) {
    return { eligibility: 'excluded', evidence: excluded };
  }

  const included = findMatches(text, ILLINOIS_INCLUDED);
  if (included.length > 0) {
    return { eligibility: 'eligible', evidence: included };
  }

  return {
    eligibility: 'unrestricted',
    evidence: ['No Illinois restrictions found; treated as eligible'],
  };
}

function classifySchedule(text: string): ScheduleEvidence {
  const positiveIndicators = findMatches(text, SCHEDULE_POSITIVE);
  const riskIndicators = findMatches(text, SCHEDULE_RISK);

  let classification: ScheduleType = 'unknown';

  if (riskIndicators.length > 0) {
    if (/overnight\s+shift|night\s+shift/i.test(text))
      classification = 'overnight';
    else if (/rotating/i.test(text)) classification = 'rotating';
    else if (/weekend/i.test(text)) classification = 'weekend';
    else if (/on[-]?call/i.test(text)) classification = 'onCall';
    else if (/evening\s+shift/i.test(text)) classification = 'evening';
  }

  if (positiveIndicators.length > 0 && classification === 'unknown') {
    classification = 'daytime';
  }

  return {
    classification,
    evidence: [],
    riskIndicators,
    positiveIndicators,
  };
}

function evaluateEligibility(
  text: string,
  arrangement: WorkArrangement,
  illinoisEligibility: IllinoisEligibility,
  schedule: ScheduleType,
): EligibilityResult {
  if (illinoisEligibility === 'excluded') {
    return {
      passed: false,
      rejectionReason: 'illinois_excluded',
      rejectionDetail: 'Remote position explicitly excludes Illinois',
    };
  }

  if (schedule === 'overnight') {
    return {
      passed: false,
      rejectionReason: 'overnight_schedule',
      rejectionDetail: 'Position requires permanent overnight shift',
    };
  }

  if (schedule === 'rotating') {
    return {
      passed: false,
      rejectionReason: 'rotating_nights',
      rejectionDetail: 'Position requires rotating day/night shifts',
    };
  }

  if (schedule === 'weekend') {
    return {
      passed: false,
      rejectionReason: 'weekend_coverage',
      rejectionDetail: 'Position requires regular weekend coverage',
    };
  }

  const clearance = findMatches(text, CLEARANCE_REQUIRED);
  const sponsorable = findMatches(text, CLEARANCE_SPONSORABLE);
  if (clearance.length > 0 && sponsorable.length === 0) {
    return {
      passed: false,
      rejectionReason: 'clearance_required',
      rejectionDetail:
        'Active security clearance required and sponsorship not indicated',
    };
  }

  if (findMatches(text, COMMISSION).length > 0) {
    return {
      passed: false,
      rejectionReason: 'sales_position',
      rejectionDetail: 'Position is commission-based sales',
    };
  }

  if (findMatches(text, PHYSICAL).length > 0) {
    return {
      passed: false,
      rejectionReason: 'field_installation',
      rejectionDetail:
        'Position has substantial physical or field-installation requirements',
    };
  }

  return {
    passed: true,
    rejectionReason: 'none',
    rejectionDetail: null,
  };
}

function extractStructuredRequirements(text: string) {
  const reqYears = extractYears(text, EXPERIENCE_REQUIRED);
  const prefYears = extractYears(text, EXPERIENCE_PREFERRED);

  return {
    requiredYears: reqYears,
    preferredYears: prefYears,
    degreeRequired: findMatches(text, DEGREE_REQUIRED).length > 0,
    degreeInProgressOk: findMatches(text, DEGREE_IN_PROGRESS_OK).length > 0,
    clearancesRequired: findMatches(text, CLEARANCE_REQUIRED),
    clearancesSponsorable: findMatches(text, CLEARANCE_SPONSORABLE).length > 0,
    travelRequired: findMatches(text, TRAVEL).length > 0,
    travelPercent: extractTravelPercent(text),
    physicalRequirements: findMatches(text, PHYSICAL),
    commissionBased: findMatches(text, COMMISSION).length > 0,
    developmentFocused: findMatches(text, DEVELOPMENT).length > 0,
    fieldInstallation: findMatches(text, PHYSICAL).length > 0,
    weekendsRequired: /\bweekend\b/i.test(text) && !/no\s+weekends/i.test(text),
    onCallRequired: /(?:regular|mandatory)\s+on[-]?call/i.test(text),
    rotatingShifts: /rotating\s+(?:shifts?|schedule)/i.test(text),
    overnightRequired: /overnight\s+shift/i.test(text),
  };
}

function findMatches(text: string, patterns: RegExp[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) results.push(match[0]);
  }
  return results;
}

function extractYears(text: string, patterns: RegExp[]): number | null {
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
  const match = /(\d+)\s*%\s*(?:travel|overnight)/i.exec(text);
  if (match?.[1]) {
    const pct = parseInt(match[1], 10);
    return isNaN(pct) ? null : pct;
  }
  return null;
}
