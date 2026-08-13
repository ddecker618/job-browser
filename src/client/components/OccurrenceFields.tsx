import { useId } from 'react';

import type { UserOccurrencePrecision } from '../../domain/application-status.js';

export interface OccurrenceDraft {
  precision: UserOccurrencePrecision;
  exactLocal: string;
  date: string;
}

export interface OccurrenceCommandFields {
  occurredAt: string;
  occurrencePrecision: UserOccurrencePrecision;
}

export function createOccurrenceDraft(now = new Date()): OccurrenceDraft {
  return {
    precision: 'exact',
    exactLocal: toLocalDateTimeInput(now),
    date: toLocalDateInput(now),
  };
}

export function occurrenceDraftFrom(
  occurredAt: string | null,
  precision: string,
  now = new Date(),
): OccurrenceDraft {
  const draft = createOccurrenceDraft(now);
  if (precision === 'date' && occurredAt !== null) {
    return { ...draft, precision: 'date', date: occurredAt.slice(0, 10) };
  }
  if (precision === 'exact' && occurredAt !== null) {
    const date = new Date(occurredAt);
    if (!Number.isNaN(date.getTime())) {
      return { ...draft, exactLocal: toLocalDateTimeInput(date) };
    }
  }
  return draft;
}

export function occurrenceCommandFields(
  draft: OccurrenceDraft,
): OccurrenceCommandFields {
  if (draft.precision === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      throw new Error('Choose a valid occurrence date.');
    }
    return { occurredAt: draft.date, occurrencePrecision: 'date' };
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      draft.exactLocal,
    );
  if (match === null) {
    throw new Error('Choose a valid local occurrence date and time.');
  }
  const [year, month, day, hour, minute, second, millisecond] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? '0'),
    Number((match[7] ?? '0').padEnd(3, '0')),
  ];
  const date = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getMilliseconds() !== millisecond
  ) {
    throw new Error('Choose a valid local occurrence date and time.');
  }
  return { occurredAt: date.toISOString(), occurrencePrecision: 'exact' };
}

export function OccurrenceFields({
  value,
  onChange,
  disabled = false,
}: {
  value: OccurrenceDraft;
  onChange: (value: OccurrenceDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const maximum = createOccurrenceDraft();
  return (
    <fieldset className="occurrence-fields" disabled={disabled}>
      <legend>When did this happen?</legend>
      <label htmlFor={`${id}-precision`}>
        Occurrence precision
        <select
          id={`${id}-precision`}
          value={value.precision}
          onChange={(event) =>
            onChange({
              ...value,
              precision: event.target.value as UserOccurrencePrecision,
            })
          }
        >
          <option value="exact">Exact local date and time</option>
          <option value="date">Date only</option>
        </select>
      </label>
      {value.precision === 'exact' ? (
        <label htmlFor={`${id}-exact`}>
          Exact local date and time
          <input
            id={`${id}-exact`}
            aria-label="Exact local date and time"
            type="datetime-local"
            step="0.001"
            max={maximum.exactLocal}
            required
            value={value.exactLocal}
            onChange={(event) =>
              onChange({ ...value, exactLocal: event.target.value })
            }
          />
          <small>Interpreted in this system&apos;s local time.</small>
        </label>
      ) : (
        <label htmlFor={`${id}-date`}>
          Date only
          <input
            id={`${id}-date`}
            aria-label="Date only"
            type="date"
            max={maximum.date}
            required
            value={value.date}
            onChange={(event) =>
              onChange({ ...value, date: event.target.value })
            }
          />
          <small>No time of day will be recorded.</small>
        </label>
      )}
    </fieldset>
  );
}

function toLocalDateTimeInput(date: Date): string {
  return `${toLocalDateInput(date)}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(
    3,
    '0',
  )}`;
}

function toLocalDateInput(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
