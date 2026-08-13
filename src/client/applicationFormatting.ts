import type {
  ApplicationCorrectionIneligibilityReason,
  ApplicationEventType,
} from '../domain/application-history.js';
import type {
  ApplicationStatus,
  OccurrencePrecision,
} from '../domain/application-status.js';

const statusLabels: Readonly<Record<ApplicationStatus, string>> = {
  applied: 'Applied',
  recruiter_contact: 'Recruiter contact',
  phone_screen: 'Phone screen',
  technical_interview: 'Technical interview',
  manager_interview: 'Manager interview',
  final_interview: 'Final interview',
  interview: 'Interview (stage unknown)',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  withdrawn: 'Withdrawn',
  unknown_legacy_state: 'Unknown legacy state',
};

const eventLabels: Readonly<Record<ApplicationEventType, string>> = {
  applied: 'Applied',
  recruiter_contact: 'Recruiter contact',
  phone_screen: 'Phone screen',
  technical_interview: 'Technical interview',
  manager_interview: 'Manager interview',
  final_interview: 'Final interview',
  interview: 'Interview (stage unknown)',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  withdrawn: 'Withdrawn',
  note: 'Timeline Note',
  void: 'Void',
  legacy_state_imported: 'Legacy state imported',
  legacy_applied_date_imported: 'Legacy applied date imported',
};

const ineligibilityLabels: Readonly<
  Record<ApplicationCorrectionIneligibilityReason, string>
> = {
  superseded: 'Superseded record',
  void_event: 'Void records cannot be corrected',
  migration_event: 'Migration records cannot be corrected',
  missing_recorded_time: 'Recorded time is unavailable',
  unsupported_event_type: 'This event type cannot be corrected',
  not_effective: 'Record is not effective',
  final_effective_status: 'The final effective status cannot be voided',
};

const precisionLabels: Readonly<Record<OccurrencePrecision, string>> = {
  exact: 'Exact date and time',
  date: 'Date only',
  approximate: 'Approximate',
  unknown: 'Unknown',
};

const calendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const localDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function applicationStatusLabel(status: ApplicationStatus): string {
  return statusLabels[status];
}

export function applicationEventLabel(eventType: ApplicationEventType): string {
  return eventLabels[eventType];
}

export function correctionIneligibilityLabel(
  reason: ApplicationCorrectionIneligibilityReason,
): string {
  return ineligibilityLabels[reason];
}

export function occurrencePrecisionLabel(
  precision: OccurrencePrecision,
): string {
  return precisionLabels[precision];
}

export function formatOccurrence(
  value: string | null,
  precision: OccurrencePrecision | null,
): string {
  if (precision === null || precision === 'unknown') return 'Unknown';
  if (precision === 'date') {
    return value === null
      ? 'Unknown date (date only)'
      : `${formatDateOnly(value)} (date only)`;
  }
  if (precision === 'approximate') {
    return value === null
      ? 'Approximate date unknown'
      : `${formatBestEffortDate(value)} (approximate)`;
  }
  return value === null ? 'Exact time unavailable' : formatExactDateTime(value);
}

export function formatRecordedAt(value: string | null): string {
  return value === null ? 'No recorded activity' : formatExactDateTime(value);
}

export function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return value;
  }
  return calendarDateFormatter.format(date);
}

export function formatExactDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : localDateTimeFormatter.format(date);
}

function formatBestEffortDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateOnly(value);
  return formatExactDateTime(value);
}
