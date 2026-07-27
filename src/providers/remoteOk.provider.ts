import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { EmploymentType } from '../domain/job.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
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
  new URL('../fixtures/remote-ok-search-response.json', import.meta.url),
);

const remoteOkJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  company: z.string().trim().min(1),
  position: z.string().trim().min(1),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  epoch: z.number().nullable().optional(),
  salary_min: z.union([z.number(), z.string()]).nullable().optional(),
  salary_max: z.union([z.number(), z.string()]).nullable().optional(),
  tags: z.array(z.string()).optional(),
  url: z.url().nullable().optional(),
  apply_url: z.url().nullable().optional(),
});
const configurationSchema = z.strictObject({});
const metadataSchema = z.looseObject({ legal: z.string() });
const MAX_RESULTS = 500;

type RemoteOkJob = z.infer<typeof remoteOkJobSchema>;

export class RemoteOkProvider extends BaseProvider {
  public readonly id = 'remote-ok';
  public readonly name = 'Remote OK';
  public readonly type = 'job-board' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: false,
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

  public override validateConfiguration(
    configuration: Record<string, unknown>,
  ) {
    const parsed = configurationSchema.safeParse(configuration);
    return Promise.resolve({
      valid: parsed.success,
      message: parsed.success
        ? 'Remote OK configuration is valid'
        : 'Remote OK configuration must be empty',
      normalizedConfiguration: parsed.success ? {} : null,
      preview: null,
    });
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const endpoint = new URL('https://remoteok.com/api');
    if (request.query.trim().length > 0) {
      endpoint.searchParams.set('tag', request.query.trim());
    }

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
    if (search.fixturePath !== null) {
      payload = loadJsonFixture(search.fixturePath);
    } else {
      const response = await this.http.request(search.target, {
        provider: this.name,
        signal: search.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'job-browser/1.0 (local job discovery)',
        },
      });
      payload = response.json();
    }

    if (!Array.isArray(payload)) {
      throw new ProviderFetchError('Remote OK response must be an array');
    }

    const items = metadataSchema.safeParse(payload[0]).success
      ? payload.slice(1)
      : payload;
    const valid = items.filter(
      (item) => remoteOkJobSchema.safeParse(item).success,
    );
    const limit = Math.min(MAX_RESULTS, Math.max(1, search.request.limit));
    return {
      records: valid.slice(0, limit),
      rejected: items.length - valid.length,
      truncated: valid.length > limit || payload.length > MAX_RESULTS + 1,
      complete: payload.length <= MAX_RESULTS + 1,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = remoteOkJobSchema.parse(rawJob);
    const location = cleanLocation(raw.location);
    const locationParts = splitLocation(location);
    const salaryMinimum = parseSalary(raw.salary_min);
    const salaryMaximum = parseSalary(raw.salary_max);

    return normalizeJob({
      externalId: String(raw.id),
      title: raw.position,
      company: raw.company,
      location,
      city: locationParts.city,
      state: locationParts.state,
      remoteType: 'remote',
      employmentType: inferEmploymentType(raw.tags ?? []),
      salaryMinimum,
      salaryMaximum,
      salaryText: formatSalary(salaryMinimum, salaryMaximum),
      description:
        raw.description === undefined || raw.description === null
          ? null
          : htmlToText(raw.description),
      requirements: null,
      preferredQualifications: null,
      postingUrl: raw.apply_url ?? raw.url ?? null,
      providerId: this.id,
      providerName: this.name,
      datePosted: parsePostedDate(raw),
      discoveredAt,
    });
  }
}

function parsePostedDate(raw: RemoteOkJob): string | null {
  if (raw.date !== undefined && raw.date !== null) {
    const timestamp = Date.parse(raw.date);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  if (raw.epoch !== undefined && raw.epoch !== null) {
    return new Date(raw.epoch * 1000).toISOString();
  }
  return null;
}

function parseSalary(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed =
    typeof value === 'number' ? value : Number(value.replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatSalary(
  minimum: number | null,
  maximum: number | null,
): string | null {
  if (minimum === null && maximum === null) return null;
  if (minimum !== null && maximum !== null) {
    return `$${minimum.toLocaleString('en-US')}-$${maximum.toLocaleString('en-US')}`;
  }
  const salary = minimum ?? maximum;
  if (salary === null) return null;
  return `$${salary.toLocaleString('en-US')}`;
}

function inferEmploymentType(tags: readonly string[]): EmploymentType {
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  if (normalizedTags.some((tag) => tag.includes('part-time')))
    return 'part-time';
  if (normalizedTags.some((tag) => tag.includes('contract'))) return 'contract';
  if (normalizedTags.some((tag) => tag.includes('intern'))) return 'internship';
  if (normalizedTags.some((tag) => tag.includes('full-time')))
    return 'full-time';
  return 'unknown';
}

function cleanLocation(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

function splitLocation(location: string | null): {
  city: string | null;
  state: string | null;
} {
  if (location === null || /^(worldwide|remote)$/i.test(location)) {
    return { city: null, state: null };
  }
  const parts = location.split(',').map((part) => part.trim());
  return parts.length === 2
    ? { city: parts[0] ?? null, state: parts[1] ?? null }
    : { city: null, state: null };
}

export default new RemoteOkProvider();
