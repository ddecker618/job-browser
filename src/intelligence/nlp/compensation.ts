import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';

export const COMPENSATION_INTELLIGENCE_VERSION = 'compensation-intelligence-v1';

export type CompensationKind =
  | 'base-pay'
  | 'bonus'
  | 'commission'
  | 'equity'
  | 'sign-on'
  | 'ote';

export type CompensationPeriod =
  | 'annual'
  | 'hourly'
  | 'monthly'
  | 'one-time'
  | 'unknown';

export interface CompensationAmount {
  kind: CompensationKind;
  minimum: number | null;
  maximum: number | null;
  currency: 'USD' | 'unknown';
  period: CompensationPeriod;
  raw: string;
  normalized: string;
  span: {
    start: number;
    end: number;
  };
}

export interface CompensationExtraction {
  amounts: CompensationAmount[];
  signals: CompensationKind[];
  confidence: number;
  version: typeof NLP_EXTRACTION_VERSION;
  compensationVersion: typeof COMPENSATION_INTELLIGENCE_VERSION;
}

interface MoneyMention {
  value: number;
  raw: string;
  start: number;
  end: number;
}

const MONEY_PATTERN = /\$\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*[kK])?/g;

const RANGE_CONNECTOR_PATTERN = /\b(?:to|through|and)\b|[-–—]/;

export function extractCompensation(
  segment: NlpSegment,
): CompensationExtraction {
  const text = segment.text;
  const mentions = [...moneyMentions(text)];
  const amounts: CompensationAmount[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < mentions.length; index += 1) {
    if (consumed.has(index)) continue;
    const current = mentions[index];
    const next = mentions[index + 1];
    if (current === undefined) continue;

    if (
      next !== undefined &&
      !consumed.has(index + 1) &&
      isRangeConnector(text.slice(current.end, next.start))
    ) {
      const start = current.start;
      const end = next.end;
      amounts.push(amountFromSpan(text, start, end, current.value, next.value));
      consumed.add(index);
      consumed.add(index + 1);
      continue;
    }

    amounts.push(
      amountFromSpan(text, current.start, current.end, current.value, null),
    );
    consumed.add(index);
  }

  const signals = compensationSignals(text);
  return {
    amounts,
    signals,
    confidence: amounts.length > 0 ? 0.9 : signals.length > 0 ? 0.75 : 0.4,
    version: NLP_EXTRACTION_VERSION,
    compensationVersion: COMPENSATION_INTELLIGENCE_VERSION,
  };
}

export function extractCompensationBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
): CompensationExtraction[] {
  return segments
    .filter((segment) =>
      (categoriesByIndex.get(segment.index) ?? []).includes('compensation'),
    )
    .map(extractCompensation);
}

function* moneyMentions(text: string): Generator<MoneyMention> {
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const raw = match[0];
    const value = parseMoney(match[1] ?? '', match[2] ?? '');
    if (value === null) continue;
    yield {
      value,
      raw,
      start: match.index,
      end: match.index + raw.length,
    };
  }
}

function amountFromSpan(
  text: string,
  start: number,
  end: number,
  minimum: number,
  maximum: number | null,
): CompensationAmount {
  const raw = text.slice(start, end);
  const context = localContext(text, start, end);
  const kind = compensationKind(context);
  const period = compensationPeriod(context);
  const orderedMinimum =
    maximum !== null && maximum < minimum ? maximum : minimum;
  const orderedMaximum =
    maximum !== null && maximum < minimum ? minimum : maximum;
  return {
    kind,
    minimum: orderedMinimum,
    maximum: orderedMaximum,
    currency: 'USD',
    period,
    raw,
    normalized: normalizedAmount(kind, orderedMinimum, orderedMaximum, period),
    span: { start, end },
  };
}

function parseMoney(numberText: string, suffix: string): number | null {
  const parsed = Number(numberText.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const multiplier = suffix.trim().toLowerCase() === 'k' ? 1000 : 1;
  return Math.round(parsed * multiplier);
}

function isRangeConnector(value: string): boolean {
  return value.length <= 32 && RANGE_CONNECTOR_PATTERN.test(value);
}

function localContext(text: string, start: number, end: number): string {
  return text
    .slice(Math.max(0, start - 80), Math.min(text.length, end + 80))
    .toLowerCase();
}

function compensationKind(context: string): CompensationKind {
  if (/\b(?:ote|on-target earnings?)\b/.test(context)) return 'ote';
  if (/\bsign[-\s]?on\b/.test(context)) return 'sign-on';
  if (/\bcommission\b/.test(context)) return 'commission';
  if (/\b(?:equity|stock options?|rsus?)\b/.test(context)) return 'equity';
  if (
    /\b(?:salary|pay range|pay band|base pay|base salary|wage)\b/.test(context)
  )
    return 'base-pay';
  if (/\bbonus(?:es)?\b/.test(context)) return 'bonus';
  return 'base-pay';
}

function compensationPeriod(context: string): CompensationPeriod {
  if (/\b(?:per hour|hourly|\/\s?hr|\/\s?hour)\b/.test(context))
    return 'hourly';
  if (/\b(?:per month|monthly|\/\s?mo|\/\s?month)\b/.test(context))
    return 'monthly';
  if (/\b(?:sign[-\s]?on|one[-\s]?time)\b/.test(context)) return 'one-time';
  if (
    /\b(?:per year|annually|annual|yearly|\/\s?yr|\/\s?year|salary|base)\b/.test(
      context,
    )
  )
    return 'annual';
  return 'unknown';
}

function compensationSignals(text: string): CompensationKind[] {
  const normalized = text.toLowerCase();
  const signals: CompensationKind[] = [];
  if (/\bbonus(?:es)?\b/.test(normalized)) signals.push('bonus');
  if (/\bcommission\b/.test(normalized)) signals.push('commission');
  if (/\b(?:equity|stock options?|rsus?)\b/.test(normalized))
    signals.push('equity');
  if (/\bsign[-\s]?on\b/.test(normalized)) signals.push('sign-on');
  if (/\b(?:ote|on-target earnings?)\b/.test(normalized)) signals.push('ote');
  return [...new Set(signals)];
}

function normalizedAmount(
  kind: CompensationKind,
  minimum: number,
  maximum: number | null,
  period: CompensationPeriod,
): string {
  const range =
    maximum === null
      ? String(minimum)
      : `${String(minimum)}-${String(maximum)}`;
  return `${kind}:USD:${period}:${range}`;
}
