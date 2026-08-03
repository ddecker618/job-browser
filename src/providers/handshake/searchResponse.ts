import { htmlToText } from '../../utils/html.js';

export interface HandshakeRawJob {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  description: string | null;
  postingUrl: string;
  postedDate: string | null;
  closingDate: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  applicationUrls: string[];
}

export interface HandshakeSearchPage {
  jobs: HandshakeRawJob[];
  totalCount: number;
  hasNextPage: boolean | null;
  rejected: number;
}

export function parseHandshakeSearchPayload(
  payload: unknown,
): HandshakeSearchPage {
  const root = Array.isArray(payload)
    ? (payload
        .map(record)
        .find((candidate) =>
          record(record(candidate?.['data'])?.['jobSearch']),
        ) ?? record(payload[0]))
    : record(payload);
  const data = record(root?.['data']);
  const connection = record(data?.['jobSearch']);
  if (connection === null) {
    const errors = array(root?.['errors'])
      .map((value) => stringValue(record(value)?.['message']))
      .filter((value): value is string => value !== null);
    throw new Error(
      errors[0] ??
        'Handshake JobSearchQuery response did not include data.jobSearch',
    );
  }

  const edges = array(connection['edges']);
  const jobs: HandshakeRawJob[] = [];
  let rejected = 0;
  for (const value of edges) {
    const node = record(record(value)?.['node']);
    const job = record(node?.['job']) ?? node;
    const parsed = job === null ? null : parseJob(job);
    if (parsed === null) rejected++;
    else jobs.push(parsed);
  }

  const pageInfo = record(connection['pageInfo']);
  return {
    jobs,
    totalCount:
      numberValue(
        connection['totalCount'] ??
          connection['aggregateCount'] ??
          connection['total'],
      ) ?? jobs.length,
    hasNextPage: booleanValue(pageInfo?.['hasNextPage']),
    rejected,
  };
}

function parseJob(job: Record<string, unknown>): HandshakeRawJob | null {
  const jobId = scalarString(job['id']);
  const title = stringValue(job['title']);
  if (jobId === null || title === null) return null;

  const employer = record(job['employer']);
  const company =
    stringValue(employer?.['name']) ??
    stringValue(job['employerName']) ??
    'Unknown Employer';
  const workplaceType = workArrangement(job);
  const location = locationValue(job, workplaceType);
  const salary = salaryValue(job);
  const descriptionValue =
    stringValue(job['description']) ??
    stringValue(record(job['description'])?.['text']) ??
    stringValue(record(job['description'])?.['html']);

  return {
    jobId,
    title,
    company,
    location,
    salaryText: salary.text,
    salaryMinimum: salary.minimum,
    salaryMaximum: salary.maximum,
    description:
      descriptionValue === null ? null : htmlToText(descriptionValue) || null,
    postingUrl: `https://app.joinhandshake.com/job-search/${encodeURIComponent(jobId)}`,
    postedDate:
      scalarString(job['createdAt']) ?? scalarString(job['applyStart']),
    closingDate: scalarString(job['expirationDate']),
    employmentType:
      stringValue(job['employmentType']) ??
      stringValue(job['jobType']) ??
      stringValue(job['workSchedule']),
    workplaceType,
    applicationUrls: applicationUrls(job),
  };
}

function workArrangement(job: Record<string, unknown>): string | null {
  const explicit = stringValue(job['workLocationType']);
  if (explicit !== null) return explicit;
  if (booleanValue(job['remote']) === true) return 'remote';
  if (booleanValue(job['hybrid']) === true) return 'hybrid';
  if (booleanValue(job['onSite']) === true) return 'onsite';
  return null;
}

function locationValue(
  job: Record<string, unknown>,
  workplaceType: string | null,
): string | null {
  for (const value of array(job['locations'])) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    const location = record(value);
    if (location === null) continue;
    const label =
      stringValue(location['label']) ??
      stringValue(location['name']) ??
      stringValue(location['text']) ??
      stringValue(location['formattedAddress']) ??
      cityState(location);
    if (label !== null) return label;
  }
  return workplaceType?.toLowerCase().includes('remote') === true
    ? 'Remote'
    : null;
}

function cityState(location: Record<string, unknown>): string | null {
  const city = stringValue(location['city']);
  const state =
    stringValue(location['state']) ?? stringValue(location['region']);
  if (city !== null && state !== null) return `${city}, ${state}`;
  return city ?? state;
}

function salaryValue(job: Record<string, unknown>): {
  text: string | null;
  minimum: number | null;
  maximum: number | null;
} {
  const range =
    record(job['salaryRange']) ??
    record(array(job['remunerations'])[0]) ??
    null;
  if (range === null) return { text: null, minimum: null, maximum: null };

  const minimum = minorUnits(
    numberValue(
      range['minimumAmount'] ??
        range['minimum'] ??
        range['min'] ??
        range['lowerBound'],
    ),
  );
  const maximum = minorUnits(
    numberValue(
      range['maximumAmount'] ??
        range['maximum'] ??
        range['max'] ??
        range['upperBound'],
    ),
  );
  const interval =
    stringValue(range['paySchedule']) ??
    stringValue(range['salaryType']) ??
    stringValue(job['salaryType']);
  const currency = stringValue(range['currency']) ?? 'USD';
  const values = [minimum, maximum].filter(
    (value): value is number => value !== null,
  );
  const formatted = values.map((value) => formatMoney(value, currency));
  return {
    minimum,
    maximum,
    text:
      formatted.length === 0
        ? null
        : `${formatted.join(' - ')}${interval === null ? '' : ` ${interval}`}`,
  };
}

function minorUnits(value: number | null): number | null {
  return value === null ? null : value / 100;
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function applicationUrls(job: Record<string, unknown>): string[] {
  const settings = record(job['jobApplySetting']);
  const candidates = [
    settings?.['externalUrl'],
    settings?.['alternativeExternalUrl'],
    job['externalApplyUrl'],
    job['applicationUrl'],
  ];
  return candidates
    .map(stringValue)
    .filter((value): value is string => value !== null)
    .filter(
      (value, index, values) =>
        isHttpUrl(value) && values.indexOf(value) === index,
    );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
