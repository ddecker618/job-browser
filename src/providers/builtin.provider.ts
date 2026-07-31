import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'parse5';
import { z } from 'zod';

import type { EmploymentType, RemoteType } from '../domain/job.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderConfiguration,
  ValidationResult,
} from '../models/source-management.js';
import { normalizeJob } from '../normalizer/jobNormalizer.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/builtin-search-response.html', import.meta.url),
);
const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  location: z.string().optional().default(''),
  queries: z
    .array(
      z.strictObject({
        keywords: z.string().trim().min(1),
        location: z.string().optional().default(''),
      }),
    )
    .optional()
    .default([
      { keywords: 'systems administrator', location: '' },
      { keywords: 'network administrator', location: '' },
      { keywords: 'network analyst', location: '' },
      { keywords: 'SOC analyst', location: '' },
    ]),
  remoteFilter: z
    .enum(['remote', 'hybrid', 'onsite', ''])
    .optional()
    .default(''),
  datePosted: z
    .enum(['24h', 'week', 'month', 'any'])
    .optional()
    .default('month'),
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  fetchDetails: z.boolean().optional().default(true),
});

const jobSchema = z.strictObject({
  jobId: z.string().nullable(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  salaryText: z.string().nullable(),
  salaryMinimum: z.number().nullable(),
  salaryMaximum: z.number().nullable(),
  description: z.string().nullable(),
  requirements: z.string().nullable(),
  preferredQualifications: z.string().nullable(),
  postingUrl: z.string().nullable(),
  postedDate: z.string().nullable(),
  employmentType: z.string().nullable(),
  workplaceType: z.string().nullable(),
  seniorityLevel: z.string().nullable(),
  cardText: z.string(),
});

type BuiltInConfiguration = z.infer<typeof configurationSchema>;
type BuiltInJob = z.infer<typeof jobSchema>;

export class BuiltInProvider extends BaseProvider {
  public readonly id = 'builtin';
  public readonly name = 'Built In';
  public readonly type = 'job-board' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: true,
  } as const;

  public constructor(
    private readonly http: ProviderHttpClient = providerHttpClient,
  ) {
    super();
  }

  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success) {
      return {
        valid: false,
        message:
          parsed.error.issues[0]?.message ?? 'Invalid Built In configuration',
        normalizedConfiguration: null,
        preview: null,
      };
    }

    if (
      process.env['NODE_ENV'] === 'test' ||
      process.env['VITEST'] === 'true'
    ) {
      return {
        valid: true,
        message: 'Built In configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }

    try {
      const query =
        parsed.data.queries[0]?.keywords ?? parsed.data.searchKeywords;
      const location = parsed.data.queries[0]?.location ?? parsed.data.location;
      const target = buildSearchUrl(query, location, parsed.data);
      const response = await this.http.request(target, {
        provider: this.name,
        headers: { Accept: 'text/html' },
      });
      const jobs = parseBuiltInSearchHtml(response.text(), response.url);
      if (jobs.length === 0) {
        return {
          valid: false,
          message: 'Built In returned no recognizable job cards',
          normalizedConfiguration: null,
          preview: null,
          failureCategory: 'invalid_response',
        };
      }
      return {
        valid: true,
        message: `Found ${String(jobs.length)} Built In job card(s)`,
        normalizedConfiguration: parsed.data,
        preview: previewFor(jobs),
      };
    } catch (error) {
      return {
        valid: false,
        message: builtInErrorMessage(error),
        normalizedConfiguration: null,
        preview: null,
      };
    }
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const rawConfiguration = options.configuration ?? {};
    const parsed = configurationSchema.parse(rawConfiguration);
    const configuration = effectiveConfiguration(
      parsed,
      rawConfiguration,
      request,
    );
    const firstQuery = configuration.queries[0];
    const query = firstQuery?.keywords ?? configuration.searchKeywords;
    const location = firstQuery?.location ?? configuration.location;
    return Promise.resolve({
      request,
      target: buildSearchUrl(query, location, configuration),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      configuration: configuration as unknown as Record<string, unknown>,
    });
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    const configuration = configurationSchema.parse(search.configuration ?? {});
    const targets =
      search.fixturePath !== null
        ? [search.target]
        : resolveQueries(configuration, search.request).map((query) =>
            buildSearchUrl(query.keywords, query.location, configuration),
          );
    let jobs: BuiltInJob[] = [];

    for (const target of targets) {
      const body =
        search.fixturePath !== null
          ? readFileSync(search.fixturePath, 'utf8')
          : (
              await this.http.request(target, {
                provider: this.name,
                signal: search.signal,
                headers: {
                  Accept: 'text/html',
                  'User-Agent': 'job-browser/1.0 (local job discovery)',
                },
              })
            ).text();
      jobs.push(...parseBuiltInSearchHtml(body, target));
      if (jobs.length >= configuration.maxResults) break;
    }

    jobs = deduplicateJobs(jobs);
    const limit = Math.min(
      configuration.maxResults,
      Math.max(1, search.request.limit),
    );
    const candidates = jobs
      .filter((job) => matchesRequest(job, search.request))
      .slice(0, limit);
    const filtered =
      configuration.fetchDetails && search.fixturePath === null
        ? await this.enrichDetails(candidates, search.signal)
        : candidates;
    return {
      records: filtered,
      rejected: jobs.length - candidates.length,
      truncated: jobs.length > candidates.length,
      complete: jobs.length < limit,
      unfilteredCount: jobs.length,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = clean(raw.location);
    const locationParts = splitLocation(location);
    const salaryMinimum =
      raw.salaryMinimum ?? parseSalary(raw.salaryText).minimum;
    const salaryMaximum =
      raw.salaryMaximum ?? parseSalary(raw.salaryText).maximum;
    const postingUrl = safeUrl(raw.postingUrl);
    const workplaceText = `${raw.workplaceType ?? ''} ${location ?? ''} ${raw.cardText}`;
    const employmentText = `${raw.employmentType ?? ''} ${raw.cardText}`;
    return normalizeJob({
      externalId: raw.jobId ?? postingUrl,
      title: raw.title ?? 'Untitled Position',
      company: raw.company ?? 'Unknown Company',
      location,
      city: locationParts.city,
      state: locationParts.state,
      remoteType: inferRemoteType(workplaceText),
      employmentType: inferEmploymentType(employmentText),
      salaryMinimum,
      salaryMaximum,
      salaryText: clean(raw.salaryText),
      description: clean(raw.description),
      requirements: clean(raw.requirements),
      preferredQualifications: clean(raw.preferredQualifications),
      postingUrl,
      applicationUrls: postingUrl === null ? [] : [postingUrl],
      providerId: this.id,
      providerName: this.name,
      datePosted: toIso(raw.postedDate),
      discoveredAt,
      seniorityLevel: inferSeniority(raw.title),
    });
  }

  private async enrichDetails(
    jobs: BuiltInJob[],
    signal: AbortSignal | undefined,
  ): Promise<BuiltInJob[]> {
    const enriched: BuiltInJob[] = [];
    for (const job of jobs) {
      if (job.postingUrl === null) {
        enriched.push(job);
        continue;
      }
      try {
        const response = await this.http.request(job.postingUrl, {
          provider: this.name,
          signal,
          headers: {
            Accept: 'text/html',
            'User-Agent': 'job-browser/1.0 (local job discovery)',
          },
        });
        const detail = parseBuiltInJobPosting(response.text(), response.url);
        enriched.push(detail === null ? job : { ...job, ...detail });
      } catch {
        enriched.push(job);
      }
    }
    return enriched;
  }
}

export function parseBuiltInSearchHtml(
  body: string,
  sourceUrl: string,
): BuiltInJob[] {
  const document = parse(body) as HtmlNode;
  const cards: HtmlNode[] = [];
  walk(document, (node) => {
    if (attribute(node, 'data-id') === 'job-card') cards.push(node);
  });

  return cards.map((card) => {
    const titleNode = findNode(
      card,
      (node) => attribute(node, 'data-id') === 'job-card-title',
    );
    const companyNode = findNode(
      card,
      (node) => attribute(node, 'data-id') === 'company-title',
    );
    const title = clean(textContent(titleNode));
    const company = clean(textContent(companyNode));
    const href = absoluteUrl(
      attribute(
        findNode(titleNode, (node) => node.nodeName === 'a'),
        'href',
      ),
      sourceUrl,
    );
    const cardText = textContent(card);
    const jobId =
      idFromUrl(href) ??
      attribute(card, 'id')?.match(/job-card-(\d+)/)?.[1] ??
      attribute(titleNode, 'data-builtin-track-job-id') ??
      attribute(companyNode, 'data-builtin-track-job-id') ??
      null;
    const salaryMatch =
      /\$[\d,.]+(?:\s*[kK])?(?:\s*[-–]\s*\$?[\d,.]+(?:\s*[kK])?)?/.exec(
        cardText,
      );
    const salaryText = salaryMatch?.[0] ?? null;
    return {
      jobId,
      title,
      company,
      location: extractLocation(cardText),
      salaryText,
      salaryMinimum: null,
      salaryMaximum: null,
      description: null,
      requirements: null,
      preferredQualifications: null,
      postingUrl: href,
      postedDate: extractPostedDate(cardText),
      employmentType: extractEmploymentType(cardText),
      workplaceType: extractWorkplaceType(cardText),
      seniorityLevel: null,
      cardText,
    };
  });
}

export function parseBuiltInJobPosting(
  body: string,
  sourceUrl: string,
): Partial<BuiltInJob> | null {
  const document = parse(body) as HtmlNode;
  const posting = extractFirstJobPosting(document);
  if (posting === null) return null;

  const location = jsonLocation(property(posting, 'jobLocation'));
  const salary = jsonSalary(property(posting, 'baseSalary'));
  const organizationValue = property(posting, 'hiringOrganization');
  const organization = isRecord(organizationValue) ? organizationValue : null;
  const postingUrl = safeUrl(textValue(property(posting, 'url')) ?? sourceUrl);
  const identifier = textValue(property(posting, 'identifier'));
  const identifierRecord = property(posting, 'identifier');
  const identifierValue = isRecord(identifierRecord)
    ? textValue(property(identifierRecord, 'value'))
    : null;
  const description = cleanHtml(textValue(property(posting, 'description')));
  const jobLocationType = textValue(property(posting, 'jobLocationType'));
  return {
    jobId: identifier ?? identifierValue ?? idFromUrl(postingUrl),
    title: textValue(property(posting, 'title')),
    company:
      organization === null ? null : textValue(property(organization, 'name')),
    location,
    salaryText: salary.label,
    salaryMinimum: salary.minimum,
    salaryMaximum: salary.maximum,
    description,
    requirements: cleanHtml(textValue(property(posting, 'qualifications'))),
    preferredQualifications: cleanHtml(
      textValue(property(posting, 'experienceRequirements')),
    ),
    postingUrl,
    postedDate: textValue(property(posting, 'datePosted')),
    employmentType: textValue(property(posting, 'employmentType')),
    workplaceType: /telecommute|remote/i.test(jobLocationType ?? '')
      ? 'remote'
      : extractWorkplaceType(
          `${jobLocationType ?? ''} ${location ?? ''} ${description ?? ''}`,
        ),
  };
}

function buildSearchUrl(
  query: string,
  location: string,
  configuration: BuiltInConfiguration,
): string {
  const url = new URL('https://builtin.com/jobs');
  url.searchParams.set('search', query.trim());
  if (location.trim()) url.searchParams.set('location', location.trim());
  if (configuration.remoteFilter)
    url.searchParams.set('remote', configuration.remoteFilter);
  if (configuration.datePosted !== 'any')
    url.searchParams.set('datePosted', configuration.datePosted);
  return url.toString();
}

function resolveQueries(
  configuration: BuiltInConfiguration,
  request: SearchRequest,
): { keywords: string; location: string }[] {
  if (configuration.queries.length > 0) {
    return configuration.queries.map((query) => ({
      keywords: query.keywords,
      location: query.location.trim() ? query.location : configuration.location,
    }));
  }
  return [
    {
      keywords: configuration.searchKeywords,
      location: configuration.location.trim()
        ? configuration.location
        : (request.location ?? ''),
    },
  ];
}

function effectiveConfiguration(
  configuration: BuiltInConfiguration,
  raw: ProviderConfiguration,
  request: SearchRequest,
): BuiltInConfiguration {
  if (
    configuration.queries.length === 0 &&
    typeof raw['searchKeywords'] !== 'string' &&
    request.query.trim()
  ) {
    return {
      ...configuration,
      searchKeywords: request.query.trim(),
      location: configuration.location.trim()
        ? configuration.location
        : (request.location ?? ''),
    };
  }
  return configuration;
}

function matchesRequest(job: BuiltInJob, request: SearchRequest): boolean {
  const text = [
    job.title,
    job.company,
    job.location,
    job.description,
    job.cardText,
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();
  const query = request.query.trim().toLowerCase();
  const location = request.location?.trim().toLowerCase() ?? '';
  return (
    (query === '' || text.includes(query)) &&
    (location === '' || text.includes(location)) &&
    (!request.remoteOnly || inferRemoteType(text) === 'remote')
  );
}

function deduplicateJobs(jobs: BuiltInJob[]): BuiltInJob[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key =
      job.jobId ?? job.postingUrl ?? `${job.company ?? ''}-${job.title ?? ''}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function previewFor(jobs: readonly BuiltInJob[]): ValidationResult['preview'] {
  return {
    format: 'Built In HTML job cards',
    jobCount: jobs.length,
    samples: jobs.slice(0, 3).map((job) => ({
      title: job.title ?? 'Untitled job',
      company: job.company ?? 'Unknown employer',
      location: job.location,
    })),
    warnings: [
      'Job descriptions and structured details are loaded during discovery.',
    ],
  };
}

function builtInErrorMessage(error: unknown): string {
  if (error instanceof ProviderFetchError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/404|not found/i.test(message)) return 'Built In jobs page was not found';
  if (/timeout|timed out/i.test(message))
    return 'Built In validation timed out';
  return 'Built In is unreachable or returned an invalid response';
}

function extractLocation(text: string): string | null {
  const match =
    /(?:^|\s)(Remote|Anywhere|[A-Z][A-Za-z .'-]+,\s*[A-Z]{2})(?:\s|$)/.exec(
      text,
    );
  return match?.[1] ?? null;
}

function extractPostedDate(text: string): string | null {
  return (
    /(?:just now|\d+\+?\s+(?:minute|hour|day|week|month)s?\s+ago)/i.exec(
      text,
    )?.[0] ?? null
  );
}

function extractEmploymentType(text: string): string | null {
  return (
    /(?:full[- ]time|part[- ]time|contract|temporary|internship)/i.exec(
      text,
    )?.[0] ?? null
  );
}

function extractWorkplaceType(text: string): string | null {
  return /(?:remote|hybrid|on[- ]site|onsite)/i.exec(text)?.[0] ?? null;
}

function inferRemoteType(text: string): RemoteType {
  const lower = text.toLowerCase();
  if (lower.includes('hybrid')) return 'hybrid';
  if (/remote|anywhere|work from home|telecommute/.test(lower)) return 'remote';
  if (/on[- ]site|onsite/.test(lower)) return 'onsite';
  return 'unknown';
}

function inferEmploymentType(text: string): EmploymentType {
  const lower = text.toLowerCase();
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('part-time')) return 'part-time';
  if (lower.includes('contract')) return 'contract';
  if (lower.includes('temporary')) return 'temporary';
  if (lower.includes('full-time')) return 'full-time';
  return 'unknown';
}

function inferSeniority(title: string | null): NormalizedJob['seniorityLevel'] {
  const lower = (title ?? '').toLowerCase();
  if (/chief|cto|ceo|executive/.test(lower)) return 'executive';
  if (/director|vp|vice president/.test(lower)) return 'director';
  if (lower.includes('manager')) return 'manager';
  if (/lead|principal|staff/.test(lower)) return 'lead';
  if (/senior|sr\.?/.test(lower)) return 'senior';
  if (/junior|jr\.?/.test(lower)) return 'junior';
  if (/entry|associate|intern|graduate/.test(lower)) return 'entry';
  return 'unknown';
}

function parseSalary(text: string | null): {
  minimum: number | null;
  maximum: number | null;
} {
  if (!text) return { minimum: null, maximum: null };
  const values = (text.match(/\$?\s*\d[\d,.]*(?:\s*[kK])?/g) ?? [])
    .map((value) => {
      const thousands = /k/i.test(value);
      const number = Number(value.replace(/[$,\s]/g, '').replace(/[kK]$/i, ''));
      return thousands ? number * 1_000 : number;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    minimum: values[0] ?? null,
    maximum: values.length > 1 ? (values[1] ?? null) : null,
  };
}

function splitLocation(location: string | null): {
  city: string | null;
  state: string | null;
} {
  if (!location || inferRemoteType(location) === 'remote')
    return { city: null, state: null };
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function clean(value: string | null): string | null {
  const result = value?.trim() ?? '';
  return result || null;
}

function cleanHtml(value: string | null): string | null {
  return value === null ? null : htmlToText(value);
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function absoluteUrl(value: string | null, sourceUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return null;
  }
}

function idFromUrl(value: string | null): string | null {
  if (!value) return null;
  const match = /\/job\/[^/]+\/(\d+)/i.exec(value);
  return match?.[1] ?? null;
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    const type = current['@type'];
    if (
      type === 'JobPosting' ||
      (Array.isArray(type) && type.includes('JobPosting'))
    ) {
      return current;
    }
    for (const key of ['@graph', 'itemListElement', 'mainEntity']) {
      if (current[key] !== undefined) pending.push(current[key]);
    }
  }
  return null;
}

function extractFirstJobPosting(
  document: HtmlNode,
): Record<string, unknown> | null {
  let posting: Record<string, unknown> | null = null;
  walk(document, (node) => {
    if (posting !== null || node.nodeName !== 'script') return;
    if (attribute(node, 'type')?.toLowerCase() !== 'application/ld+json')
      return;
    try {
      posting = findJobPosting(JSON.parse(textContent(node)) as unknown);
    } catch {
      // Ignore invalid structured data blocks.
    }
  });
  return posting;
}

function jsonLocation(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (!isRecord(first)) return typeof first === 'string' ? first : null;
  const address = first['address'];
  if (typeof address === 'string') return address;
  if (!isRecord(address)) return textValue(first['name']);
  return (
    [
      textValue(address['addressLocality']),
      textValue(address['addressRegion']),
      textValue(address['postalCode']),
    ]
      .filter((part): part is string => part !== null)
      .join(', ') || null
  );
}

function jsonSalary(value: unknown): {
  label: string | null;
  minimum: number | null;
  maximum: number | null;
} {
  if (!isRecord(value)) return { label: null, minimum: null, maximum: null };
  const currency = textValue(value['currency']) ?? 'USD';
  const amount = value['value'];
  if (typeof amount === 'number') {
    return {
      label: `$${amount.toLocaleString('en-US')} ${currency}`,
      minimum: amount,
      maximum: null,
    };
  }
  if (!isRecord(amount)) return { label: null, minimum: null, maximum: null };
  const minimum = numberValue(amount['minValue']);
  const maximum = numberValue(amount['maxValue']);
  const values = [minimum, maximum]
    .filter((part): part is number => part !== null)
    .map((part) => `$${part.toLocaleString('en-US')}`);
  return {
    label:
      values.length > 0
        ? `${values.join(' - ')} ${textValue(amount['unitText']) ?? currency}`
        : null,
    minimum,
    maximum,
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const result = Number(value.replaceAll(',', ''));
  return Number.isFinite(result) ? result : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result || null;
}

function property(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

interface HtmlNode {
  nodeName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}

function walk(node: HtmlNode, callback: (node: HtmlNode) => void): void {
  const pending: HtmlNode[] = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    callback(current);
    pending.push(...(current.childNodes ?? []));
  }
}

function findNode(
  node: HtmlNode | null,
  predicate: (node: HtmlNode) => boolean,
): HtmlNode | null {
  if (node === null) return null;
  let found: HtmlNode | null = null;
  walk(node, (candidate) => {
    if (found === null && predicate(candidate)) found = candidate;
  });
  return found;
}

function attribute(node: HtmlNode | null, name: string): string | null {
  return node?.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

function textContent(node: HtmlNode | null): string {
  if (node === null) return '';
  let result = '';
  walk(node, (current) => {
    if (current.value) result += `${current.value} `;
  });
  return result.replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default new BuiltInProvider();
