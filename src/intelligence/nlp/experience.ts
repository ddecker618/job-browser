import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 6 - experience intelligence.
//
// Extracts min/preferred years, year ranges, domains, nested experience
// clauses, and alternatives from experience segments. Never fabricates years;
// ranges are preserved (3-5 stays 3-5); unknown-bounded clutter stays unknown.
// ---------------------------------------------------------------------------

export const EXPERIENCE_INTELLIGENCE_VERSION = 'experience-intelligence-v1';

export type YearModifier =
  | 'range'
  | 'at-least'
  | 'at-most'
  | 'exactly'
  | 'unknown';

export interface YearClause {
  minimum: number;
  maximum: number | null;
  modifier: YearModifier;
  domain: string | null;
}

export interface MonthClause {
  value: number;
  domain: string | null;
}

export interface ExperienceExtraction {
  segmentIndex: number;
  years: YearClause | null;
  nestedYears: YearClause[];
  months: MonthClause[];
  domains: string[];
  alternatives: YearClause[];
  context: string | null;
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  experienceVersion: typeof EXPERIENCE_INTELLIGENCE_VERSION;
}

const RANGE_PATTERN =
  /\b(\d{1,2})\s*(?:[-–—]|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i;

const EXPLICIT_MIN_PATTERN =
  /\b(?:at least|minimum of|a minimum of|no fewer than|at a minimum|no less than)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)\b/i;

const EXPLICIT_MAX_PATTERN =
  /\b(?:up to|no more than|maximum of|at most)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i;

const PLUS_YEARS_PATTERN = /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i;

const OR_MORE_YEARS_PATTERN =
  /\b(\d{1,2})\s+(?:or more|plus)\s*(?:years?|yrs?)\b/i;

const NESTED_YEARS_PATTERN =
  /\b(?:including|with|plus|an additional)\s+(?:at least\s+|a minimum of\s+)?(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)\b/i;

const OF_WHICH_PATTERN = /\b(\d{1,2})\s+(?:of which|years? of which)\b/i;

const MONTHS_PATTERN = /\b(\d{1,2})\s*(?:months?|mos?\.|mo\.)\b/i;

const YEARS_DOMAIN_PATTERN =
  /\b(?:years?|yrs?)\s+(?:of\s+|in\s+)?([A-Za-z][A-Za-z ,&'-]{0,40}?)(?=\s*(?:experience|work|background)\b|,|;|\.|$|\b(?:and|or)\b)/i;

const WITH_DOMAIN_PATTERN =
  /\b(?:experience|background)\s+(?:in|with|working|as)\s+([A-Za-z][A-Za-z ,&'-]{0,40}?)(?=\s*(?:required|preferred|must|is|are|;|\.|$|\b(?:including|and|or)\b))/i;

const CONTEXT_PATTERN =
  /\bas (?:a |an )?([A-Za-z][A-Za-z0-9 -]{2,45}?)(?=\s*(?:with|in|\.|,|$|\bwhich\b|\byou\b))/i;

export function extractExperience(segment: NlpSegment): ExperienceExtraction {
  const text = segment.text;

  const chunks = text.split(/\bor\b/i);
  const alternativeChunks = chunks.slice(1);
  const alternatives = alternativeChunks
    .map((chunk) => parseYearClause(chunk))
    .filter((clause): clause is YearClause => clause !== null);

  const primaryFromText = parseYearClause(text);
  const nestedYearMatches = [
    ...matchAll(NESTED_YEARS_PATTERN, text),
    ...matchAll(OF_WHICH_PATTERN, text),
  ];
  const nestedYears: YearClause[] = [];
  for (const match of nestedYearMatches) {
    const rawValue = match[1];
    if (rawValue === undefined) continue;
    const value = Number.parseInt(rawValue, 10);
    if (Number.isNaN(value) || value < 0 || value > 99) continue;
    nestedYears.push({
      minimum: value,
      maximum: null,
      modifier: 'at-least',
      domain: captureNestedDomain(text, (match.index ?? 0) + match[0].length),
    });
  }

  const monthClauses = matchAll(MONTHS_PATTERN, text).map((match) => {
    const rawValue = match[1];
    const value = rawValue === undefined ? 0 : Number.parseInt(rawValue, 10);
    return {
      value: Number.isNaN(value) ? 0 : value,
      domain: captureMonthDomain(text, (match.index ?? 0) + match[0].length),
    };
  });

  const DOMAIN_STOPWORDS = new Set([
    'experience',
    'work',
    'background',
    'required',
    'preferred',
  ]);

  const domains = [
    ...[...matchAll(YEARS_DOMAIN_PATTERN, text)]
      .map((match) => match[1])
      .filter((domain): domain is string => domain !== undefined),
    ...[...matchAll(WITH_DOMAIN_PATTERN, text)]
      .map((match) => match[1])
      .filter((domain): domain is string => domain !== undefined),
  ]
    .map((domain) => cleanDomain(domain))
    .filter(
      (domain) =>
        domain.length > 0 && !DOMAIN_STOPWORDS.has(domain.split(' ')[0] ?? ''),
    );

  const contextMatch = CONTEXT_PATTERN.exec(text);
  const contextRaw = contextMatch?.[1];
  const context = contextRaw === undefined ? null : contextRaw.trim();

  const years = primaryFromText;
  const confidence = computeExperienceConfidence(
    years,
    nestedYears,
    monthClauses,
  );

  return {
    segmentIndex: segment.index,
    years,
    nestedYears,
    months: monthClauses,
    domains: [...new Set(domains)],
    alternatives,
    context,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    experienceVersion: EXPERIENCE_INTELLIGENCE_VERSION,
  };
}

export function extractExperienceBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): ExperienceExtraction[] {
  const results: ExperienceExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (!categories.includes('experience')) continue;
    results.push(extractExperience(segment));
  }
  return results;
}

function matchAll(pattern: RegExp, text: string): RegExpMatchArray[] {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function parseYearClause(text: string): YearClause | null {
  const candidates: YearClause[] = [];

  const rangeMatch = RANGE_PATTERN.exec(text);
  if (rangeMatch !== null) {
    const minRaw = rangeMatch[1];
    const maxRaw = rangeMatch[2];
    if (minRaw !== undefined && maxRaw !== undefined) {
      const min = Number.parseInt(minRaw, 10);
      const max = Number.parseInt(maxRaw, 10);
      if (!Number.isNaN(min) && !Number.isNaN(max) && min <= max) {
        candidates.push({
          minimum: min,
          maximum: max,
          modifier: 'range',
          domain: capturePrimaryDomain(
            text,
            rangeMatch.index + rangeMatch[0].length,
          ),
        });
      }
    }
  }

  const exactMinMatch = EXPLICIT_MIN_PATTERN.exec(text);
  if (exactMinMatch !== null) {
    const minRaw = exactMinMatch[1];
    if (minRaw !== undefined) {
      const min = Number.parseInt(minRaw, 10);
      candidates.push({
        minimum: min,
        maximum: null,
        modifier: 'at-least',
        domain: capturePrimaryDomain(
          text,
          exactMinMatch.index + exactMinMatch[0].length,
        ),
      });
    }
  }

  const exactMaxMatch = EXPLICIT_MAX_PATTERN.exec(text);
  if (exactMaxMatch !== null) {
    const maxRaw = exactMaxMatch[1];
    if (maxRaw !== undefined) {
      const max = Number.parseInt(maxRaw, 10);
      candidates.push({
        minimum: 0,
        maximum: max,
        modifier: 'at-most',
        domain: capturePrimaryDomain(
          text,
          exactMaxMatch.index + exactMaxMatch[0].length,
        ),
      });
    }
  }

  const orMoreMatch = OR_MORE_YEARS_PATTERN.exec(text);
  if (orMoreMatch !== null) {
    const minRaw = orMoreMatch[1];
    if (minRaw !== undefined) {
      const min = Number.parseInt(minRaw, 10);
      candidates.push({
        minimum: min,
        maximum: null,
        modifier: 'at-least',
        domain: capturePrimaryDomain(
          text,
          orMoreMatch.index + orMoreMatch[0].length,
        ),
      });
    }
  }

  const plusMatch = PLUS_YEARS_PATTERN.exec(text);
  if (plusMatch !== null && candidates.length === 0) {
    const minRaw = plusMatch[1];
    if (minRaw !== undefined) {
      const min = Number.parseInt(minRaw, 10);
      candidates.push({
        minimum: min,
        maximum: null,
        modifier: plusMatch[0].includes('+') ? 'at-least' : 'unknown',
        domain: capturePrimaryDomain(
          text,
          plusMatch.index + plusMatch[0].length,
        ),
      });
    }
  }

  return candidates[0] ?? null;
}

function capturePrimaryDomain(text: string, from: number): string | null {
  const slice = text.slice(from);
  const captured =
    /^\s*(?:of\s+|in\s+)?([A-Za-z][A-Za-z ,&'-]{0,40}?)(?=\s*(?:experience|work|background|required|preferred|,|;|\.|$))/i.exec(
      slice,
    )?.[1];
  return captured === undefined ? null : cleanDomain(captured);
}

function captureNestedDomain(text: string, from: number): string | null {
  const slice = text.slice(from);
  const captured =
    /^\s*(?:of\s+|in\s+)?([A-Za-z][A-Za-z ,&'-]{0,40}?)(?=\s*(?:experience|work|background|,|;|\.|$))/i.exec(
      slice,
    )?.[1];
  return captured === undefined ? null : cleanDomain(captured);
}

function captureMonthDomain(text: string, from: number): string | null {
  const slice = text.slice(from);
  const captured =
    /(?:in|with|of)\s+([A-Za-z][A-Za-z ,&'-]{0,40}?)(?=\s*(?:required|preferred|,|;|\.|$))/i.exec(
      slice,
    )?.[1];
  return captured === undefined ? null : cleanDomain(captured);
}

function cleanDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function computeExperienceConfidence(
  years: YearClause | null,
  nested: readonly YearClause[],
  months: readonly MonthClause[],
): number {
  if (years !== null) {
    if (years.modifier === 'range' || years.modifier === 'at-most') return 0.9;
    if (years.modifier === 'at-least') return 0.85;
    return 0.8;
  }
  if (nested.length > 0) return 0.75;
  if (months.length > 0) return 0.7;
  return 0.5;
}
