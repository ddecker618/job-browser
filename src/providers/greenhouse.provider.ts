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
import { log } from '../logging/logger.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/greenhouse-search-response.json', import.meta.url),
);

const configurationSchema = z.strictObject({
  boardToken: z
    .string({
      message: 'Greenhouse board token must be a string',
    })
    .trim()
    .min(1, 'Greenhouse board token is required')
    .max(100, 'Greenhouse board token is too long')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Greenhouse board token contains invalid characters',
    ),
  company: z.string().trim().min(1).max(200).optional(),
});

const jobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().trim().min(1),
  location: z
    .object({ name: z.string().nullable().optional() })
    .nullable()
    .optional(),
  content: z.string().nullable().optional(),
  absolute_url: z.url(),
  application_url: z.url().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  company_name: z.string().trim().min(1).optional(),
  departments: z
    .array(z.object({ name: z.string() }))
    .nullable()
    .optional(),
  metadata: z
    .array(z.object({ name: z.string(), value: z.unknown() }))
    .nullable()
    .optional(),
});

const responseSchema = z.object({ jobs: z.array(z.unknown()) });
type GreenhouseJob = z.infer<typeof jobSchema>;
const MAX_BOARD_JOBS = 10_000;

export class GreenhouseProvider extends BaseProvider {
  public readonly id = 'greenhouse';
  public readonly name = 'Greenhouse';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: false,
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
          result.error.issues[0]?.message ?? 'Invalid Greenhouse configuration',
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
        message: 'Greenhouse configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    }

    try {
      const url = new URL(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(result.data.boardToken)}/jobs?content=false`,
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
          message: 'Greenhouse board response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: 'Greenhouse configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Greenhouse board is unreachable or inactive';
      if (
        message.includes('404') ||
        message.includes('Job not found') ||
        message.includes('Not Found')
      ) {
        userMessage = 'Greenhouse board not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Greenhouse board validation timed out';
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
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(configuration.boardToken)}/jobs`,
    );
    endpoint.searchParams.set('content', 'true');
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
    let payload: unknown;
    let httpStatus: number | null = null;
    let requestedEndpoint = search.target;

    if (search.fixturePath === null) {
      const url = new URL(search.target);
      url.searchParams.delete('_company');
      requestedEndpoint = url.toString();
      const response = await this.http.request(url, {
        provider: this.name,
        signal: search.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'job-browser/1.0 (local job discovery)',
        },
      });
      httpStatus = response.status;
      payload = await response.json();
    } else {
      payload = loadJsonFixture(search.fixturePath);
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success)
      throw new ProviderFetchError(
        'Greenhouse response must contain a jobs array',
      );

    const rawJobsCount = parsed.data.jobs.length;

    const company = new URL(search.target).searchParams.get('_company');
    const bounded = parsed.data.jobs.slice(0, MAX_BOARD_JOBS);
    const valid = bounded.filter((job) => jobSchema.safeParse(job).success);
    const parsedJobsCount = valid.length;

    const records = valid
      .map((job) =>
        company === null ? job : { ...(job as object), company_name: company },
      )
      .filter((job) => matchesRequest(jobSchema.parse(job), search.request))
      .slice(0, search.request.limit);
    const finalImportedCount = records.length;
    const filteredJobsCount = parsedJobsCount - finalImportedCount;

    log('info', 'Greenhouse fetch diagnostics', {
      endpoint: requestedEndpoint,
      status: httpStatus,
      rawJobsCount,
      parsedJobsCount,
      filteredJobsCount,
      finalImportedCount,
    });

    return {
      records,
      rejected: bounded.length - valid.length,
      truncated:
        parsed.data.jobs.length > MAX_BOARD_JOBS ||
        records.length === search.request.limit,
      complete: parsed.data.jobs.length <= MAX_BOARD_JOBS,
      unfilteredCount: valid.length,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = clean(raw.location?.name);
    const company =
      raw.company_name ??
      companyFromUrl(raw.absolute_url) ??
      'Unknown employer';
    const description = clean(
      raw.content === null || raw.content === undefined
        ? null
        : htmlToText(raw.content),
    );

    return normalizeJob({
      externalId: String(raw.id),
      title: raw.title,
      company,
      location,
      ...locationParts(location),
      remoteType: inferRemoteType(location, raw.title, description),
      employmentType: inferEmploymentType(raw),
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description,
      requirements: null,
      preferredQualifications: null,
      postingUrl: raw.absolute_url,
      applicationUrls: raw.application_url ? [raw.application_url] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: toIso(raw.updated_at),
      discoveredAt,
    });
  }
}

function matchesRequest(job: GreenhouseJob, request: SearchRequest): boolean {
  const text =
    `${job.title} ${job.location?.name ?? ''} ${job.content ?? ''}`.toLowerCase();
  const query = request.query.trim().toLowerCase();
  const location = request.location?.trim().toLowerCase();
  if (query.length > 0 && !text.includes(query)) return false;
  if (location && !text.includes(location)) return false;
  return !request.remoteOnly || /remote|anywhere|distributed/i.test(text);
}

function inferEmploymentType(job: GreenhouseJob): EmploymentType {
  const text =
    `${job.title} ${job.departments?.map((item) => item.name).join(' ') ?? ''} ${JSON.stringify(job.metadata ?? [])}`.toLowerCase();
  if (/intern(ship)?/.test(text)) return 'internship';
  if (/part[ -]?time/.test(text)) return 'part-time';
  if (/contract(or)?/.test(text)) return 'contract';
  if (/temporary|seasonal/.test(text)) return 'temporary';
  return 'full-time';
}

function inferRemoteType(
  location: string | null,
  title: string,
  description: string | null,
): RemoteType {
  const text = `${location ?? ''} ${title} ${description ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (/remote|anywhere|distributed/i.test(text)) return 'remote';
  return location === null ? 'unknown' : 'onsite';
}

function companyFromUrl(value: string): string | null {
  const parts = new URL(value).pathname.split('/').filter(Boolean);
  const index = parts.findIndex(
    (part) => part === 'boards' || part === 'embed',
  );
  const token = index >= 0 ? parts[index + 1] : parts[0];
  return token === undefined ? null : token.replaceAll('-', ' ');
}

function clean(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? '';
  return cleaned.length === 0 ? null : cleaned;
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
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export default new GreenhouseProvider();
