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
  ProviderHealthResult,
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

const ENDPOINT = 'https://data.usajobs.gov/api/Search';
const MAX_PAGE = 500;
const MAX_RESULTS_PER_PAGE = 500;
const MAX_PAGE_COUNT = 10;
const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/usajobs-search-response.json', import.meta.url),
);

const configurationSchema = z.strictObject({
  page: z
    .number({ message: 'Page must be a number' })
    .int()
    .min(1, 'Page must be at least 1')
    .max(MAX_PAGE, `Page cannot exceed ${String(MAX_PAGE)}`)
    .optional(),
  resultsPerPage: z
    .number({ message: 'Results per page must be a number' })
    .int()
    .min(1, 'Results per page must be at least 1')
    .max(
      MAX_RESULTS_PER_PAGE,
      `Results per page cannot exceed ${String(MAX_RESULTS_PER_PAGE)}`,
    )
    .optional(),
  pageCount: z
    .number({ message: 'Page count must be a number' })
    .int()
    .min(1, 'Page count must be at least 1')
    .max(MAX_PAGE_COUNT, `Page count cannot exceed ${String(MAX_PAGE_COUNT)}`)
    .optional(),
});

const namedValueSchema = z.object({
  Name: z.string().nullable().optional(),
  Code: z.string().nullable().optional(),
});

const locationSchema = z.object({
  LocationName: z.string().nullable().optional(),
  CityName: z.string().nullable().optional(),
  CountrySubDivisionCode: z.string().nullable().optional(),
});

const remunerationSchema = z.object({
  MinimumRange: z.union([z.string(), z.number()]).nullable().optional(),
  MaximumRange: z.union([z.string(), z.number()]).nullable().optional(),
  RateIntervalCode: z.string().nullable().optional(),
  Description: z.string().nullable().optional(),
});

const detailsSchema = z.object({
  JobSummary: z.string().nullable().optional(),
  LowGrade: z.string().nullable().optional(),
  HighGrade: z.string().nullable().optional(),
  TeleworkEligible: z.boolean().nullable().optional(),
  RemoteIndicator: z.boolean().nullable().optional(),
});

const descriptorSchema = z.object({
  PositionID: z.string().trim().min(1),
  PositionTitle: z.string().trim().min(1),
  PositionURI: z.url(),
  ApplyURI: z.array(z.url()).optional(),
  PositionLocationDisplay: z.string().nullable().optional(),
  PositionLocation: z.array(locationSchema).optional(),
  OrganizationName: z.string().trim().min(1),
  DepartmentName: z.string().nullable().optional(),
  JobGrade: z.array(namedValueSchema).optional(),
  PositionSchedule: z.array(namedValueSchema).optional(),
  PositionOfferingType: z.array(namedValueSchema).optional(),
  PositionRemuneration: z.array(remunerationSchema).optional(),
  QualificationSummary: z.string().nullable().optional(),
  PublicationStartDate: z.string().nullable().optional(),
  ApplicationCloseDate: z.string().nullable().optional(),
  UserArea: z
    .object({
      Details: detailsSchema.optional(),
    })
    .optional(),
});

const responseSchema = z.object({
  SearchResult: z.object({
    SearchResultItems: z.array(z.unknown()),
    SearchResultCountAll: z.number().int().nonnegative().optional(),
  }),
});
const resultItemSchema = z.object({
  MatchedObjectDescriptor: descriptorSchema,
});

type UsaJobsJob = z.infer<typeof descriptorSchema>;

interface RequestContext {
  headers: Readonly<Record<string, string>>;
  pageCount: number;
  signal?: AbortSignal;
}

export class UsaJobsProvider extends BaseProvider {
  public readonly id = 'usajobs';
  public readonly name = 'USAJOBS';
  public readonly type = 'government' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: true,
    structuredPreview: false,
  } as const;

  readonly #requestContexts = new WeakMap<ProviderSearch, RequestContext>();

  public constructor(
    private readonly http: ProviderHttpClient = providerHttpClient,
  ) {
    super();
  }

  public override validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success) {
      return Promise.resolve({
        valid: false,
        message:
          parsed.error.issues[0]?.message ?? 'Invalid USAJOBS configuration',
        normalizedConfiguration: null,
        preview: null,
      });
    }

    return Promise.resolve({
      valid: true,
      message: 'USAJOBS configuration is valid',
      normalizedConfiguration: parsed.data,
      preview: null,
    });
  }

  public override async healthCheck(
    options: DiscoveryOptions,
  ): Promise<ProviderHealthResult> {
    const validation = await this.validateConfiguration(
      options.configuration ?? {},
    );
    if (!validation.valid) {
      return {
        status: 'failed',
        message: validation.message,
        checkedAt: new Date().toISOString(),
      };
    }
    if (!options.fixtureOnly && readCredentials(options.credentials) === null) {
      return {
        status: 'credentials-required',
        message: 'USAJOBS email and API key credentials are required',
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      status: 'healthy',
      message: 'Configuration and credentials are valid',
      checkedAt: new Date().toISOString(),
    };
  }

  public async search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const validation = await this.validateConfiguration(
      options.configuration ?? {},
    );
    if (!validation.valid) {
      throw new Error(`Invalid USAJOBS configuration: ${validation.message}`);
    }

    const configuration = configurationSchema.parse(
      validation.normalizedConfiguration ?? {},
    );
    const endpoint = new URL(ENDPOINT);
    const keyword = request.query.trim();
    const location = request.location?.trim() ?? '';
    if (keyword.length > 0) endpoint.searchParams.set('Keyword', keyword);
    if (location.length > 0)
      endpoint.searchParams.set('LocationName', location);
    if (request.remoteOnly)
      endpoint.searchParams.set('RemoteIndicator', 'true');
    endpoint.searchParams.set('Page', String(configuration.page ?? 1));
    endpoint.searchParams.set(
      'ResultsPerPage',
      String(
        Math.max(
          1,
          Math.min(
            configuration.resultsPerPage ?? request.limit,
            request.limit,
            MAX_RESULTS_PER_PAGE,
          ),
        ),
      ),
    );

    const search: ProviderSearch = {
      request,
      target: endpoint.toString(),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };

    if (!options.fixtureOnly) {
      const credentials = readCredentials(options.credentials);
      if (credentials === null) {
        throw new Error('USAJOBS email and API key credentials are required');
      }
      const context: RequestContext = {
        pageCount: configuration.pageCount ?? MAX_PAGE_COUNT,
        headers: {
          Accept: 'application/json',
          'User-Agent': credentials.email,
          'Authorization-Key': credentials.apiKey,
        },
      };
      if (options.signal !== undefined) context.signal = options.signal;
      this.#requestContexts.set(search, context);
    }

    return search;
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    if (search.fixturePath !== null) {
      return parsePage(
        loadJsonFixture(search.fixturePath),
        search.request.limit,
        search.request.limit,
      );
    }
    const context = this.#requestContexts.get(search);
    if (context === undefined) {
      throw new ProviderFetchError(
        'USAJOBS request credentials are unavailable',
      );
    }
    const target = new URL(search.target);
    const firstPage = Number(target.searchParams.get('Page') ?? '1');
    const configurationPageCount = Math.min(
      context.pageCount,
      MAX_PAGE - firstPage + 1,
    );
    const records: unknown[] = [];
    let rejected = 0;
    let complete = false;
    try {
      for (let offset = 0; offset < configurationPageCount; offset += 1) {
        target.searchParams.set('Page', String(firstPage + offset));
        const response = await this.http.request(target, {
          provider: this.name,
          signal: context.signal ?? search.signal,
          headers: context.headers,
        });
        const page = parsePage(
          response.json(),
          search.request.limit - records.length,
          Number(target.searchParams.get('ResultsPerPage') ?? '1'),
        );
        records.push(...page.records);
        rejected += page.rejected;
        if (page.complete || records.length >= search.request.limit) {
          complete = page.complete;
          break;
        }
      }
    } finally {
      this.#requestContexts.delete(search);
    }
    return {
      records,
      rejected,
      truncated: !complete || records.length >= search.request.limit,
      complete,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = descriptorSchema.parse(rawJob);
    const details = raw.UserArea?.Details;
    const location = firstLocation(raw);
    const remuneration = raw.PositionRemuneration?.[0];
    const salaryMinimum = parseAmount(remuneration?.MinimumRange);
    const salaryMaximum = parseAmount(remuneration?.MaximumRange);
    const grades = parseGrades(
      raw.JobGrade ?? [],
      details?.LowGrade,
      details?.HighGrade,
    );
    const schedule = firstName(raw.PositionSchedule);
    const appointmentType = firstName(raw.PositionOfferingType);
    const openingDate = parseDate(raw.PublicationStartDate);
    const closingDate = parseDate(raw.ApplicationCloseDate);

    return normalizeJob({
      externalId: raw.PositionID,
      title: raw.PositionTitle,
      company: raw.OrganizationName,
      location: location.name,
      city: location.city,
      state: location.state,
      remoteType: inferRemoteType(
        details?.RemoteIndicator,
        details?.TeleworkEligible,
      ),
      employmentType: inferEmploymentType(schedule, appointmentType),
      salaryMinimum,
      salaryMaximum,
      salaryText: formatSalary(salaryMinimum, salaryMaximum, remuneration),
      description: cleanHtml(details?.JobSummary),
      requirements: cleanHtml(raw.QualificationSummary),
      preferredQualifications: null,
      postingUrl: raw.PositionURI,
      providerId: this.id,
      providerName: this.name,
      datePosted: openingDate,
      discoveredAt,
      agency: raw.OrganizationName,
      department: clean(raw.DepartmentName),
      gradeLow: grades.low,
      gradeHigh: grades.high,
      payPlan: grades.payPlan,
      appointmentType,
      workSchedule: schedule,
      teleworkEligible: details?.TeleworkEligible ?? null,
      openingDate,
      closingDate,
      applicationUrls: raw.ApplyURI ?? [],
    });
  }
}

function parsePage(
  payload: unknown,
  limit: number,
  pageSize: number,
): ProviderFetchResult {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ProviderFetchError('USAJOBS returned an invalid response');
  const items = parsed.data.SearchResult.SearchResultItems;
  const valid = items.flatMap((item) => {
    const result = resultItemSchema.safeParse(item);
    return result.success ? [result.data.MatchedObjectDescriptor] : [];
  });
  const records = valid.slice(0, Math.max(0, limit));
  const total = parsed.data.SearchResult.SearchResultCountAll;
  return {
    records,
    rejected: items.length - valid.length,
    truncated: valid.length > records.length,
    complete:
      items.length < pageSize || (total !== undefined && items.length >= total),
  };
}

function readCredentials(
  credentials: DiscoveryOptions['credentials'],
): { email: string; apiKey: string } | null {
  const email = clean(
    credentials?.['email'] ??
      credentials?.['userAgent'] ??
      credentials?.['User-Agent'],
  );
  const apiKey = clean(
    credentials?.['apiKey'] ??
      credentials?.['authorizationKey'] ??
      credentials?.['Authorization-Key'],
  );
  if (
    email === null ||
    apiKey === null ||
    !z.email().safeParse(email).success
  ) {
    return null;
  }
  return { email, apiKey };
}

function firstLocation(raw: UsaJobsJob): {
  name: string | null;
  city: string | null;
  state: string | null;
} {
  const location = raw.PositionLocation?.[0];
  return {
    name: clean(raw.PositionLocationDisplay) ?? clean(location?.LocationName),
    city: clean(location?.CityName),
    state: clean(location?.CountrySubDivisionCode),
  };
}

function parseGrades(
  grades: readonly z.infer<typeof namedValueSchema>[],
  lowGrade: string | null | undefined,
  highGrade: string | null | undefined,
): { low: string | null; high: string | null; payPlan: string | null } {
  const codes = grades
    .map((grade) => clean(grade.Code))
    .filter((code) => code !== null);
  const parsed = codes.map((code) => /^(.*?)[- ]?(\d+[A-Za-z]?)$/.exec(code));
  const firstCode = codes[0] ?? null;
  const firstParsed = parsed[0];
  const lastCode = codes.at(-1) ?? null;
  const lastParsed = parsed.at(-1);
  return {
    low:
      clean(lowGrade) ??
      firstParsed?.[2] ??
      (firstCode !== null && /^\d+[A-Za-z]?$/.test(firstCode)
        ? firstCode
        : null),
    high:
      clean(highGrade) ??
      lastParsed?.[2] ??
      (lastCode !== null && /^\d+[A-Za-z]?$/.test(lastCode) ? lastCode : null),
    payPlan:
      clean(firstParsed?.[1]?.replace(/[- ]+$/, '')) ??
      (firstCode !== null && /[A-Za-z]/.test(firstCode) ? firstCode : null),
  };
}

function firstName(
  values: readonly z.infer<typeof namedValueSchema>[] | undefined,
): string | null {
  return clean(values?.[0]?.Name) ?? clean(values?.[0]?.Code);
}

function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed =
    typeof value === 'number' ? value : Number(value.replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatSalary(
  minimum: number | null,
  maximum: number | null,
  remuneration: z.infer<typeof remunerationSchema> | undefined,
): string | null {
  if (minimum === null && maximum === null)
    return clean(remuneration?.Description);
  const singleAmount = minimum ?? maximum;
  const range =
    minimum !== null && maximum !== null
      ? `$${minimum.toLocaleString('en-US')} - $${maximum.toLocaleString('en-US')}`
      : `$${singleAmount === null ? '' : singleAmount.toLocaleString('en-US')}`;
  const rate = clean(remuneration?.RateIntervalCode);
  return rate === null ? range : `${range} ${rate}`;
}

function inferRemoteType(
  remote: boolean | null | undefined,
  telework: boolean | null | undefined,
): RemoteType {
  if (remote === true) return 'remote';
  if (telework === true) return 'hybrid';
  if (remote === false || telework === false) return 'onsite';
  return 'unknown';
}

function inferEmploymentType(
  schedule: string | null,
  appointmentType: string | null,
): EmploymentType {
  const value = `${schedule ?? ''} ${appointmentType ?? ''}`.toLowerCase();
  if (value.includes('part time') || value.includes('part-time'))
    return 'part-time';
  if (value.includes('intern')) return 'internship';
  if (value.includes('temporary')) return 'temporary';
  if (value.includes('contract')) return 'contract';
  if (value.includes('full time') || value.includes('full-time'))
    return 'full-time';
  return 'unknown';
}

function parseDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function cleanHtml(value: string | null | undefined): string | null {
  const cleaned = clean(value);
  return cleaned === null ? null : clean(htmlToText(cleaned));
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

export { UsaJobsProvider as USAJobsProvider };
export default new UsaJobsProvider();
