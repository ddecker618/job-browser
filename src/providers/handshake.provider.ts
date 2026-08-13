import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import type { Page, Response } from 'playwright';

import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  QueryDiagnostics,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderType,
  ValidationResult,
} from '../models/source-management.js';
import { normalizeJob } from '../normalizer/jobNormalizer.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import { nowUtc } from '../utilities/timestamps.js';
import { log } from '../logging/logger.js';
import { BaseProvider } from './baseProvider.js';
import {
  closeBrowserSession,
  launchBrowserSession,
  navigateWithRetry,
} from './linkedIn/browserSession.js';
import {
  inferEmploymentType,
  inferRemoteType,
  inferSeniority,
  splitLocation,
  toIsoDate,
} from './browserJobBoard.js';
import {
  ensureHandshakeLogin,
  isHandshakeLoggedIn,
} from './handshake/browserSession.js';
import {
  parseHandshakeSearchPayload,
  type HandshakeRawJob,
  type HandshakeSearchPage,
} from './handshake/searchResponse.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/handshake-search-response.json', import.meta.url),
);
const PAGE_SIZE = 25;
const MAX_PAGES_PER_QUERY = 40;
const MAX_UNIQUE_RESULTS = 200;

const querySchema = z.strictObject({
  keywords: z.string().trim().min(1, 'Keywords are required'),
  location: z.string().optional().default(''),
});

const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  queries: z
    .array(querySchema)
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
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  browserProfileDir: z.string().optional(),
  keepBrowserOpen: z.boolean().optional().default(true),
  debugMode: z.boolean().optional().default(false),
});

type HandshakeConfiguration = z.infer<typeof configurationSchema>;

interface QueryResult {
  jobs: HandshakeRawJob[];
  rawCount: number;
  rejected: number;
  truncated: boolean;
}

export class HandshakeProvider extends BaseProvider {
  public readonly id = 'handshake';
  public readonly name = 'Handshake';
  public readonly type: ProviderType = 'job-board';
  public readonly capabilities: ProviderCapabilities = {
    keywordSearch: true,
    locationSearch: false,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: false,
    interactiveBrowser: true,
  };

  private browserProfileDir: string | null = null;
  private cancelRequested = false;

  public setBrowserProfileDir(directory: string): void {
    this.browserProfileDir = directory;
  }

  public requestCancel(): void {
    this.cancelRequested = true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const parsed = configurationSchema.safeParse(configuration);
    return {
      valid: parsed.success,
      message: parsed.success
        ? 'Handshake configuration is valid'
        : `Handshake configuration error: ${parsed.error.message}`,
      normalizedConfiguration: parsed.success
        ? (parsed.data as unknown as Record<string, unknown>)
        : null,
      preview: null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const rawConfiguration = options.configuration ?? {};
    const config = configurationSchema.parse(rawConfiguration);
    const firstQuery = config.queries[0]?.keywords ?? request.query.trim();
    const remoteFilter =
      config.remoteFilter || (request.remoteOnly ? 'remote' : '');
    return {
      request,
      target: this.buildSearchUrl(firstQuery, remoteFilter, 1),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      configuration: config as unknown as Record<string, unknown>,
    };
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    this.cancelRequested = false;
    if (search.fixturePath !== null)
      return this.fetchFixture(search.fixturePath);

    const config = search.configuration as unknown as HandshakeConfiguration;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config) throw new Error('Handshake configuration is missing');

    const profileDir = resolve(
      process.cwd(),
      config.browserProfileDir ?? this.resolveBrowserProfileDir(),
    );
    const keepBrowserOpen = config.keepBrowserOpen;
    const signal = search.signal;
    const checkCancelled = (): void => {
      if (this.cancelRequested || signal?.aborted)
        throw new Error('Handshake search cancelled');
    };

    let succeeded = false;
    try {
      checkCancelled();
      const { page } = await launchBrowserSession({
        profileDir,
        headless: false,
      });
      const authenticated = await ensureHandshakeLogin(page, 300_000, signal);
      if (!authenticated) {
        throw new Error(
          'Handshake authentication was not completed. Finish signing in and try again.',
        );
      }

      const queries = this.resolveQueries(config, search.request);
      const remoteFilter =
        config.remoteFilter || (search.request.remoteOnly ? 'remote' : '');
      const allUnique: HandshakeRawJob[] = [];
      const seen = new Set<string>();
      const diagnostics: QueryDiagnostics[] = [];
      let completedQueries = 0;
      let failedQueries = 0;
      let truncatedQueries = 0;
      let recordsRejected = 0;

      for (const query of queries) {
        checkCancelled();
        const startedAt = nowUtc();
        const startedMs = Date.now();
        const errors: string[] = [];
        let terminationReason: QueryDiagnostics['terminationReason'] =
          'exhausted_results';
        let rawCount = 0;
        let duplicates = 0;
        let retained = 0;

        try {
          const result = await this.collectQuery(
            page,
            query.keywords,
            remoteFilter,
            config.maxResults,
            checkCancelled,
          );
          rawCount = result.rawCount;
          recordsRejected += result.rejected;
          if (result.truncated) {
            terminationReason = 'per_query_limit';
            truncatedQueries++;
          }

          for (const job of result.jobs) {
            if (seen.has(job.jobId)) {
              duplicates++;
              continue;
            }
            seen.add(job.jobId);
            allUnique.push(job);
            retained++;
            if (allUnique.length >= MAX_UNIQUE_RESULTS) {
              terminationReason = 'global_unique_limit';
              truncatedQueries++;
              break;
            }
          }
          completedQueries++;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message === 'Handshake search cancelled' ||
            message.includes('Handshake authentication')
          ) {
            throw error;
          }
          failedQueries++;
          terminationReason = 'provider_error';
          errors.push(message);
          log(
            'warn',
            `Handshake: query "${query.keywords}" failed: ${message}`,
          );
        }

        diagnostics.push({
          provider: this.name,
          searchTerm: query.keywords,
          location: query.location,
          requestStarted: startedAt,
          requestCompleted: nowUtc(),
          rawResultsReturned: rawCount,
          uniqueResultsRetained: retained,
          duplicatesRemoved: duplicates,
          errors,
          durationMs: Date.now() - startedMs,
          terminationReason,
        });

        if (allUnique.length >= MAX_UNIQUE_RESULTS) break;
      }

      checkCancelled();
      succeeded = true;
      return {
        records: allUnique,
        rejected: recordsRejected,
        truncated: truncatedQueries > 0,
        complete:
          failedQueries === 0 &&
          truncatedQueries === 0 &&
          completedQueries === queries.length,
        queryDiagnostics: diagnostics,
        plannedQueries: queries.length,
        completedQueries,
        failedQueries,
        truncatedQueries,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Handshake search cancelled'
      ) {
        return { records: [], rejected: 0, truncated: false, complete: false };
      }
      throw error;
    } finally {
      if (!keepBrowserOpen || !succeeded) {
        await closeBrowserSession().catch(() => undefined);
      }
    }
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const job = rawJob as HandshakeRawJob;
    const locationParts = splitLocation(job.location);
    const workplaceType = (job.workplaceType ?? '').toLowerCase();
    const remoteType = workplaceType.includes('remote')
      ? 'remote'
      : workplaceType.includes('hybrid')
        ? 'hybrid'
        : /on.?site/.test(workplaceType)
          ? 'onsite'
          : inferRemoteType(`${job.workplaceType ?? ''} ${job.location ?? ''}`);

    return normalizeJob({
      externalId: job.jobId,
      title: job.title || 'Untitled Position',
      company: job.company || 'Unknown Employer',
      location: job.location,
      city: locationParts.city,
      state: locationParts.state,
      remoteType,
      employmentType: inferEmploymentType(
        job.employmentType?.replace(/_/g, ' ') ?? null,
      ),
      salaryMinimum: job.salaryMinimum,
      salaryMaximum: job.salaryMaximum,
      salaryText: job.salaryText,
      description: job.description,
      requirements: null,
      preferredQualifications: null,
      postingUrl: job.postingUrl,
      providerId: this.id,
      providerName: this.name,
      datePosted: toIsoDate(job.postedDate),
      discoveredAt,
      seniorityLevel: inferSeniority(job.title),
      closingDate: toIsoDate(job.closingDate),
      closingDatePrecision: job.closingDate === null ? null : 'instant',
      applicationUrls: job.applicationUrls,
    });
  }

  private resolveBrowserProfileDir(): string {
    return (
      this.browserProfileDir ??
      process.env['JOB_BROWSER_HANDSHAKE_PROFILE'] ??
      resolve(process.cwd(), 'handshake-profile')
    );
  }

  private resolveQueries(
    config: HandshakeConfiguration,
    request: SearchRequest,
  ): { keywords: string; location: string }[] {
    if (config.queries.length > 0) return config.queries;
    return [
      {
        keywords: config.searchKeywords || request.query.trim(),
        location: request.location ?? '',
      },
    ];
  }

  private async collectQuery(
    page: Page,
    query: string,
    remoteFilter: string,
    maxResults: number,
    checkCancelled: () => void,
  ): Promise<QueryResult> {
    const jobs: HandshakeRawJob[] = [];
    const seen = new Set<string>();
    let rawCount = 0;
    let rejected = 0;
    let pageNumber = 1;
    let truncated = false;

    while (jobs.length < maxResults && pageNumber <= MAX_PAGES_PER_QUERY) {
      checkCancelled();
      const pageResult = await this.loadSearchPage(
        page,
        this.buildSearchUrl(query, remoteFilter, pageNumber),
      );
      rawCount += pageResult.jobs.length + pageResult.rejected;
      rejected += pageResult.rejected;
      const countBeforePage = jobs.length;
      for (const job of pageResult.jobs) {
        if (seen.has(job.jobId)) continue;
        seen.add(job.jobId);
        jobs.push(job);
        if (jobs.length >= maxResults) break;
      }

      const hasMore =
        pageResult.hasNextPage ??
        pageNumber * PAGE_SIZE < Math.min(pageResult.totalCount, 10_000);
      if (!hasMore) break;
      if (jobs.length >= maxResults || jobs.length === countBeforePage) {
        truncated = true;
        break;
      }
      pageNumber++;
    }

    if (pageNumber > MAX_PAGES_PER_QUERY) truncated = true;
    return { jobs, rawCount, rejected, truncated };
  }

  private async loadSearchPage(
    page: Page,
    url: string,
  ): Promise<HandshakeSearchPage> {
    try {
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) => isHandshakeOperation(candidate, 'JobSearchQuery'),
          { timeout: 45_000 },
        ),
        navigateWithRetry(page, url, { retries: 3 }),
      ]);
      if (!response.ok()) {
        throw new Error(
          `Handshake search returned HTTP ${String(response.status())}`,
        );
      }
      return parseHandshakeSearchPayload((await response.json()) as unknown);
    } catch (error) {
      if (!(await isHandshakeLoggedIn(page))) {
        throw new Error(
          'Handshake authentication expired. Sign in again and retry discovery.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private buildSearchUrl(
    query: string,
    remoteFilter: string,
    page: number,
  ): string {
    const url = new URL('https://app.joinhandshake.com/job-search');
    url.searchParams.set('query', query.trim());
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(PAGE_SIZE));
    if (remoteFilter !== '') url.searchParams.set('remoteWork', remoteFilter);
    return url.toString();
  }

  private fetchFixture(path: string): ProviderFetchResult {
    const parsed = parseHandshakeSearchPayload(loadJsonFixture(path));
    return {
      records: parsed.jobs,
      rejected: parsed.rejected,
      truncated: false,
      complete: true,
      unfilteredCount: parsed.jobs.length + parsed.rejected,
    };
  }
}

function isHandshakeOperation(
  response: Response,
  operationName: string,
): boolean {
  try {
    const url = new URL(response.url());
    if (url.pathname !== '/hs/graphql') return false;
    if (url.searchParams.get('operationName') === operationName) return true;
    const body = response.request().postDataJSON() as unknown;
    if (Array.isArray(body)) {
      return body.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>)['operationName'] === operationName,
      );
    }
    return (
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>)['operationName'] === operationName
    );
  } catch {
    return false;
  }
}

const defaultProvider = new HandshakeProvider();
export default defaultProvider;
