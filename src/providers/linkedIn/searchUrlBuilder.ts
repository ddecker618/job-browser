export type LinkedInDatePosted = 'r86400' | 'r604800' | 'r2592000' | 'any';
export type LinkedInExperienceLevel = '1' | '2' | '3' | '4' | '5' | '6';
export type LinkedInEmploymentType = 'F' | 'C' | 'P' | 'T' | 'I' | 'V';
export type LinkedInRemoteFilter = '1' | '2' | '3';
export type LinkedInSortBy = 'DD' | 'R' | 'PA';

export const DATE_POSTED_MAP: Record<string, LinkedInDatePosted> = {
  '24h': 'r86400',
  week: 'r604800',
  month: 'r2592000',
  any: 'any',
};

export const EXPERIENCE_MAP: Record<string, LinkedInExperienceLevel> = {
  internship: '1',
  entry: '2',
  associate: '3',
  mid: '3',
  senior: '4',
  lead: '5',
  director: '6',
  executive: '6',
};

export const EMPLOYMENT_TYPE_MAP: Record<string, LinkedInEmploymentType> = {
  'full-time': 'F',
  contract: 'C',
  'part-time': 'P',
  temporary: 'T',
  internship: 'I',
  volunteer: 'V',
};

export const REMOTE_MAP: Record<string, LinkedInRemoteFilter> = {
  remote: '3',
  hybrid: '2',
  onsite: '1',
};

export function fwt(value: string): string {
  return encodeURIComponent(value);
}

export function buildLinkedInSearchUrl(params: {
  keywords: string;
  location: string | null;
  remoteFilter: string | null;
  distance: number | null;
  datePosted: string | null;
  experienceLevel: string | null;
  employmentType: string | null;
  salary: number | null;
  sortBy: LinkedInSortBy;
  page: number;
}): string {
  const url = new URL('https://www.linkedin.com/jobs/search/');

  url.searchParams.set('keywords', params.keywords);
  if (params.location?.trim()) {
    url.searchParams.set('location', params.location.trim());
  }
  if (params.remoteFilter) {
    url.searchParams.set('f_WT', params.remoteFilter);
  }
  if (params.distance && params.distance > 0) {
    url.searchParams.set('distance', String(params.distance));
  }
  if (params.datePosted && params.datePosted !== 'any') {
    url.searchParams.set('f_TPR', params.datePosted);
  }
  if (params.experienceLevel) {
    url.searchParams.set('f_E', params.experienceLevel);
  }
  if (params.employmentType) {
    url.searchParams.set('f_JT', params.employmentType);
  }
  if (params.salary && params.salary > 0) {
    url.searchParams.set('f_SB2', String(params.salary));
  }
  url.searchParams.set('sortBy', params.sortBy);
  if (params.page > 1) {
    url.searchParams.set('start', String((params.page - 1) * 25));
  }

  return url.toString();
}

export function buildJobDetailUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${encodeURIComponent(jobId)}/`;
}

export function extractJobIdFromUrl(url: string): string | null {
  const match = /\/jobs\/view\/(\d+)/.exec(url);
  return match?.[1] ?? null;
}

export function extractJobIdFromCard(element: {
  href?: string | null;
  dataId?: string | null;
  dataset?: Record<string, string>;
}): string | null {
  if (element.dataId) return element.dataId;
  if (element.href) return extractJobIdFromUrl(element.href);
  if (element.dataset?.['jobId']) return element.dataset['jobId'];
  if (element.dataset?.['entityUrn']) {
    const match = /:(\d+)$/.exec(element.dataset['entityUrn']);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseRelativeDate(text: string): {
  text: string;
  estimated: string | null;
} {
  const lower = text.toLowerCase().trim();
  const now = Date.now();

  const patterns: [RegExp, (m: RegExpExecArray) => number][] = [
    [
      /(\d+)\s*hours?\s+ago/i,
      (m) => parseInt(m[1] ?? '0', 10) * 60 * 60 * 1000,
    ],
    [/(\d+)\s*hour\s+ago/i, (m) => parseInt(m[1] ?? '0', 10) * 60 * 60 * 1000],
    [
      /(\d+)\s*day[s]?\s+ago/i,
      (m) => parseInt(m[1] ?? '0', 10) * 24 * 60 * 60 * 1000,
    ],
    [
      /(\d+)\s*week[s]?\s+ago/i,
      (m) => parseInt(m[1] ?? '0', 10) * 7 * 24 * 60 * 60 * 1000,
    ],
    [
      /(\d+)\s*month[s]?\s+ago/i,
      (m) => parseInt(m[1] ?? '0', 10) * 30 * 24 * 60 * 60 * 1000,
    ],
    [/just\s+now/i, () => 0],
    [/moments?\s+ago/i, () => 60 * 1000],
    [/today/i, () => 0],
    [/yesterday/i, () => 24 * 60 * 60 * 1000],
    [/30\+?\s*days?\s+ago/i, () => 30 * 24 * 60 * 60 * 1000],
  ];

  for (const [pattern, offsetFn] of patterns) {
    const match = pattern.exec(lower);
    if (match) {
      const estimatedTime = new Date(now - offsetFn(match)).toISOString();
      return { text, estimated: estimatedTime };
    }
  }

  return { text, estimated: null };
}
