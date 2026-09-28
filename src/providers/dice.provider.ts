import { z } from 'zod';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright';
import { log } from '../logging/logger.js';
import { BaseProvider } from './baseProvider.js';
import type { QueryDiagnostics } from '../models/discovery.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
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
import { nowUtc } from '../utilities/timestamps.js';
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import {
  launchBrowserSession,
  closeBrowserSession,
  waitForContent,
  waitForCardCount,
} from './linkedIn/browserSession.js';
import { extractJobDetail } from './dice/jobDetailExtractor.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/dice-search-response.json', import.meta.url),
);

const DICE_ZERO_CARD_FAIL_LIMIT = 2;
const DICE_FETCH_BUDGET_MS = 20 * 60_000;
const DICE_DETAIL_WORKER_LIMIT = 2;
const DICE_DETAIL_PACING_MS = 2500;

const diceQuerySchema = z.strictObject({
  keywords: z.string().trim().min(1, 'Keywords are required'),
  location: z.string().optional().default(''),
});

const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  location: z.string().optional().default(''),
  queries: z
    .array(diceQuerySchema)
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
  distance: z.number().int().min(0).max(100).optional().default(25),
  datePosted: z
    .enum(['24h', 'week', 'month', 'any'])
    .optional()
    .default('month'),
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  browserProfileDir: z.string().optional(),
  keepBrowserOpen: z.boolean().optional().default(false),
  debugMode: z.boolean().optional().default(false),
});

type DiceConfiguration = z.infer<typeof configurationSchema>;

interface DiceRawJob {
  jobId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  description: string | null;
  postingUrl: string | null;
  postedDate: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  companyLogo: string | null;
  seniorityLevel: string | null;
  employmentDetails: string[];
}

interface ResolvedQuery {
  keywords: string;
  location: string;
  remoteFilter: string | null;
  distance: number | null;
  datePosted: string | null;
}

interface DiceDetailResult {
  completed: number;
  stopReason: 'request_budget' | 'cancelled' | 'provider_error' | null;
}

export class DiceProvider extends BaseProvider {
  public readonly id = 'dice';
  public readonly name = 'Dice';
  public readonly type: ProviderType = 'job-board';
  public readonly capabilities: ProviderCapabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: false,
    interactiveBrowser: true,
  };

  private browserProfileDir: string | null = null;
  private cancelRequested = false;

  public setBrowserProfileDir(dir: string): void {
    this.browserProfileDir = dir;
  }

  private resolveBrowserProfileDir(): string {
    return (
      this.browserProfileDir ??
      process.env['JOB_BROWSER_DICE_PROFILE'] ??
      resolve(process.cwd(), 'dice-profile')
    );
  }

  private resolveQueries(config: DiceConfiguration): ResolvedQuery[] {
    const datePosted = this.mapDatePosted(config.datePosted);
    const remoteFilter = config.remoteFilter || null;
    const distance = config.distance || null;
    const shared = { remoteFilter, distance, datePosted };

    if (config.queries.length > 0) {
      return config.queries.map((q) => ({
        keywords: q.keywords,
        location: q.location || config.location,
        ...shared,
      }));
    }

    return [
      {
        keywords: config.searchKeywords,
        location: config.location || '',
        ...shared,
      },
    ];
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
        ? 'Dice configuration is valid'
        : `Dice configuration error: ${parsed.error.message}`,
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
    const config = this.parseConfig(rawConfiguration);
    const firstQuery = config.queries.length > 0 ? config.queries[0] : null;
    const configuredKeywords =
      typeof rawConfiguration['searchKeywords'] === 'string'
        ? rawConfiguration['searchKeywords']
        : request.query;
    const configuredLocation =
      typeof rawConfiguration['location'] === 'string'
        ? rawConfiguration['location']
        : (request.location ?? '');
    const keywords = firstQuery?.keywords ?? configuredKeywords;
    const searchLocation = firstQuery?.location ?? configuredLocation;

    const target = this.buildSearchUrl(keywords, searchLocation, config);
    return {
      request,
      target,
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      configuration: config as unknown as Record<string, unknown>,
    };
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    this.cancelRequested = false;
    if (search.fixturePath !== null) return this.fetchFixture(search);

    const config = search.configuration as unknown as DiceConfiguration;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config) throw new Error('Dice configuration is missing');

    const profileDir = resolve(
      process.cwd(),
      config.browserProfileDir ?? this.resolveBrowserProfileDir(),
    );
    const maxResultsPerQuery = config.maxResults;
    const maxUniqueResults = 200;
    const keepBrowserOpen = config.keepBrowserOpen;

    if (!profileDir)
      throw new Error('Dice browser profile directory is not configured');

    const signal = search.signal;
    const deadline = Date.now() + DICE_FETCH_BUDGET_MS;
    const checkCancelled = (): void => {
      if (this.cancelRequested || signal?.aborted)
        throw new Error('Dice search cancelled');
    };

    checkCancelled();

    try {
      const { page, context } = await launchBrowserSession({
        profileDir,
        headless: false,
      });

      const queries = this.resolveQueries(config);
      if (queries.length === 0)
        throw new Error('Dice configuration has no queries');

      const allUnique: DiceRawJob[] = [];
      const seen = new Set<string>();
      const diagnostics: QueryDiagnostics[] = [];
      let completedQueries = 0;
      let failedQueries = 0;
      let truncatedQueries = 0;
      let consecutiveZeroCardQueries = 0;
      let runStopReason:
        | 'request_budget'
        | 'cancelled'
        | 'provider_error'
        | null = null;

      const firstQuery = queries[0];
      if (!firstQuery) throw new Error('Dice configuration has no queries');
      const firstUrl = this.buildSearchUrl(
        firstQuery.keywords,
        firstQuery.location,
        {
          remoteFilter: firstQuery.remoteFilter ?? '',
          distance: firstQuery.distance ?? 25,
          datePosted: firstQuery.datePosted ?? 'any',
        } as DiceConfiguration,
      );
      let initialNavigationComplete = true;
      try {
        await diceNavigateWithinDeadline(
          page,
          firstUrl,
          deadline,
          checkCancelled,
        );
      } catch (error) {
        if (error instanceof DiceRunBudgetError) {
          initialNavigationComplete = false;
          runStopReason = 'request_budget';
        } else if (
          error instanceof Error &&
          error.message.includes('cancelled')
        ) {
          initialNavigationComplete = false;
          runStopReason = 'cancelled';
        } else {
          throw error;
        }
      }

      if (
        initialNavigationComplete &&
        !(await diceIsLoggedIn(page)) &&
        isDiceAuthPath(page.url())
      ) {
        log('info', 'Dice login required, navigating to login page');
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) initialNavigationComplete = false;
        if (!initialNavigationComplete) {
          runStopReason = 'request_budget';
        } else {
          await page.goto('https://www.dice.com/login', {
            waitUntil: 'domcontentloaded',
            timeout: Math.max(1, Math.min(45_000, remainingMs)),
          });
          const loginCompleted = await diceWaitForLogin(
            page,
            Math.max(1, Math.min(300_000, deadline - Date.now())),
          );
          if (!loginCompleted) {
            if (Date.now() >= deadline) {
              initialNavigationComplete = false;
              runStopReason = 'request_budget';
            } else {
              throw new Error('Dice login is required to view search results');
            }
          }
        }
      }

      let firstQueryLoaded = true;
      for (const [queryIndex, q] of queries.entries()) {
        if (this.isCancellationRequested(signal)) {
          runStopReason = 'cancelled';
          this.addSkippedQueryDiagnostics(
            diagnostics,
            queries,
            queryIndex,
            'cancelled',
            'Dice search cancelled before this query started',
          );
          break;
        }

        if (Date.now() >= deadline) {
          runStopReason = 'request_budget';
          const skippedAt = nowUtc();
          this.addSkippedQueryDiagnostics(
            diagnostics,
            queries,
            queryIndex,
            'request_budget',
            'Dice fetch time budget exhausted before this query started',
            skippedAt,
          );
          break;
        }

        const queryStarted = nowUtc();
        const queryStartMs = Date.now();
        let terminationReason: QueryDiagnostics['terminationReason'] =
          'exhausted_results';
        const queryErrors: string[] = [];
        const queryCards: DiceRawJob[] = [];
        let dedupedCount = 0;

        const url = this.buildSearchUrl(q.keywords, q.location, {
          remoteFilter: q.remoteFilter ?? '',
          distance: q.distance ?? 25,
          datePosted: q.datePosted ?? 'any',
        } as DiceConfiguration);

        log('info', 'Dice query started', {
          queryIndex: queryIndex + 1,
          queryTotal: queries.length,
          uniqueResults: allUnique.length,
        });
        try {
          if (!firstQueryLoaded) {
            checkCancelled();
            await diceNavigateWithinDeadline(
              page,
              url,
              deadline,
              checkCancelled,
            );
          }
          firstQueryLoaded = false;
          const rendered = await waitForContent(
            page,
            ['[data-testid="job-card"]'],
            Math.max(1, Math.min(3000, deadline - Date.now())),
          );

          if (!rendered) {
            consecutiveZeroCardQueries++;
            if (
              allUnique.length === 0 &&
              consecutiveZeroCardQueries >= DICE_ZERO_CARD_FAIL_LIMIT
            ) {
              throw new DiceFetchAbortError(
                `Dice board did not render any job listings: no job cards appeared after ${String(consecutiveZeroCardQueries)} queries; the site may now require sign-in or changed its layout`,
              );
            }
            throw new Error(
              `Dice job card list did not render for query "${q.keywords}"`,
            );
          }
          consecutiveZeroCardQueries = 0;

          const cards = await this.collectCards(
            page,
            maxResultsPerQuery,
            checkCancelled,
            deadline,
          );
          for (const card of cards) {
            const key =
              card.jobId ??
              card.postingUrl ??
              `${card.company ?? ''}-${card.title ?? ''}`;
            if (key && !seen.has(key)) {
              seen.add(key);
              queryCards.push(card);
            } else if (key && seen.has(key)) {
              dedupedCount++;
            }
          }

          if (queryCards.length >= maxResultsPerQuery) {
            terminationReason = 'per_query_limit';
            truncatedQueries++;
          }

          for (const card of queryCards) {
            allUnique.push(card);
          }

          if (allUnique.length >= maxUniqueResults) {
            terminationReason = 'global_unique_limit';
          }

          if (Date.now() >= deadline) {
            terminationReason = 'request_budget';
            queryErrors.push(
              'Dice fetch time budget exhausted while collecting this query',
            );
          }

          if (terminationReason === 'request_budget') {
            runStopReason = 'request_budget';
          } else {
            completedQueries++;
          }
        } catch (error) {
          if (error instanceof DiceFetchAbortError) throw error;
          const message =
            error instanceof Error ? error.message : String(error);
          queryErrors.push(message);
          if (error instanceof DiceRunBudgetError) {
            terminationReason = 'request_budget';
            runStopReason = 'request_budget';
            queryErrors.push(
              'Dice fetch time budget exhausted during navigation',
            );
          } else {
            if (message.includes('cancelled')) {
              terminationReason = 'cancelled';
              runStopReason = 'cancelled';
            } else {
              failedQueries++;
              terminationReason = 'provider_error';
            }
          }
          log('warn', 'Dice query failed', {
            queryIndex: queryIndex + 1,
            queryTotal: queries.length,
            errorType: error instanceof Error ? error.name : 'unknown',
          });
        }

        log('info', 'Dice query finished', {
          queryIndex: queryIndex + 1,
          queryTotal: queries.length,
          queryUniqueResults: queryCards.length,
          totalUniqueResults: allUnique.length,
          terminationReason,
        });

        diagnostics.push({
          provider: this.name,
          searchTerm: q.keywords,
          location: q.location,
          requestStarted: queryStarted,
          requestCompleted: nowUtc(),
          rawResultsReturned: queryCards.length + dedupedCount,
          uniqueResultsRetained: queryCards.length,
          duplicatesRemoved: dedupedCount,
          errors: queryErrors,
          durationMs: Date.now() - queryStartMs,
          terminationReason,
        });

        if (allUnique.length >= maxUniqueResults) break;
        if (terminationReason === 'request_budget') {
          runStopReason = 'request_budget';
          this.addSkippedQueryDiagnostics(
            diagnostics,
            queries,
            queryIndex + 1,
            'request_budget',
            'Dice fetch time budget exhausted before this query started',
          );
          break;
        }
      }

      const detailResult = await this.enrichWithDetails(
        context,
        allUnique,
        checkCancelled,
        deadline,
      );
      if (detailResult.stopReason !== null && diagnostics.length > 0) {
        const lastDiagnostic = diagnostics[diagnostics.length - 1];
        if (lastDiagnostic) {
          lastDiagnostic.errors.push(
            detailResult.stopReason === 'request_budget'
              ? 'Dice fetch time budget exhausted before all job details were enriched'
              : detailResult.stopReason === 'cancelled'
                ? 'Dice search cancelled before all job details were enriched'
                : 'Dice detail worker setup failed before all job details were enriched',
          );
          lastDiagnostic.terminationReason = detailResult.stopReason;
        }
      }
      const enrichmentComplete = detailResult.stopReason === null;
      runStopReason ??= detailResult.stopReason;
      const complete =
        enrichmentComplete &&
        failedQueries === 0 &&
        completedQueries === queries.length;
      log('info', 'Dice detail enrichment finished', {
        detailCompleted: detailResult.completed,
        detailTotal: allUnique.filter((job) => job.postingUrl !== null).length,
        uniqueResults: allUnique.length,
        stopReason: runStopReason,
      });

      if (!keepBrowserOpen) {
        await closeBrowserSession().catch(() => undefined);
      }

      const records = allUnique.map((job) => ({
        ...job,
        providerId: this.id,
        providerName: this.name,
        searchQuery: search.request,
        discoveredAt: new Date().toISOString(),
        source: 'Dice',
      }));

      return {
        records,
        rejected: 0,
        truncated:
          truncatedQueries > 0 ||
          !enrichmentComplete ||
          runStopReason !== null ||
          completedQueries < queries.length,
        complete,
        queryDiagnostics: diagnostics,
        plannedQueries: queries.length,
        completedQueries,
        failedQueries,
        truncatedQueries,
      };
    } catch (error) {
      await closeBrowserSession().catch(() => undefined);
      if (error instanceof Error && error.message === 'Dice search cancelled') {
        log('warn', 'Dice discovery stopped', {
          stopReason: 'cancelled',
          uniqueResults: 0,
        });
        return {
          records: [],
          rejected: 0,
          truncated: true,
          complete: false,
          queryDiagnostics: [],
          plannedQueries: 0,
          completedQueries: 0,
          failedQueries: 0,
          truncatedQueries: 0,
        };
      }
      throw error;
    }
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const job = rawJob as Record<string, unknown>;
    const title = typeof job['title'] === 'string' ? job['title'] : '';
    const company = typeof job['company'] === 'string' ? job['company'] : '';
    const location =
      typeof job['location'] === 'string' ? job['location'] : null;
    const externalId = typeof job['jobId'] === 'string' ? job['jobId'] : null;
    const postingUrl =
      typeof job['postingUrl'] === 'string' ? job['postingUrl'] : null;
    const salaryText =
      typeof job['salaryText'] === 'string' ? job['salaryText'] : null;
    const description =
      typeof job['description'] === 'string' ? job['description'] : null;
    const workplaceType =
      typeof job['workplaceType'] === 'string' ? job['workplaceType'] : null;
    const employmentType =
      typeof job['employmentType'] === 'string' ? job['employmentType'] : null;
    const datePosted =
      typeof job['postedDate'] === 'string' ? job['postedDate'] : null;
    const salaryMinimum =
      typeof job['salaryMinimum'] === 'number' ? job['salaryMinimum'] : null;
    const salaryMaximum =
      typeof job['salaryMaximum'] === 'number' ? job['salaryMaximum'] : null;
    const city = location?.includes(',')
      ? (location.split(',')[0]?.trim() ?? null)
      : null;
    const state = location?.includes(',')
      ? (location.split(',')[1]?.trim() ?? null)
      : null;

    return normalizeJob({
      externalId,
      title: title || 'Untitled Position',
      company: company || 'Unknown Company',
      location,
      city,
      state,
      remoteType: this.parseWorkplace(workplaceType),
      employmentType: this.parseEmployment(employmentType),
      salaryMinimum,
      salaryMaximum,
      salaryText,
      description,
      requirements: null,
      preferredQualifications: null,
      postingUrl,
      providerId: this.id,
      providerName: this.name,
      datePosted,
      discoveredAt,
    });
  }

  private async collectCards(
    page: Page,
    maxResults: number,
    checkCancelled: () => void,
    deadline: number,
  ): Promise<DiceRawJob[]> {
    const selectorTimeout = deadline - Date.now();
    if (selectorTimeout <= 0) return [];
    try {
      await page.waitForSelector('[data-testid="job-card"]', {
        timeout: Math.max(1, Math.min(15_000, selectorTimeout)),
      });
    } catch {
      return [];
    }

    const jobs: DiceRawJob[] = [];
    const seenIds = new Set<string>();
    let staleCount = 0;
    let previousUniqueCount = 0;

    while (jobs.length < maxResults && staleCount < 3) {
      checkCancelled();
      if (Date.now() >= deadline) break;

      const cards = await waitForDiceOperation(
        page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-testid="job-card"]')).map(
            (card) => {
              const text = (selector: string, index = 0): string | null => {
                const matches = card.querySelectorAll(selector);
                if (index >= matches.length) return null;
                const value = matches.item(index).textContent.trim();
                return value.length > 0 ? value : null;
              };
              const link = card.querySelector<HTMLAnchorElement>(
                '[data-testid="job-search-job-detail-link"]',
              );
              const href = link?.getAttribute('href') ?? null;
              return {
                jobId: card.getAttribute('data-job-guid'),
                title: link ? link.textContent.trim() || null : null,
                company: text('a[href*="/company-profile/"] p'),
                location: text('p.text-sm.font-normal.text-zinc-600'),
                postedDate: text('p.text-sm.font-normal.text-zinc-600', 1),
                salaryText: text('p.text-xs.font-medium'),
                postingUrl: href?.startsWith('/')
                  ? `https://www.dice.com${href}`
                  : href,
              };
            },
          ),
        ),
        deadline,
        checkCancelled,
      );
      for (const card of cards) {
        const dedupKey = card.jobId ?? card.title ?? '';
        if (dedupKey && !seenIds.has(dedupKey)) {
          seenIds.add(dedupKey);
          jobs.push({
            ...card,
            salaryMinimum: null,
            salaryMaximum: null,
            description: null,
            employmentType: null,
            workplaceType: null,
            companyLogo: null,
            seniorityLevel: null,
            employmentDetails: [],
          });
        }
      }

      if (jobs.length === previousUniqueCount) staleCount++;
      else staleCount = 0;
      previousUniqueCount = jobs.length;

      if (jobs.length >= maxResults) break;
      if (staleCount >= 3) break;

      const previousCardCount = cards.length;
      await waitForDiceOperation(
        page.evaluate(() => window.scrollBy(0, 800)),
        deadline,
        checkCancelled,
      );
      await waitForCardCount(
        () => page.$$('[data-testid="job-card"]'),
        previousCardCount,
        Math.max(1, Math.min(2000, deadline - Date.now())),
      );
    }

    return jobs;
  }

  private async enrichWithDetails(
    context: BrowserContext,
    jobs: DiceRawJob[],
    checkCancelled: () => void,
    deadline: number,
  ): Promise<DiceDetailResult> {
    const detailJobs = jobs.filter((job) => job.postingUrl !== null);
    if (detailJobs.length === 0) return { completed: 0, stopReason: null };

    const pages: Page[] = [];
    let nextJobIndex = 0;
    let completed = 0;
    let stopReason: DiceDetailResult['stopReason'] = null;
    try {
      for (
        let index = 0;
        index < Math.min(DICE_DETAIL_WORKER_LIMIT, detailJobs.length);
        index++
      ) {
        checkCancelled();
        if (Date.now() >= deadline) {
          stopReason = 'request_budget';
          return { completed, stopReason };
        }
        pages.push(await context.newPage());
      }

      const runWorker = async (page: Page): Promise<void> => {
        let lastRequestStartedAt = Number.NEGATIVE_INFINITY;
        for (;;) {
          if (this.cancelRequested) {
            stopReason ??= 'cancelled';
            return;
          }
          try {
            checkCancelled();
          } catch {
            stopReason ??= 'cancelled';
            return;
          }
          const jobIndex = nextJobIndex++;
          const job = detailJobs[jobIndex];
          if (!job) return;
          if (Date.now() >= deadline) {
            stopReason ??= 'request_budget';
            return;
          }
          const postingUrl = job.postingUrl;
          if (!postingUrl) continue;

          while (Date.now() - lastRequestStartedAt < DICE_DETAIL_PACING_MS) {
            let cancelled = false;
            try {
              checkCancelled();
            } catch {
              cancelled = true;
            }
            if (cancelled || this.isCancellationRequested()) {
              stopReason ??= 'cancelled';
              return;
            }
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
              stopReason ??= 'request_budget';
              return;
            }
            const pacingRemaining =
              DICE_DETAIL_PACING_MS - (Date.now() - lastRequestStartedAt);
            await new Promise((resolveDelay) =>
              setTimeout(
                resolveDelay,
                Math.min(100, pacingRemaining, remainingMs),
              ),
            );
          }

          try {
            checkCancelled();
          } catch {
            stopReason ??= 'cancelled';
            return;
          }
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            stopReason ??= 'request_budget';
            return;
          }
          lastRequestStartedAt = Date.now();
          try {
            await waitForDiceOperation(
              page.goto(postingUrl, {
                waitUntil: 'domcontentloaded',
                timeout: Math.max(1, Math.min(30_000, remainingMs)),
              }),
              deadline,
              checkCancelled,
            );
            const contentRemaining = deadline - Date.now();
            if (contentRemaining <= 0) {
              stopReason ??= 'request_budget';
              return;
            }
            await waitForDiceOperation(
              waitForContent(
                page,
                [
                  '[data-testid="jobDetailStructuredData"]',
                  '[data-testid="job-detail-header-card"]',
                ],
                Math.max(1, Math.min(2000, contentRemaining)),
              ),
              deadline,
              checkCancelled,
            );
            checkCancelled();
            if (Date.now() >= deadline) {
              stopReason ??= 'request_budget';
              return;
            }
            const detail = await waitForDiceOperation(
              extractJobDetail(page),
              deadline,
              checkCancelled,
            );
            job.description = detail.description ?? job.description;
            job.salaryText = detail.salaryText ?? job.salaryText;
            job.salaryMinimum = detail.salaryMinimum ?? job.salaryMinimum;
            job.salaryMaximum = detail.salaryMaximum ?? job.salaryMaximum;
            job.workplaceType = detail.workplaceType ?? job.workplaceType;
            job.employmentType = detail.employmentType ?? job.employmentType;
            job.postedDate = detail.postedDate ?? job.postedDate;
            job.company = detail.companyName ?? job.company;
            job.location = detail.location ?? job.location;
            job.title = detail.jobTitle ?? job.title;
            job.companyLogo = detail.companyLogo;
            job.employmentDetails = detail.employmentDetails;
          } catch {
            let cancelled = false;
            try {
              checkCancelled();
            } catch {
              cancelled = true;
            }
            if (cancelled) {
              stopReason ??= 'cancelled';
              return;
            }
            if (Date.now() >= deadline) {
              stopReason ??= 'request_budget';
              return;
            }
            // Detail enrichment is best-effort; keep the original search card.
          }
          completed++;
          log('info', 'Dice detail visited', {
            detailCompleted: completed,
            detailTotal: detailJobs.length,
          });
        }
      };

      await Promise.all(pages.map((workerPage) => runWorker(workerPage)));
      return { completed, stopReason };
    } catch (error) {
      stopReason =
        error instanceof Error && error.message === 'Dice search cancelled'
          ? 'cancelled'
          : Date.now() >= deadline
            ? 'request_budget'
            : 'provider_error';
      if (stopReason === 'provider_error') {
        log('warn', 'Dice detail worker setup failed; retaining search cards');
        return { completed, stopReason };
      }
      return { completed, stopReason };
    } finally {
      await Promise.all(
        pages.map((workerPage) => workerPage.close().catch(() => undefined)),
      );
    }
  }

  private addSkippedQueryDiagnostics(
    diagnostics: QueryDiagnostics[],
    queries: readonly ResolvedQuery[],
    startIndex: number,
    reason: 'request_budget' | 'cancelled',
    message: string,
    timestamp = nowUtc(),
  ): void {
    for (const skippedQuery of queries.slice(startIndex)) {
      diagnostics.push({
        provider: this.name,
        searchTerm: skippedQuery.keywords,
        location: skippedQuery.location,
        requestStarted: timestamp,
        requestCompleted: timestamp,
        rawResultsReturned: 0,
        uniqueResultsRetained: 0,
        duplicatesRemoved: 0,
        errors: [message],
        durationMs: 0,
        terminationReason: reason,
      });
    }
  }

  private isCancellationRequested(signal?: AbortSignal): boolean {
    return this.cancelRequested || signal?.aborted === true;
  }

  private buildSearchUrl(
    keywords: string,
    location: string,
    config: Partial<DiceConfiguration>,
  ): string {
    const url = new URL('https://www.dice.com/jobs');
    url.searchParams.set('q', keywords);
    if (location.trim()) url.searchParams.set('l', location.trim());
    if (config.remoteFilter === 'remote') {
      url.searchParams.set('remote', 'true');
    }
    if (config.datePosted && config.datePosted !== 'any') {
      const days = this.mapDatePosted(config.datePosted);
      if (days) url.searchParams.set('days', days);
    }
    return url.toString();
  }

  private parseWorkplace(type: string | null): NormalizedJob['remoteType'] {
    if (type === 'remote') return 'remote';
    if (type === 'hybrid') return 'hybrid';
    if (type === 'onsite') return 'onsite';
    return 'unknown';
  }

  private parseEmployment(
    type: string | null,
  ): NormalizedJob['employmentType'] {
    if (type === 'full-time') return 'full-time';
    if (type === 'part-time') return 'part-time';
    if (type === 'contract') return 'contract';
    if (type === 'temporary') return 'temporary';
    if (type === 'internship') return 'internship';
    return 'unknown';
  }

  private mapDatePosted(value: string): string | null {
    const map: Record<string, string> = {
      '24h': '1',
      week: '7',
      month: '30',
      any: '',
    };
    return map[value] ?? null;
  }

  private parseConfig(
    configuration: Record<string, unknown>,
  ): DiceConfiguration {
    return configurationSchema.parse(configuration);
  }

  private fetchFixture(search: ProviderSearch): ProviderFetchResult {
    try {
      loadJsonFixture(search.fixturePath ?? DEFAULT_FIXTURE_PATH);
    } catch {
      // fixture not found, use defaults
    }
    return {
      records: [
        {
          jobId: '123456',
          title: 'Software Engineer',
          company: 'Test Company',
          location: 'San Francisco, CA',
          salaryText: '$150,000 - $200,000',
          description:
            'Test job description for Software Engineer at Test Company.',
          postingUrl: 'https://www.dice.com/job/123456',
          postedDate: new Date(
            Date.now() - 3 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          employmentType: 'full-time',
          workplaceType: 'remote',
          searchQuery: {
            query: 'systems administrator',
            location: null,
            remoteOnly: false,
            limit: 25,
          },
          providerId: this.id,
          providerName: this.name,
          source: 'Dice',
        },
      ],
      rejected: 0,
      truncated: false,
      complete: true,
    };
  }
}

async function diceIsLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url === 'about:blank') return false;
    if (
      url.includes('/login') ||
      url.includes('/auth') ||
      url.includes('/signin')
    )
      return false;

    const diceSelectors = [
      'nav .nav-header-menu',
      '.user-account-menu',
      '[data-testid="userAvatar"]',
      '[data-cy="user-avatar"]',
      '.user-menu-dropdown',
      'nav img[alt*="avatar" i]',
      '.nav-item-signed-in',
      '.header-signed-in',
      '.signed-in-menu',
      'header .user-menu',
      'nav .dropdown-menu',
      '[class*="user"]:not([class*="search"])',
    ];
    for (const sel of diceSelectors) {
      if (await page.$(sel)) return true;
    }

    const bodyText = (await page.textContent('body').catch(() => null)) ?? '';
    if (
      /sign\s*out|log\s*out|my\s*profile|my\s*dashboard|my\s*account/i.test(
        bodyText,
      )
    )
      return true;

    return false;
  } catch {
    return false;
  }
}

function isDiceAuthPath(url: string): boolean {
  return (
    url.includes('/login') ||
    url.includes('/signin') ||
    url.includes('/sign-in') ||
    url.includes('/auth')
  );
}

class DiceFetchAbortError extends Error {
  public override readonly name = 'DiceFetchAbortError';
}

class DiceRunBudgetError extends Error {
  public override readonly name = 'DiceRunBudgetError';
}

async function diceNavigateWithinDeadline(
  page: Page,
  url: string,
  deadline: number,
  checkCancelled: () => void,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    checkCancelled();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DiceRunBudgetError();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1, Math.min(45_000, remainingMs)),
      });
      if (Date.now() >= deadline) throw new DiceRunBudgetError();
      return;
    } catch (error) {
      if (error instanceof DiceRunBudgetError) throw error;
      if (Date.now() >= deadline) throw new DiceRunBudgetError();
      if (attempt === 2) {
        throw new Error('Dice navigation failed after bounded retries', {
          cause: error,
        });
      }
      let backoffRemaining = Math.min(2000, deadline - Date.now());
      while (backoffRemaining > 0) {
        checkCancelled();
        const delayMs = Math.min(100, backoffRemaining);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
        backoffRemaining -= delayMs;
        if (Date.now() >= deadline) throw new DiceRunBudgetError();
      }
    }
  }
}

async function waitForDiceOperation<T>(
  operation: Promise<T>,
  deadline: number,
  checkCancelled: () => void,
): Promise<T> {
  const timer: { current: ReturnType<typeof setTimeout> | undefined } = {
    current: undefined,
  };
  const interruption = new Promise<never>((_resolve, reject) => {
    const poll = (): void => {
      try {
        checkCancelled();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        reject(new DiceRunBudgetError());
        return;
      }
      timer.current = setTimeout(poll, Math.min(100, remainingMs));
    };
    poll();
  });
  try {
    return await Promise.race([operation, interruption]);
  } finally {
    if (timer.current !== undefined) clearTimeout(timer.current);
  }
}

async function diceWaitForLogin(
  page: Page,
  timeoutMs = 300_000,
): Promise<boolean> {
  log('info', 'Waiting for Dice login');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await diceIsLoggedIn(page)) {
      log('info', 'Dice login detected');
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function diceProviderInstance(): DiceProvider {
  return new DiceProvider();
}

export default diceProviderInstance();
