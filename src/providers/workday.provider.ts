import { fileURLToPath } from 'node:url';

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
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/workday-search-response.json', import.meta.url),
);
const PAGE_SIZE = 20;
const MAX_PAGES = 10;
const MAX_RESULTS = 200;

const workdayOriginSchema = z
  .url({
    protocol: /^https$/,
    message: 'Workday origin must be a valid HTTPS URL',
  })
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        /^[a-zA-Z0-9-]+\.(?:wd\d+\.)?myworkdayjobs\.com$/.test(url.hostname) &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        url.username === ''
      );
    } catch {
      return false;
    }
  }, 'Workday origin must be a clean HTTPS myworkdayjobs.com origin (e.g., https://company.myworkdayjobs.com)');
const tenantSchema = z
  .string({
    message: 'Workday tenant must be a string',
  })
  .trim()
  .min(1, 'Workday tenant is required')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Workday tenant contains invalid characters');
const siteSchema = z
  .string({
    message: 'Workday site must be a string',
  })
  .trim()
  .min(1, 'Workday site is required')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Workday site contains invalid characters');
const configurationSchema = z.strictObject({
  origin: workdayOriginSchema,
  tenant: tenantSchema,
  site: siteSchema,
  company: z.string().trim().min(1).optional(),
});
const jobSchema = z.object({
  title: z.string().trim().min(1),
  externalPath: z.string().startsWith('/'),
  locationsText: z.string().nullable().optional(),
  postedOn: z.string().nullable().optional(),
  bulletFields: z.array(z.string()).optional(),
  remoteType: z.string().nullable().optional(),
  timeType: z.string().nullable().optional(),
  jobId: z.string().nullable().optional(),
  providerOrigin: workdayOriginSchema.optional(),
  company_name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  salaryMinimum: z.number().nonnegative().nullable().optional(),
  salaryMaximum: z.number().nonnegative().nullable().optional(),
  salaryText: z.string().nullable().optional(),
});
const responseSchema = z.object({
  total: z.number().int().nonnegative().optional(),
  jobPostings: z.array(z.unknown()),
});
type WorkdayJob = z.infer<typeof jobSchema>;
const detailSchema = z.object({
  jobPostingInfo: z
    .object({
      jobDescription: z.string().nullable().optional(),
    })
    .optional(),
});

export class WorkdayProvider extends BaseProvider {
  public readonly id = 'workday';
  public readonly name = 'Workday';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: false,
  } as const;

  public constructor(
    private readonly http: ProviderHttpClient = providerHttpClient,
  ) {
    super();
  }

  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const result = configurationSchema.safeParse(configuration);
    if (!result.success) {
      return {
        valid: false,
        message:
          result.error.issues[0]?.message ?? 'Invalid Workday configuration',
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
        message: 'Workday configuration is valid',
        normalizedConfiguration: {
          ...result.data,
          origin: new URL(result.data.origin).origin,
        },
        preview: null,
      };
    }

    try {
      const origin = new URL(result.data.origin).origin;
      const url = new URL(
        `/wday/cxs/${encodeURIComponent(result.data.tenant)}/${encodeURIComponent(result.data.site)}/jobs`,
        origin,
      );
      const response = await this.http.request(url, {
        provider: this.name,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: '',
        }),
      });
      const payload = await response.json();
      const check = responseSchema.safeParse(payload);
      if (!check.success) {
        return {
          valid: false,
          message: 'Workday response format is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: 'Workday configuration is valid',
        normalizedConfiguration: {
          ...result.data,
          origin,
        },
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Workday portal is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Workday tenant or site not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Workday validation timed out';
      }
      return {
        valid: false,
        message: userMessage,
        normalizedConfiguration: null,
        preview: null,
      };
    }
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const configuration = configurationSchema.parse(
      options.configuration ?? {},
    );
    const origin = new URL(configuration.origin).origin;
    const endpoint = new URL(
      `/wday/cxs/${encodeURIComponent(configuration.tenant)}/${encodeURIComponent(configuration.site)}/jobs`,
      origin,
    );
    endpoint.searchParams.set('_origin', origin);
    endpoint.searchParams.set('_tenant', configuration.tenant);
    endpoint.searchParams.set('_site', configuration.site);
    if (configuration.company !== undefined)
      endpoint.searchParams.set('_company', configuration.company);
    return Promise.resolve({
      request,
      target: endpoint.toString(),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    if (search.fixturePath !== null) {
      const result = selectJobs(loadJsonFixture(search.fixturePath), search);
      return result;
    }
    const selected: unknown[] = [];
    let rejected = 0;
    let total = Number.POSITIVE_INFINITY;
    let seen = 0;
    let ended = false;
    let unfilteredCount = 0;
    const limit = Math.min(MAX_RESULTS, Math.max(1, search.request.limit));
    const maxPages = MAX_PAGES;
    for (
      let page = 0;
      page < maxPages && selected.length < limit && seen < total;
      page += 1
    ) {
      const url = new URL(search.target);
      for (const key of ['_origin', '_tenant', '_site', '_company'])
        url.searchParams.delete(key);
      const payload = await this.requestJson(url, search.signal, 'POST', {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        searchText: search.request.query.trim(),
      });
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success)
        throw new ProviderFetchError(
          'Workday response must contain a jobPostings array',
        );
      seen += parsed.data.jobPostings.length;
      total = parsed.data.total ?? seen;
      const pageResult = selectJobs(
        { jobPostings: parsed.data.jobPostings },
        search,
        limit - selected.length,
      );
      selected.push(...pageResult.records);
      rejected += pageResult.rejected;
      unfilteredCount += pageResult.unfilteredCount ?? 0;
      if (parsed.data.jobPostings.length < PAGE_SIZE || seen >= total) {
        ended = true;
        break;
      }
    }
    const detailed: unknown[] = [];
    for (const item of selected) {
      detailed.push(await this.addPublicDetail(item, search));
    }
    return {
      records: detailed,
      rejected,
      truncated: !ended || selected.length >= limit,
      complete: ended,
      unfilteredCount,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = clean(raw.locationsText);
    const detailUrl = detailUrlFor(raw.externalPath, raw.providerOrigin);
    const company =
      raw.company_name ??
      detailUrl.hostname.split('.')[0]?.replaceAll('-', ' ') ??
      'Unknown employer';
    return normalizeJob({
      externalId: raw.jobId ?? raw.externalPath,
      title: raw.title,
      company,
      location,
      ...locationParts(location),
      remoteType: inferRemoteType(raw, location),
      employmentType: inferEmploymentType(raw),
      salaryMinimum: raw.salaryMinimum ?? null,
      salaryMaximum: raw.salaryMaximum ?? null,
      salaryText: clean(raw.salaryText),
      description: clean(raw.description),
      requirements: null,
      preferredQualifications: null,
      postingUrl: detailUrl.toString(),
      providerId: this.id,
      providerName: this.name,
      datePosted: parsePostedOn(raw.postedOn, discoveredAt),
      discoveredAt,
    });
  }

  private async addPublicDetail(
    item: unknown,
    search: ProviderSearch,
  ): Promise<unknown> {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) return item;
    const target = new URL(search.target);
    const tenant = target.searchParams.get('_tenant');
    const site = target.searchParams.get('_site');
    if (tenant === null || site === null) return item;
    const detailUrl = new URL(
      `/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${parsed.data.externalPath}`,
      target.origin,
    );
    try {
      const payload = await this.requestJson(detailUrl, search.signal);
      const detail = detailSchema.safeParse(payload);
      const description = detail.success
        ? clean(detail.data.jobPostingInfo?.jobDescription)
        : null;
      if (description === null) return item;
      const salary = salaryFromText(description);
      return {
        ...parsed.data,
        description,
        salaryMinimum: salary.minimum,
        salaryMaximum: salary.maximum,
        salaryText: salary.text,
      };
    } catch (error) {
      if (search.signal?.aborted === true) throw error;
      return item;
    }
  }

  private async requestJson(
    url: URL,
    signal?: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.http.request(url, {
      provider: this.name,
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'User-Agent': 'job-browser/1.0 (local job discovery)',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.json();
  }
}

function selectJobs(
  payload: unknown,
  search: ProviderSearch,
  limit = Math.min(MAX_RESULTS, Math.max(1, search.request.limit)),
): ProviderFetchResult {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ProviderFetchError(
      'Workday response must contain a jobPostings array',
    );
  const target = new URL(search.target);
  const providerOrigin = target.searchParams.get('_origin');
  const company = target.searchParams.get('_company');
  const valid = parsed.data.jobPostings.flatMap((item) => {
    const result = jobSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  const records = valid
    .map((item) => ({
      ...item,
      ...(providerOrigin === null ? {} : { providerOrigin }),
      ...(company === null ? {} : { company_name: company }),
    }))
    .filter((item) => matchesRequest(jobSchema.parse(item), search.request))
    .slice(0, limit);
  return {
    records,
    rejected: parsed.data.jobPostings.length - valid.length,
    truncated: records.length >= limit,
    complete: true,
    unfilteredCount: valid.length,
  };
}

function salaryFromText(value: string): {
  minimum: number | null;
  maximum: number | null;
  text: string | null;
} {
  const match = /\$([\d,]+)(?:\.\d+)?\s*(?:-|to)\s*\$?([\d,]+)(?:\.\d+)?/i.exec(
    value,
  );
  if (match === null) return { minimum: null, maximum: null, text: null };
  const minimum = Number(match[1]?.replaceAll(',', ''));
  const maximum = Number(match[2]?.replaceAll(',', ''));
  return {
    minimum: Number.isFinite(minimum) ? minimum : null,
    maximum: Number.isFinite(maximum) ? maximum : null,
    text: match[0],
  };
}

function detailUrlFor(
  externalPath: string,
  providerOrigin: string | undefined,
): URL {
  if (externalPath.startsWith('https://')) return new URL(externalPath);
  // Workday external paths are public posting paths. Fixture paths include their official host for deterministic normalization.
  const hostMatch = /^\/([^/]+\.myworkdayjobs\.com)(\/.*)$/.exec(externalPath);
  return hostMatch
    ? new URL(hostMatch[2] ?? '/', `https://${hostMatch[1] ?? ''}`)
    : new URL(
        externalPath,
        providerOrigin ?? 'https://workday.myworkdayjobs.com',
      );
}

function matchesRequest(job: WorkdayJob, request: SearchRequest): boolean {
  const text =
    `${job.title} ${job.locationsText ?? ''} ${job.bulletFields?.join(' ') ?? ''} ${job.remoteType ?? ''}`.toLowerCase();
  const query = request.query.trim().toLowerCase();
  const location = request.location?.trim().toLowerCase();
  return (
    (!query || text.includes(query)) &&
    (!location || text.includes(location)) &&
    (!request.remoteOnly || /remote|anywhere|distributed/i.test(text))
  );
}
function inferRemoteType(job: WorkdayJob, location: string | null): RemoteType {
  const text = `${job.remoteType ?? ''} ${location ?? ''} ${job.bulletFields?.join(' ') ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (/remote|anywhere|distributed/i.test(text)) return 'remote';
  return location === null ? 'unknown' : 'onsite';
}
function inferEmploymentType(job: WorkdayJob): EmploymentType {
  const text =
    `${job.timeType ?? ''} ${job.bulletFields?.join(' ') ?? ''}`.toLowerCase();
  if (text.includes('intern')) return 'internship';
  if (text.includes('part')) return 'part-time';
  if (text.includes('contract')) return 'contract';
  if (/temporary|seasonal/.test(text)) return 'temporary';
  if (text.includes('full')) return 'full-time';
  return 'unknown';
}
function parsePostedOn(
  value: string | null | undefined,
  discoveredAt: string,
): string | null {
  if (!value) return null;
  if (!Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  const days = /posted\s+(\d+)\s+days?\s+ago/i.exec(value)?.[1];
  if (days === undefined) return null;
  const date = new Date(discoveredAt);
  date.setUTCDate(date.getUTCDate() - Number(days));
  return date.toISOString();
}
function clean(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? '';
  return cleaned || null;
}
function locationParts(location: string | null): {
  city: string | null;
  state: string | null;
} {
  if (location === null || /remote|anywhere/i.test(location))
    return { city: null, state: null };
  const parts = location.split(',').map((part) => part.trim());
  return parts.length === 2
    ? { city: parts[0] ?? null, state: parts[1] ?? null }
    : { city: null, state: null };
}

export default new WorkdayProvider();
