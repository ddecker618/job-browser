import type { UserOccurrencePrecision } from '../domain/application-status.js';

export function nowUtc(): string {
  return new Date().toISOString();
}

export function assertUtcTimestamp(value: string, name: string): void {
  if (!value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 UTC timestamp`);
  }
}

export interface NormalizedOccurrence {
  source: string;
  sort: string;
  precision: UserOccurrencePrecision;
}

const EXACT_OCCURRENCE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_OCCURRENCE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CANONICAL_UTC_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function normalizeOccurrence(
  occurredAt: string,
  precision: UserOccurrencePrecision,
  currentTime: Date = new Date(),
): NormalizedOccurrence {
  const normalized = canonicalizeOccurrence(occurredAt, precision);
  assertValidCurrentTime(currentTime);
  if (precision === 'exact') {
    if (Date.parse(normalized.sort) > currentTime.getTime()) {
      throw new Error('Exact occurrence cannot be in the future');
    }
  } else if (normalized.source > localCalendarDate(currentTime)) {
    throw new Error('Date occurrence cannot be after the local calendar date');
  }
  return normalized;
}

export function canonicalizeOccurrence(
  occurredAt: string,
  precision: UserOccurrencePrecision,
): NormalizedOccurrence {
  if (precision === 'exact') return canonicalizeExactOccurrence(occurredAt);
  return canonicalizeDateOccurrence(occurredAt);
}

export function normalizeExactOccurrence(
  value: string,
  currentTime: Date = new Date(),
): NormalizedOccurrence {
  return normalizeOccurrence(value, 'exact', currentTime);
}

export function normalizeDateOccurrence(
  value: string,
  currentTime: Date = new Date(),
): NormalizedOccurrence {
  return normalizeOccurrence(value, 'date', currentTime);
}

function canonicalizeExactOccurrence(value: string): NormalizedOccurrence {
  const parsed = parseExactOccurrence(value.trim());
  const canonical = new Date(parsed.instant).toISOString();
  return { source: canonical, sort: canonical, precision: 'exact' };
}

function canonicalizeDateOccurrence(value: string): NormalizedOccurrence {
  const source = value.trim();
  const parsed = parseDateOccurrence(source);
  return {
    source,
    sort: `${formatYear(parsed.year)}-${twoDigits(parsed.month)}-${twoDigits(parsed.day)}T00:00:00.000Z`,
    precision: 'date',
  };
}

export function isValidOccurrenceInput(
  value: string,
  precision: UserOccurrencePrecision,
): boolean {
  try {
    if (precision === 'exact') parseExactOccurrence(value.trim());
    else parseDateOccurrence(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function isCanonicalUtcMillisecondTimestamp(value: string): boolean {
  if (!CANONICAL_UTC_MILLISECOND_PATTERN.test(value)) return false;
  const instant = Date.parse(value);
  return !Number.isNaN(instant) && new Date(instant).toISOString() === value;
}

function parseExactOccurrence(value: string): { instant: number } {
  const match = EXACT_OCCURRENCE_PATTERN.exec(value);
  if (match === null) {
    throw new Error(
      'Exact occurrence must be an ISO 8601 date-time with Z or an explicit offset',
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  assertCalendarFields(year, month, day);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error('Exact occurrence contains invalid time fields');
  }

  let offsetMinutes = 0;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      throw new Error('Exact occurrence contains an invalid UTC offset');
    }
    offsetMinutes =
      (offsetHour * 60 + offsetMinute) * (match[9] === '+' ? 1 : -1);
  }

  const wallClock = new Date(0);
  wallClock.setUTCHours(0, 0, 0, 0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, millisecond);
  const instant = wallClock.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(instant)) {
    throw new Error('Exact occurrence is outside the supported date range');
  }
  return { instant };
}

function parseDateOccurrence(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_OCCURRENCE_PATTERN.exec(value);
  if (match === null) {
    throw new Error('Date occurrence must use YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  assertCalendarFields(year, month, day);
  return { year, month, day };
}

function assertCalendarFields(year: number, month: number, day: number): void {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error('Occurrence contains an invalid calendar date');
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function localCalendarDate(value: Date): string {
  return `${formatYear(value.getFullYear())}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}`;
}

function formatYear(value: number): string {
  return value.toString().padStart(4, '0');
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function assertValidCurrentTime(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new Error('Current time is invalid');
}
