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
import { log } from '../logging/logger.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/lever-search-response.json', import.meta.url),
);
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RESULTS = 500;

const configurationSchema = z.strictObject({
  site: z
    .string({
      message: 'Lever site slug must be a string',
    })
    .trim()
    .min(1, 'Lever site slug is required')
    .max(100, 'Lever site slug is too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Lever site slug contains invalid characters'),
  company: z.string().trim().min(1).max(200).optional(),
});
const jobSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  categories: z
    .object({
      commitment: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      team: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  descriptionPlain: z.string().nullable().optional(),
  additionalPlain: z.string().nullable().optional(),
  hostedUrl: z.url(),
  applyUrl: z.url().nullable().optional(),
  createdAt: z.number().nullable().optional(),
  workplaceType: z.string().nullable().optional(),
  salaryRange: z
    .object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      currency: z.string().optional(),
      interval: z.string().optional(),
    })
    .nullable()
    .optional(),
  company_name: z.string().trim().min(1).optional(),
});
type LeverJob = z.infer<typeof jobSchema>;

export class LeverProvider extends BaseProvider {
  public readonly id = 'lever';
  public readonly name = 'Lever';
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
          result.error.issues[0]?.message ?? 'Invalid Lever configuration',
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
        message: 'Lever configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    }

    try {
      const url = new URL(
        `https://api.lever.co/v0/postings/${encodeURIComponent(result.data.site)}?limit=1`,
      );
      const response = await this.http.request(url, {
        provider: this.name,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        return {
          valid: false,
          message: 'Lever board response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: 'Lever configuration is valid',
        normalizedConfiguration: result.data,
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Lever site is unreachable or inactive';
      if (
        message.includes('404') ||
        message.includes('Document not found') ||
        message.includes('Not Found')
      ) {
        userMessage = 'Lever site not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Lever site validation timed out';
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
      `https://api.lever.co/v0/postings/${encodeURIComponent(configuration.site)}`,
    );
    endpoint.searchParams.set('mode', 'json');
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
    const parsedJobs: LeverJob[] = [];
    const parseErrors: z.ZodError[] = [];
    let rejected = 0;
    let rawJobCount = 0;
    let httpStatus: number | null = null;
    let requestedEndpoint = search.target;

    const limitVal = Math.min(MAX_RESULTS, Math.max(1, search.request.limit));
    const accumulatedRecords: LeverJob[] = [];

    if (search.fixturePath !== null) {
      const loaded = loadJsonFixture(search.fixturePath);
      if (Array.isArray(loaded)) {
        rawJobCount += loaded.length;
        for (const item of loaded) {
          const parsed = jobSchema.safeParse(item);
          if (parsed.success) {
            parsedJobs.push(parsed.data);
          } else {
            parseErrors.push(parsed.error);
            rejected += 1;
          }
        }
      }
    } else {
      const maxPages = MAX_PAGES;
      for (
        let page = 0;
        page < maxPages && accumulatedRecords.length < limitVal;
        page += 1
      ) {
        const url = new URL(search.target);
        url.searchParams.delete('_company');
        url.searchParams.set('skip', String(page * PAGE_SIZE));
        url.searchParams.set('limit', String(PAGE_SIZE));
        if (page === 0) {
          requestedEndpoint = url.toString();
        }
        const response = await this.http.request(url, {
          provider: this.name,
          signal: search.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'job-browser/1.0 (local job discovery)',
          },
        });
        if (page === 0) {
          httpStatus = response.status;
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new ProviderFetchError('Lever response must be an array');
        }
        rawJobCount += payload.length;

        const pageParsed: LeverJob[] = [];
        for (const item of payload) {
          const parsed = jobSchema.safeParse(item);
          if (parsed.success) {
            pageParsed.push(parsed.data);
            parsedJobs.push(parsed.data);
          } else {
            parseErrors.push(parsed.error);
            rejected += 1;
          }
        }

        const company = new URL(search.target).searchParams.get('_company');
        const mappedPage = pageParsed
          .map((item) =>
            company === null
              ? item
              : { ...(item as object), company_name: company },
          )
          .map((item) => jobSchema.parse(item));

        const pageMatched = filterJobs(mappedPage, search.request);
        accumulatedRecords.push(...pageMatched);

        if (payload.length < PAGE_SIZE) {
          break;
        }
      }
    }

    const parsedJobCount = parsedJobs.length;

    const firstError = parseErrors[0];
    if (rawJobCount > 0 && parsedJobCount === 0 && firstError !== undefined) {
      throw firstError;
    }

    const company = new URL(search.target).searchParams.get('_company');
    const mappedJobs = parsedJobs
      .map((item) =>
        company === null
          ? item
          : { ...(item as object), company_name: company },
      )
      .map((item) => jobSchema.parse(item));

    const rawQuery = search.request.query;
    const isQueryEmpty =
      !rawQuery ||
      rawQuery.trim() === '' ||
      rawQuery.trim().toLowerCase() === 'null' ||
      rawQuery.trim().toLowerCase() === 'undefined';

    const rawLocation = search.request.location;
    const isLocationEmpty =
      !rawLocation ||
      rawLocation.trim() === '' ||
      rawLocation.trim().toLowerCase() === 'null' ||
      rawLocation.trim().toLowerCase() === 'undefined';

    const queryVal = isQueryEmpty ? null : rawQuery.trim().toLowerCase();
    const locationVal = isLocationEmpty
      ? null
      : rawLocation.trim().toLowerCase();

    const afterKeyword = mappedJobs.filter((job) => {
      if (!queryVal) return true;
      const text =
        `${job.text} ${job.categories?.location ?? ''} ${job.categories?.team ?? ''} ${job.descriptionPlain ?? ''}`.toLowerCase();
      return text.includes(queryVal);
    });
    const countAfterKeyword = afterKeyword.length;

    const afterLocation = afterKeyword.filter((job) => {
      if (!locationVal) return true;
      const text =
        `${job.text} ${job.categories?.location ?? ''} ${job.categories?.team ?? ''} ${job.descriptionPlain ?? ''}`.toLowerCase();
      return text.includes(locationVal);
    });
    const countAfterLocation = afterLocation.length;

    const afterRemote = afterLocation.filter((job) => {
      if (!search.request.remoteOnly) return true;
      const text =
        `${job.text} ${job.categories?.location ?? ''} ${job.categories?.team ?? ''} ${job.descriptionPlain ?? ''}`.toLowerCase();
      return /remote|anywhere|distributed/i.test(
        `${text} ${job.workplaceType ?? ''}`,
      );
    });
    const countAfterRemote = afterRemote.length;

    const records = afterRemote.slice(0, limitVal);
    const finalImportedCount = records.length;

    log('info', 'Lever fetch diagnostics', {
      endpoint: requestedEndpoint,
      status: httpStatus,
      rawJobCount,
      parsedJobCount,
      countAfterKeyword,
      countAfterLocation,
      countAfterRemote,
      finalImportedCount,
    });

    if (finalImportedCount === 0) {
      if (rawJobCount === 0) {
        return {
          records: [],
          rejected,
          truncated: false,
          complete: true,
          unfilteredCount: 0,
          emptyNotice: 'No open positions found',
        };
      }
      return {
        records: [],
        rejected,
        truncated: false,
        complete: true,
        unfilteredCount: parsedJobCount,
        emptyNotice: 'No jobs matched current filters',
      };
    }

    return {
      records,
      rejected,
      truncated: rawJobCount >= limitVal || finalImportedCount >= limitVal,
      complete: search.fixturePath !== null || rawJobCount < limitVal,
      unfilteredCount: parsedJobCount,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = clean(raw.categories?.location);
    const description = clean(
      [raw.descriptionPlain, raw.additionalPlain].filter(Boolean).join('\n\n'),
    );
    const salary = raw.salaryRange ?? null;
    const company =
      raw.company_name ??
      new URL(raw.hostedUrl).pathname
        .split('/')
        .find((part) => part.length > 0)
        ?.replaceAll('-', ' ') ??
      'Unknown employer';
    return normalizeJob({
      externalId: raw.id,
      title: raw.text,
      company,
      location,
      ...locationParts(location),
      remoteType: inferRemoteType(raw, location),
      employmentType: inferEmploymentType(raw.categories?.commitment),
      salaryMinimum: salary?.min ?? null,
      salaryMaximum: salary?.max ?? null,
      salaryText:
        salary === null
          ? null
          : `${salary.currency ?? ''} ${String(salary.min)}-${String(salary.max)}${salary.interval ? ` ${salary.interval}` : ''}`.trim(),
      description,
      requirements: null,
      preferredQualifications: null,
      postingUrl: raw.applyUrl ?? raw.hostedUrl,
      applicationUrls: raw.applyUrl ? [raw.applyUrl] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted:
        raw.createdAt === null || raw.createdAt === undefined
          ? null
          : new Date(raw.createdAt).toISOString(),
      discoveredAt,
    });
  }
}

function inferRemoteType(job: LeverJob, location: string | null): RemoteType {
  const text = `${job.workplaceType ?? ''} ${location ?? ''}`;
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

function filterJobs(jobs: LeverJob[], request: SearchRequest): LeverJob[] {
  const rawQuery = request.query;
  const isQueryEmpty =
    !rawQuery ||
    rawQuery.trim() === '' ||
    rawQuery.trim().toLowerCase() === 'null' ||
    rawQuery.trim().toLowerCase() === 'undefined';

  const rawLocation = request.location;
  const isLocationEmpty =
    !rawLocation ||
    rawLocation.trim() === '' ||
    rawLocation.trim().toLowerCase() === 'null' ||
    rawLocation.trim().toLowerCase() === 'undefined';

  const queryVal = isQueryEmpty ? null : rawQuery.trim().toLowerCase();
  const locationVal = isLocationEmpty ? null : rawLocation.trim().toLowerCase();

  return jobs.filter((job) => {
    const text =
      `${job.text} ${job.categories?.location ?? ''} ${job.categories?.team ?? ''} ${job.descriptionPlain ?? ''}`.toLowerCase();
    if (queryVal && !text.includes(queryVal)) return false;
    if (locationVal && !text.includes(locationVal)) return false;
    if (
      request.remoteOnly &&
      !/remote|anywhere|distributed/i.test(`${text} ${job.workplaceType ?? ''}`)
    ) {
      return false;
    }
    return true;
  });
}

export default new LeverProvider();
