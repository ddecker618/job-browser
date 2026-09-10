import type { RemoteType } from '../../domain/job.js';
import { classifyWorkArrangement } from '../../domain/work-arrangement.js';
import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';
import {
  normalizeStateCode,
  US_STATE_BY_NAME,
} from '../../utilities/us-states.js';

// ---------------------------------------------------------------------------
// Stage 9 - location, remote, hybrid, commute, relocation, and travel
// intelligence.
//
// This module is a shadow extractor. It reports text evidence and conflicts
// with the existing deterministic arrangement classifier, but never changes
// provider fields, geographic eligibility, scoring, ranking, or filtering.
// ---------------------------------------------------------------------------

export const LOCATION_INTELLIGENCE_VERSION = 'location-intelligence-v1';

export type LocationMentionKind = 'city' | 'state';

export interface LocationMention {
  kind: LocationMentionKind;
  raw: string;
  normalized: string;
  span: { start: number; end: number };
}

export type RemoteScopeKind = 'nationwide' | 'state-limited' | 'unspecified';

export interface RemoteScope {
  kind: RemoteScopeKind;
  states: string[];
  excludedStates: string[];
}

export interface CommuteExtraction {
  required: boolean;
  miles: number | null;
  raw: string | null;
  span: { start: number; end: number } | null;
}

export type OnsiteFrequency = 'occasional' | 'regular' | 'unknown';

export type RelocationStatus =
  | 'required'
  | 'preferred'
  | 'available'
  | 'not-available'
  | 'unknown';

export interface RelocationExtraction {
  status: RelocationStatus;
  raw: string | null;
  span: { start: number; end: number } | null;
}

export interface TravelExtraction {
  mentioned: boolean;
  required: boolean;
  percent: number | null;
  overnight: boolean;
  raw: string | null;
  span: { start: number; end: number } | null;
}

export interface LocationExtraction {
  segmentIndex: number;
  arrangement: RemoteType;
  deterministicArrangement: RemoteType;
  arrangementConflict: boolean;
  arrangementEvidence: string[];
  remoteDenied: boolean;
  locations: LocationMention[];
  remoteScope: RemoteScope;
  commute: CommuteExtraction;
  onsiteFrequency: OnsiteFrequency;
  relocation: RelocationExtraction;
  travel: TravelExtraction;
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  locationVersion: typeof LOCATION_INTELLIGENCE_VERSION;
}

interface StateMention extends LocationMention {
  stateCode: string;
  excluded: boolean;
}

interface StateEntry {
  name: string;
  code: string;
}

const STATE_ENTRIES: readonly StateEntry[] = Object.entries(
  US_STATE_BY_NAME,
).map(([name, code]) => ({ name, code: code.toUpperCase() }));

const STATE_CODES = new Set(STATE_ENTRIES.map((entry) => entry.code));

const HARD_ONSITE_PATTERNS: readonly RegExp[] = [
  /(?:this\s+is\s+)?on[- ]?site\s+(?:role|position|job|opportunity|work)\b/i,
  /\bin[- ]?person\s+(?:role|position|work)\b/i,
  /must\s+(?:live|reside|be\s+located)\s+within\s+(?:commuting\s+)?distance/i,
  /must\s+report\s+to\s+(?:the\s+)?(?:office|worksite|work\s+site|facility)/i,
  /local\s+candidates?\s+only/i,
  /\bcommutable\s+distance\b/i,
];

const GENERIC_ONSITE_PATTERN = /\bon[- ]?site\b|\bin[- ]?person\b/i;

const REMOTE_DENIAL_PATTERNS: readonly RegExp[] = [
  /(?:remote\s+work|remote\s+positions?|remote\s+roles?|telework(?:ing)?|telecommuting|work\s+from\s+home)\b[^.;\n]{0,80}?\b(?:not\s+(?:authorized|available|permitted|allowed|offered|eligible|provided|supported|possible)|unavailable|not\s+an\s+option)\b/i,
  /\b(?:not\s+(?:eligible|authorized|permitted|allowed)\s+for|does\s+not\s+(?:offer|provide|support|allow|permit|authorize))\s+(?:remote\s+work|remote\s+positions?|telework(?:ing)?|telecommuting|work\s+from\s+home)\b/i,
  /\bno\s+(?:remote\s+work|remote\s+positions?|telework(?:ing)?|telecommuting)\b/i,
];

const HYBRID_PATTERNS: readonly RegExp[] = [
  /\bhybrid\b/i,
  /(?:two|three|four|five)\s+days?\s+(?:per\s+week|a\s+week|in\s+the\s+office)/i,
  /mix\s+of\s+(?:in[- ]?office|on[- ]?site)\s+and\s+remote/i,
  /split\s+(?:week|time)\s+between/i,
  /some\s+(?:days?\s+)?in\s+(?:the\s+)?office/i,
];

const REMOTE_PATTERNS: readonly RegExp[] = [
  /(?:fully|completely|100%|totally)\s+remote\b/i,
  /\bremote\s+(?:role|position|job|opportunity|work|first|only)\b/i,
  /work\s+(?:from\s+)?home/i,
  /telecommute/i,
  /anywhere\s+in\s+(?:the\s+)?(?:us|united\s+states)/i,
  /nationwide\s+remote/i,
  /fully\s+distributed/i,
  /eligible\s+for\s+(?:remote\s+work|telework|telecommuting|remote\s+positions?)/i,
  /(?:may|can|will)\s+work\s+remotely\b/i,
  /\btelework(?:ing)?[\s-]?(?:eligible|available|permitted|allowed|offered|authorized)\b/i,
];

const TECHNICAL_REMOTE_PATTERNS: readonly RegExp[] = [
  /\bremote\s+(?:support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics|infrastructure)\b/i,
  /\bon[- ]?premises\s+and\s+remote\s+infrastructure\b/i,
];

const NATIONWIDE_PATTERN =
  /\b(?:nationwide|anywhere\s+in\s+(?:the\s+)?(?:u\.?s\.?|united\s+states)|all\s+50\s+states|across\s+the\s+(?:entire\s+)?u\.?s\.?)\b/i;

const REMOTE_SCOPE_PATTERN = /\b(?:remote|telework|telecommut(?:e|ing))\b/i;

const CITY_STATE_PATTERN =
  /\b([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}),\s*([A-Za-z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+){0,2})\b/g;

const STATE_CODE_CONTEXT_PATTERN =
  /(?:,\s*|\b(?:in|near|from|within|across|throughout|outside|excluding)\s+)([A-Za-z]{2})\b/gi;

const COMMUTE_DISTANCE_PATTERNS: readonly RegExp[] = [
  /\b(?:within|inside|up\s+to)\s+(\d{1,3})\s*(?:-|to)?\s*miles?\b/i,
  /\b(\d{1,3})\s*(?:-|to)?\s*miles?\s+(?:radius|commut(?:e|ing))\b/i,
];

const COMMUTE_PHRASE_PATTERN =
  /\b(?:must|need(?:s)?\s+to|required\s+to)\b[^.;]{0,60}\b(?:commut(?:e|ing)|commutable|live|reside)\b[^.;]{0,30}\bdistance\b|\bcommutable\s+distance\b/i;

const OCCASIONAL_ONSITE_PATTERN =
  /\b(?:occasional(?:ly)?|periodic(?:ally)?|as\s+needed|from\s+time\s+to\s+time)\b[^.;]{0,40}\b(?:on[- ]?site|in[- ]?person|office|facility)\b|\b(?:on[- ]?site|in[- ]?person|office|facility)\b[^.;]{0,40}\b(?:occasional(?:ly)?|periodic(?:ally)?|as\s+needed)\b/i;

const REGULAR_ONSITE_PATTERN =
  /\b(?:daily|every\s+day|regular(?:ly)?|(?:[2-5]|two|three|four|five)\s+days?\s+(?:per|a)\s+week)\b[^.;]{0,30}\b(?:on[- ]?site|in[- ]?person|office)\b|\b(?:on[- ]?site|in[- ]?person|office)\b[^.;]{0,30}\b(?:daily|every\s+day|regular(?:ly)?)\b/i;

const RELOCATION_PATTERNS: readonly {
  status: RelocationStatus;
  pattern: RegExp;
}[] = [
  {
    status: 'not-available',
    pattern:
      /\b(?:no|not|unavailable|does\s+not\s+provide)\s+relocation\s+(?:assistance|support)\b|\brelocation\s+(?:assistance|support)\s+(?:is\s+)?(?:not\s+available|unavailable|not\s+provided)\b/i,
  },
  {
    status: 'required',
    pattern:
      /\b(?:must|need(?:s)?\s+to|required\s+to)\s+(?:be\s+)?(?:willing\s+to\s+)?relocat(?:e|ion)\b|\brelocation\s+(?:is\s+)?required\b/i,
  },
  {
    status: 'preferred',
    pattern:
      /\brelocation\s+(?:is\s+)?(?:preferred|desired|a\s+plus)\b|\brelocation\s+assistance\s+preferred\b/i,
  },
  {
    status: 'available',
    pattern:
      /\brelocation\s+(?:assistance|support)\s+(?:is\s+)?(?:available|provided|offered)\b/i,
  },
];

const TRAVEL_PERCENT_PATTERNS: readonly RegExp[] = [
  /(\d{1,3})\s*%\s*(?:of\s+)?(?:travel|overnight)/i,
  /(?:travel|overnight)\s+(?:up\s+to|of)\s+(\d{1,3})\s*%/i,
  /up\s+to\s+(\d{1,3})\s*%\s+(?:travel|overnight)/i,
];

const TRAVEL_MENTION_PATTERN =
  /\b(?:travel|traveling|travelling|overnight\s+(?:travel|stays?))\b/i;

const TRAVEL_REQUIRED_PATTERN =
  /\b(?:travel|traveling|travelling)\b[^.;]{0,40}\b(?:required|mandatory|necessary)\b|\b(?:must|required|willing\s+to)\b[^.;]{0,40}\b(?:travel|traveling|travelling)\b/i;

const OVERNIGHT_PATTERN =
  /\bovernight\s+(?:travel|stays?)\b|\b(?:travel|traveling|travelling)\b[^.;]{0,30}\bovernight\b/i;

export function extractLocation(segment: NlpSegment): LocationExtraction {
  const text = segment.text;
  const arrangementDetails = classifyNlpArrangement(
    text,
    OCCASIONAL_ONSITE_PATTERN.test(text),
  );
  const deterministic = classifyWorkArrangement(text);
  const locationData = extractLocations(text);
  const commute = extractCommute(text);
  const onsiteFrequency = extractOnsiteFrequency(text);
  const relocation = extractRelocation(text);
  const travel = extractTravel(text);
  const remoteScope = extractRemoteScope(text, locationData.states);
  const arrangementConflict =
    arrangementDetails.arrangement !== 'unknown' &&
    deterministic.arrangement !== 'unknown' &&
    arrangementDetails.arrangement !== deterministic.arrangement;

  const hasSignal =
    arrangementDetails.arrangement !== 'unknown' ||
    locationData.locations.length > 0 ||
    commute.required ||
    relocation.status !== 'unknown' ||
    travel.mentioned;
  const confidence = hasSignal
    ? arrangementDetails.arrangement === 'unknown'
      ? 0.75
      : 0.9
    : 0.4;

  return {
    segmentIndex: segment.index,
    arrangement: arrangementDetails.arrangement,
    deterministicArrangement: deterministic.arrangement,
    arrangementConflict,
    arrangementEvidence: arrangementDetails.evidence,
    remoteDenied: arrangementDetails.remoteDenied,
    locations: locationData.locations,
    remoteScope,
    commute,
    onsiteFrequency,
    relocation,
    travel,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    locationVersion: LOCATION_INTELLIGENCE_VERSION,
  };
}

export function extractLocationBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): LocationExtraction[] {
  const results: LocationExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (
      !categories.includes('location') &&
      !categories.includes('work-arrangement') &&
      !categories.includes('travel')
    ) {
      continue;
    }
    results.push(extractLocation(segment));
  }
  return results;
}

function classifyNlpArrangement(
  text: string,
  occasionalOnsite: boolean,
): {
  arrangement: RemoteType;
  evidence: string[];
  remoteDenied: boolean;
} {
  const denial = collectMatches(text, REMOTE_DENIAL_PATTERNS);
  const hardOnsite = collectMatches(text, HARD_ONSITE_PATTERNS);
  const hybrid = collectMatches(text, HYBRID_PATTERNS);
  const remote = collectMatches(text, REMOTE_PATTERNS);
  const technicalRemote = collectMatches(text, TECHNICAL_REMOTE_PATTERNS);

  if (denial.length > 0) {
    return {
      arrangement: 'onsite',
      evidence: denial.map(
        (indicator) => `${indicator} (remote/telework not authorized)`,
      ),
      remoteDenied: true,
    };
  }
  if (hardOnsite.length > 0) {
    return { arrangement: 'onsite', evidence: hardOnsite, remoteDenied: false };
  }
  if (hybrid.length > 0) {
    return { arrangement: 'hybrid', evidence: hybrid, remoteDenied: false };
  }
  if (remote.length > 0 && technicalRemote.length === 0) {
    const evidence = occasionalOnsite
      ? [...remote, 'occasional onsite qualifier']
      : remote;
    return { arrangement: 'remote', evidence, remoteDenied: false };
  }
  if (GENERIC_ONSITE_PATTERN.test(text)) {
    return {
      arrangement: 'onsite',
      evidence: [GENERIC_ONSITE_PATTERN.exec(text)?.[0] ?? 'onsite'],
      remoteDenied: false,
    };
  }
  if (technicalRemote.length > 0) {
    return {
      arrangement: 'unknown',
      evidence: technicalRemote.map(
        (indicator) =>
          `${indicator} (technical terminology, not work arrangement)`,
      ),
      remoteDenied: false,
    };
  }
  return { arrangement: 'unknown', evidence: [], remoteDenied: false };
}

function extractLocations(text: string): {
  locations: LocationMention[];
  states: StateMention[];
} {
  const locations: LocationMention[] = [];
  const states: StateMention[] = [];

  const addState = (raw: string, start: number, code: string): void => {
    const end = start + raw.length;
    if (
      states.some(
        (item) =>
          item.span.start === start &&
          item.span.end === end &&
          item.stateCode === code,
      )
    ) {
      return;
    }
    const state: StateMention = {
      kind: 'state',
      raw,
      normalized: code,
      span: { start, end },
      stateCode: code,
      excluded: isExcludedState(text, start),
    };
    states.push(state);
    locations.push(state);
  };

  for (const entry of STATE_ENTRIES) {
    const pattern = new RegExp(`\\b${escapeRegex(entry.name)}\\b`, 'gi');
    let match = pattern.exec(text);
    while (match !== null) {
      addState(match[0], match.index, entry.code);
      match = pattern.exec(text);
    }
  }

  let codeMatch = STATE_CODE_CONTEXT_PATTERN.exec(text);
  while (codeMatch !== null) {
    const rawCode = codeMatch[1];
    if (rawCode !== undefined) {
      const code = rawCode.toUpperCase();
      if (STATE_CODES.has(code)) {
        const offset = codeMatch[0].toUpperCase().lastIndexOf(code);
        addState(rawCode, codeMatch.index + offset, code);
      }
    }
    codeMatch = STATE_CODE_CONTEXT_PATTERN.exec(text);
  }

  let cityStateMatch = CITY_STATE_PATTERN.exec(text);
  while (cityStateMatch !== null) {
    const cityRaw = cityStateMatch[1];
    const stateValue = cityStateMatch[2];
    if (cityRaw !== undefined && stateValue !== undefined) {
      const city = cityRaw.replace(
        /^.*\b(?:in|near|at|from|based\s+in|located\s+in|office\s+in)\s+/i,
        '',
      );
      const stateCode = normalizeStateCode(stateValue);
      if (
        stateCode !== null &&
        STATE_CODES.has(stateCode) &&
        !/^(?:location|work|office|role|job|remote|onsite|hybrid)\b/i.test(city)
      ) {
        const cityStart =
          cityStateMatch.index + cityStateMatch[0].indexOf(city);
        locations.push({
          kind: 'city',
          raw: city,
          normalized: normalizeText(city),
          span: { start: cityStart, end: cityStart + city.length },
        });
      }
    }
    cityStateMatch = CITY_STATE_PATTERN.exec(text);
  }

  locations.sort((a, b) => a.span.start - b.span.start);
  states.sort((a, b) => a.span.start - b.span.start);
  return { locations, states };
}

function extractRemoteScope(
  text: string,
  states: readonly StateMention[],
): RemoteScope {
  const excludedStates = unique(
    states.filter((state) => state.excluded).map((state) => state.stateCode),
  );
  const positiveStates = unique(
    states.filter((state) => !state.excluded).map((state) => state.stateCode),
  );
  if (NATIONWIDE_PATTERN.test(text)) {
    return { kind: 'nationwide', states: positiveStates, excludedStates };
  }
  if (REMOTE_SCOPE_PATTERN.test(text) && positiveStates.length > 0) {
    return {
      kind: 'state-limited',
      states: positiveStates,
      excludedStates,
    };
  }
  return { kind: 'unspecified', states: positiveStates, excludedStates };
}

function extractCommute(text: string): CommuteExtraction {
  const distanceMatch = firstMatch(text, COMMUTE_DISTANCE_PATTERNS);
  if (distanceMatch !== null) {
    const rawMiles = distanceMatch[1];
    const miles = rawMiles === undefined ? null : Number.parseInt(rawMiles, 10);
    return {
      required: true,
      miles,
      raw: distanceMatch[0],
      span: {
        start: distanceMatch.index,
        end: distanceMatch.index + distanceMatch[0].length,
      },
    };
  }
  const phrase = COMMUTE_PHRASE_PATTERN.exec(text);
  return {
    required: phrase !== null,
    miles: null,
    raw: phrase?.[0] ?? null,
    span:
      phrase === null
        ? null
        : { start: phrase.index, end: phrase.index + phrase[0].length },
  };
}

function extractOnsiteFrequency(text: string): OnsiteFrequency {
  if (OCCASIONAL_ONSITE_PATTERN.test(text)) return 'occasional';
  if (REGULAR_ONSITE_PATTERN.test(text)) return 'regular';
  return 'unknown';
}

function extractRelocation(text: string): RelocationExtraction {
  for (const rule of RELOCATION_PATTERNS) {
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    return {
      status: rule.status,
      raw: match[0],
      span: { start: match.index, end: match.index + match[0].length },
    };
  }
  return { status: 'unknown', raw: null, span: null };
}

function extractTravel(text: string): TravelExtraction {
  const mention = TRAVEL_MENTION_PATTERN.exec(text);
  const percentMatch = firstMatch(text, TRAVEL_PERCENT_PATTERNS);
  const rawPercent = percentMatch?.[1];
  const percent =
    rawPercent === undefined ? null : Number.parseInt(rawPercent, 10);
  const rawMatch = percentMatch ?? mention;
  return {
    mentioned: mention !== null || percent !== null,
    required: percent !== null || TRAVEL_REQUIRED_PATTERN.test(text),
    percent,
    overnight: OVERNIGHT_PATTERN.test(text),
    raw: rawMatch?.[0] ?? null,
    span:
      rawMatch === null
        ? null
        : { start: rawMatch.index, end: rawMatch.index + rawMatch[0].length },
  };
}

function firstMatch(
  text: string,
  patterns: readonly RegExp[],
): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match;
  }
  return null;
}

function collectMatches(text: string, patterns: readonly RegExp[]): string[] {
  return patterns
    .map((pattern) => pattern.exec(text)?.[0])
    .filter((match): match is string => match !== undefined);
}

function isExcludedState(text: string, start: number): boolean {
  const context = text.slice(Math.max(0, start - 70), start);
  return /\b(?:excluding|exclude|except|outside|not\s+available\s+in|not\s+eligible\s+in|not\s+open\s+to|unavailable\s+in|cannot\s+(?:be\s+based|work)\s+in)\b/i.test(
    context,
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
