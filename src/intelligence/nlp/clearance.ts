import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 8 - clearance and citizenship intelligence.
//
// Separates clearance level/current/ability-to-obtain/maintain/preferred/
// public-trust from citizenship, and refuses to imply an applicant clearance
// from employer-directed language such as "our cleared team".
// ---------------------------------------------------------------------------

export const CLEARANCE_INTELLIGENCE_VERSION = 'clearance-intelligence-v1';

type ClearanceLevelKey =
  | 'ts-sci'
  | 'top-secret'
  | 'secret'
  | 'confidential'
  | 'public-trust'
  | 'sci'
  | 'polygraph'
  | 'ssbi'
  | 'unknown';

type ClearanceStatus =
  | 'current'
  | 'maintenance'
  | 'ability-to-obtain'
  | 'required'
  | 'preferred'
  | 'unknown';

interface ClearanceLevelDefinition {
  key: ClearanceLevelKey;
  name: string;
  pattern: RegExp;
}

const CLEARANCE_LEVELS: readonly ClearanceLevelDefinition[] = [
  {
    key: 'ts-sci',
    name: 'Top Secret/SCI',
    pattern: /\b(?:top[ -]?secret[ /-]+sci|ts\s*[ /-]\s*sci)\b/i,
  },
  {
    key: 'top-secret',
    name: 'Top Secret',
    pattern: /\b(?:top[ -]?secret|dod\s*top[ -]?secret)\b/i,
  },
  {
    key: 'confidential',
    name: 'Confidential',
    pattern:
      /\bconfidential\s+(?:clearance|level)|(?:clearance|level)[^.]{0,12}confidential\b/i,
  },
  {
    key: 'secret',
    name: 'Secret',
    pattern: /\b(?:secret(?: clearance)?|dod\s*secret\b)\b/i,
  },
  {
    key: 'sci',
    name: 'Sensitive Compartmented Information',
    pattern: /\b(?:sci|sensitive\s+compartmented\s+information)\b/i,
  },
  {
    key: 'public-trust',
    name: 'Public Trust',
    pattern: /\bpublic[ -]trust\b/i,
  },
  {
    key: 'ssbi',
    name: 'SSBI',
    pattern: /\b(?:ssbi|single[ -]scope[ -]background[ -]investigation)\b/i,
  },
  {
    key: 'polygraph',
    name: 'Polygraph',
    pattern:
      /\b(?:ci\s*|counter[ -]?intelligence\s*|full[ -]scope\s*|expanded[ -]scope\s*)?polygraph\b/i,
  },
];

const CLEARANCE_STATUS_RULES: {
  status: ClearanceStatus;
  pattern: RegExp;
}[] = [
  {
    status: 'maintenance',
    pattern:
      /\bmaintain(?: (?:a|an|our|your))?(?: (?:current|active|valid))?[^.]{0,24}?clearance\b|re[ -]?certif/i,
  },
  {
    status: 'ability-to-obtain',
    pattern:
      /\bability to (obtain|get|earn)|be able to (obtain|get|earn)|willing to obtain|obtainable|eligible(?: for| to obtain)/i,
  },
  {
    status: 'current',
    pattern:
      /\b(?:currently|active|valid)\b|\bcurrently hold(\/)?\b|\bh[ae]ve (?:an? |a )?(?:active |current )?clearance/i,
  },
  {
    status: 'required',
    pattern:
      /\brequired\b|\bmust (?:have|hold|possess)\b|\bmust\b|\bshall\b|\brequire[sd]?\b/i,
  },
  {
    status: 'preferred',
    pattern:
      /\bpreferred\b|\bdesired\b|\bideal(?:ly)?\b|\bnice[ -]to[ -]have\b|\bis a plus\b/i,
  },
];

interface CitizenshipDefinition {
  status: 'us-citizen' | 'permanent-resident' | 'work-authorization';
  pattern: RegExp;
}

const CITIZENSHIP_DEFINITIONS: readonly CitizenshipDefinition[] = [
  {
    status: 'us-citizen',
    pattern:
      /\b(?:u\.?\s*s\.?\s*(?:citizens?|citizenship)|us citizenship|citizens? of the united states|united states citizens?)\b/i,
  },
  {
    status: 'permanent-resident',
    pattern:
      /\b(?:green\s?card|lawful permanent resident|permanent residents?)\b/i,
  },
  {
    status: 'work-authorization',
    pattern:
      /\b(?:legally authorized(?: to work)?|authorized to work|eligible to work|work authorization|work permitt?)\b/i,
  },
];

const TEAM_CONTEXT_PATTERN =
  /\b(?:our|we|us|their)\s+[a-z -]{0,20}clear(?:ed|ances?)\b|\bclear(?:ed)?\s+(?:team|staff|workforce|personnel|individuals|engineers?|developers?)\b/i;

const APPLICANT_LANGUAGE_PATTERN = /\b(?:you|your|candidate|applicant)\b/i;

const GENERIC_CLEARANCE_PATTERN = /\bclearance\b/i;

export interface ClearanceItem {
  level: ClearanceLevelKey;
  name: string;
  raw: string;
  span: { start: number; end: number };
  status: ClearanceStatus;
}

export interface CitizenshipItem {
  status: 'us-citizen' | 'permanent-resident' | 'work-authorization';
  raw: string;
  span: { start: number; end: number };
  modality: NlpRequirementStrength;
  equivalency: boolean;
}

export interface ClearanceExtraction {
  segmentIndex: number;
  teamContext: boolean;
  clearances: ClearanceItem[];
  citizenship: CitizenshipItem[];
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  clearanceVersion: typeof CLEARANCE_INTELLIGENCE_VERSION;
}

export function extractClearance(segment: NlpSegment): ClearanceExtraction {
  const text = segment.text;
  const normalized = normalizeText(text);

  const teamContext = TEAM_CONTEXT_PATTERN.test(text);
  const applicantLanguage = APPLICANT_LANGUAGE_PATTERN.test(text);
  const isApplicantDirected = applicantLanguage || !teamContext;
  const hasGenericClearance = GENERIC_CLEARANCE_PATTERN.test(text);

  const clearances: ClearanceItem[] = [];
  if (isApplicantDirected) {
    const matches = new Map<ClearanceLevelKey, number>();
    for (const level of CLEARANCE_LEVELS) {
      const hit = level.pattern.exec(normalized);
      if (hit === null) continue;
      const start = hit.index;
      const end = start + hit[0].length;
      const overlaps = clearances.some(
        (item) => start < item.span.end && end > item.span.start,
      );
      if (overlaps) continue;
      const status = nearestStatus(text, (start + end) / 2);
      const raw = text.slice(start, end);
      if (matches.has(level.key)) continue;
      matches.set(level.key, start);
      clearances.push({
        level: level.key,
        name: level.name,
        raw,
        span: { start, end },
        status,
      });
    }
    if (clearances.length === 0 && hasGenericClearance) {
      const hit = GENERIC_CLEARANCE_PATTERN.exec(normalized);
      if (hit !== null) {
        const start = hit.index;
        const end = start + hit[0].length;
        clearances.push({
          level: 'unknown',
          name: 'Security Clearance',
          raw: text.slice(start, end),
          span: { start, end },
          status: nearestStatus(text, (start + end) / 2),
        });
      }
    }
    clearances.sort((a, b) => a.span.start - b.span.start);
  }

  const citizenship: CitizenshipItem[] = [];
  for (const definition of CITIZENSHIP_DEFINITIONS) {
    const hit = definition.pattern.exec(normalized);
    if (hit === null) continue;
    const start = hit.index;
    const end = start + hit[0].length;
    const center = (start + end) / 2;
    citizenship.push({
      status: definition.status,
      raw: text.slice(start, end),
      span: { start, end },
      modality: localModality(text, center),
      equivalency: /\bequivalent\b/i.test(normalized),
    });
  }

  const confidence =
    clearances.length === 0 && citizenship.length === 0
      ? teamContext
        ? 0.55
        : 0.4
      : 0.9;

  return {
    segmentIndex: segment.index,
    teamContext,
    clearances,
    citizenship,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    clearanceVersion: CLEARANCE_INTELLIGENCE_VERSION,
  };
}

export function extractClearanceBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): ClearanceExtraction[] {
  const results: ClearanceExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (
      !categories.includes('clearance') &&
      !categories.includes('citizenship')
    ) {
      continue;
    }
    results.push(extractClearance(segment));
  }
  return results;
}

export function clearanceCatalog(): readonly ClearanceLevelDefinition[] {
  return CLEARANCE_LEVELS;
}

interface ClauseBounds {
  start: number;
  end: number;
}

function clauseBounds(text: string, center: number): ClauseBounds {
  const semicolons = [0];
  let cursor = text.indexOf(';');
  while (cursor !== -1) {
    semicolons.push(cursor + 1);
    cursor = text.indexOf(';', cursor + 1);
  }
  semicolons.push(text.length);
  for (let i = 0; i < semicolons.length - 1; i += 1) {
    const start = semicolons[i] ?? 0;
    const end = semicolons[i + 1] ?? text.length;
    if (center >= start && center < end) return { start, end };
  }
  return { start: 0, end: text.length };
}

function nearestStatus(text: string, center: number): ClearanceStatus {
  const clause = clauseBounds(text, center);
  const localCenter = center - clause.start;
  const clauseText = text.slice(clause.start, clause.end);
  let best: { status: ClearanceStatus; distance: number } | null = null;
  for (const rule of CLEARANCE_STATUS_RULES) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let hit = pattern.exec(clauseText);
    while (hit !== null) {
      const start = hit.index;
      const end = start + hit[0].length;
      const distance =
        localCenter < start
          ? start - localCenter
          : localCenter > end
            ? localCenter - end
            : 0;
      if (best === null || distance < best.distance) {
        best = { status: rule.status, distance };
      }
      hit = pattern.exec(clauseText);
    }
  }
  return best?.status ?? 'unknown';
}

function localModality(text: string, center: number): NlpRequirementStrength {
  const clause = clauseBounds(text, center);
  const localCenter = center - clause.start;
  const clauseText = text.slice(clause.start, clause.end);
  let best: { strength: NlpRequirementStrength; distance: number } | null =
    null;
  for (const rule of LOCAL_MODALITY_RULES) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let hit = pattern.exec(clauseText);
    while (hit !== null) {
      const start = hit.index;
      const end = start + hit[0].length;
      const distance =
        localCenter < start
          ? start - localCenter
          : localCenter > end
            ? localCenter - end
            : 0;
      if (best === null || distance < best.distance) {
        best = { strength: rule.strength, distance };
      }
      hit = pattern.exec(clauseText);
    }
  }
  return best?.strength ?? 'unknown';
}

const LOCAL_MODALITY_RULES: {
  strength: NlpRequirementStrength;
  pattern: RegExp;
}[] = [
  {
    strength: 'required-after-hire',
    pattern:
      /within \d{1,3} (?:days?|weeks?|months?|years?)|(?:after|upon|post[ -])?(?:hire|hiring|start)/i,
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
      /required|mandatory|\bmust\b|\bshall\b|candidates? should|we require/i,
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
