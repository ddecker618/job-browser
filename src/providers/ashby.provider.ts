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
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/ashby-jobs-response.json', import.meta.url),
);
const configurationSchema = z.strictObject({
  boardName: z
    .string({
      message: 'Ashby board name must be a string',
    })
    .trim()
    .min(1, 'Ashby board name is required')
    .max(100, 'Ashby board name is too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Ashby board name contains invalid characters'),
  company: z.string().trim().min(1).max(200).optional(),
});
const compensationSchema = z.looseObject({
  compensationTierSummary: z.string().nullable().optional(),
  summaryComponents: z
    .array(
      z.object({
        minValue: z.number().nullable().optional(),
        maxValue: z.number().nullable().optional(),
        currencyCode: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
const jobSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().nullable().optional(),
  remoteType: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  descriptionPlain: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  jobUrl: z.url(),
  applyUrl: z.url().nullable().optional(),
  compensation: compensationSchema.nullable().optional(),
  company_name: z.string().trim().min(1).optional(),
});
const responseSchema = z.object({ jobs: z.array(z.unknown()) });
type AshbyJob = z.infer<typeof jobSchema>;
const MAX_BOARD_JOBS = 10_000;

export class AshbyProvider extends BaseProvider {
  public readonly id = 'ashby';
  public readonly name = 'Ashby';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
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
          result.error.issues[0]?.message ?? 'Invalid Ashby configuration',
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
        message: 'Ashby configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    }

    try {
      const url = new URL(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(result.data.boardName)}`,
      );
      const response = await this.http.request(url, {
        provider: this.name,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          valid: false,
          message: 'Ashby board response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: 'Ashby configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Ashby board is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Ashby board not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Ashby board validation timed out';
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
    const endpoint = new URL(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(configuration.boardName)}`,
    );
    endpoint.searchParams.set('includeCompensation', 'true');
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
    const payload =
      search.fixturePath === null
        ? await this.fetchJson(search)
        : loadJsonFixture(search.fixturePath);
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success)
      throw new ProviderFetchError('Ashby response must contain a jobs array');
    const company = new URL(search.target).searchParams.get('_company');
    const bounded = parsed.data.jobs.slice(0, MAX_BOARD_JOBS);
    const jobs: AshbyJob[] = [];
    for (const item of bounded) {
      const result = jobSchema.safeParse(item);
      if (!result.success) continue;
      if (company !== null) result.data.company_name = company;
      jobs.push(result.data);
    }
    const records = jobs
      .filter((item) => matchesRequest(item, search.request))
      .slice(0, Math.min(500, Math.max(1, search.request.limit)));
    return {
      records,
      rejected: bounded.length - jobs.length,
      truncated:
        parsed.data.jobs.length > MAX_BOARD_JOBS ||
        records.length >= search.request.limit,
      complete: parsed.data.jobs.length <= MAX_BOARD_JOBS,
      unfilteredCount: jobs.length,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = clean(raw.location);
    const description = clean(
      raw.descriptionPlain ??
        (raw.descriptionHtml ? htmlToText(raw.descriptionHtml) : null),
    );
    const component = raw.compensation?.summaryComponents?.find(
      (item) => item.minValue != null || item.maxValue != null,
    );
    const company =
      raw.company_name ??
      new URL(raw.jobUrl).pathname
        .split('/')
        .find((part) => part.length > 0)
        ?.replaceAll('-', ' ') ??
      'Unknown employer';
    return normalizeJob({
      externalId: raw.id,
      title: raw.title,
      company,
      location,
      ...locationParts(location),
      remoteType: inferRemoteType(raw.remoteType, location),
      employmentType: inferEmploymentType(raw.employmentType),
      salaryMinimum: component?.minValue ?? null,
      salaryMaximum: component?.maxValue ?? null,
      salaryText: clean(raw.compensation?.compensationTierSummary),
      description,
      requirements: null,
      preferredQualifications: null,
      postingUrl: raw.applyUrl ?? raw.jobUrl,
      applicationUrls: raw.applyUrl ? [raw.applyUrl] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: toIso(raw.publishedAt),
      discoveredAt,
      department: clean(raw.department ?? raw.team),
    });
  }

  private async fetchJson(search: ProviderSearch): Promise<unknown> {
    const url = new URL(search.target);
    url.searchParams.delete('_company');
    const response = await this.http.request(url, {
      provider: this.name,
      signal: search.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'job-browser/1.0 (local job discovery)',
      },
    });
    return response.json();
  }
}

function matchesRequest(job: AshbyJob, request: SearchRequest): boolean {
  const text =
    `${job.title} ${job.location ?? ''} ${job.department ?? ''} ${job.team ?? ''} ${job.descriptionPlain ?? ''}`.toLowerCase();
  const query = request.query.trim().toLowerCase();
  const location = request.location?.trim().toLowerCase();
  return (
    (!query || text.includes(query)) &&
    (!location || text.includes(location)) &&
    (!request.remoteOnly ||
      /remote|anywhere|distributed/i.test(`${text} ${job.remoteType ?? ''}`))
  );
}

function inferRemoteType(
  value: string | null | undefined,
  location: string | null,
): RemoteType {
  const text = `${value ?? ''} ${location ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (/remote|anywhere|distributed/i.test(text)) return 'remote';
  return location === null ? 'unknown' : 'onsite';
}
function inferEmploymentType(value: string | null | undefined): EmploymentType {
  const text = value?.toLowerCase() ?? '';
  if (text.includes('intern')) return 'internship';
  if (text.includes('part')) return 'part-time';
  if (text.includes('contract')) return 'contract';
  if (text.includes('temporary')) return 'temporary';
  if (text.includes('full')) return 'full-time';
  return 'unknown';
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
function toIso(value: string | null | undefined): string | null {
  return !value || Number.isNaN(Date.parse(value))
    ? null
    : new Date(value).toISOString();
}

export default new AshbyProvider();
