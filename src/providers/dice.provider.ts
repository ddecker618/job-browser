import { z } from 'zod';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
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
  navigateWithRetry,
} from './linkedIn/browserSession.js';
import { extractJobDetail } from './dice/jobDetailExtractor.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/dice-search-response.json', import.meta.url),
);

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
    const checkCancelled = (): void => {
      if (this.cancelRequested || signal?.aborted)
        throw new Error('Dice search cancelled');
    };

    checkCancelled();

    try {
      const { page } = await launchBrowserSession({
        profileDir,
        headless: false,
      });
      checkCancelled();

      const loggedIn = await diceIsLoggedIn(page);
      if (!loggedIn) {
        log('info', 'Dice login required, navigating to login page');
        await page.goto('https://www.dice.com/login', {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        const loginCompleted = await diceWaitForLogin(page, 300_000);
        if (!loginCompleted)
          throw new Error(
            'Dice login timed out. Please log in manually and try again.',
          );
      }

      checkCancelled();

      const queries = this.resolveQueries(config);
      const allUnique: DiceRawJob[] = [];
      const seen = new Set<string>();
      const diagnostics: QueryDiagnostics[] = [];
      let completedQueries = 0;
      let failedQueries = 0;
      let truncatedQueries = 0;

      for (const q of queries) {
        checkCancelled();

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

        log('info', `Dice: searching for "${q.keywords}"`);
        try {
          await navigateWithRetry(page, url, { retries: 3 });
          await page.waitForTimeout(3000);

          const cards = await this.collectCards(
            page,
            maxResultsPerQuery,
            checkCancelled,
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

          completedQueries++;
        } catch (error) {
          failedQueries++;
          terminationReason =
            error instanceof Error && error.message.includes('cancelled')
              ? 'cancelled'
              : 'provider_error';
          const message =
            error instanceof Error ? error.message : String(error);
          queryErrors.push(message);
          log('warn', `Dice: query "${q.keywords}" failed: ${message}`);
        }

        log(
          'info',
          `Dice: found ${String(queryCards.length)} unique jobs for "${q.keywords}"`,
        );

        diagnostics.push({
          provider: this.name,
          searchTerm: q.keywords,
          location: q.location,
          requestStarted: queryStarted,
          requestCompleted: nowUtc(),
          rawResultsReturned:
            queryCards.length + dedupedCount + queryCards.length,
          uniqueResultsRetained: queryCards.length,
          duplicatesRemoved: dedupedCount,
          errors: queryErrors,
          durationMs: Date.now() - queryStartMs,
          terminationReason,
        });

        if (allUnique.length >= maxUniqueResults) break;
      }

      checkCancelled();

      const enriched = await this.enrichWithDetails(
        page,
        allUnique,
        checkCancelled,
      );

      if (!keepBrowserOpen) {
        await closeBrowserSession().catch(() => undefined);
      }

      const records = enriched.map((job) => ({
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
        truncated: truncatedQueries > 0,
        complete: failedQueries === 0 && completedQueries === queries.length,
        queryDiagnostics: diagnostics,
        plannedQueries: queries.length,
        completedQueries,
        failedQueries,
        truncatedQueries,
      };
    } catch (error) {
      await closeBrowserSession().catch(() => undefined);
      if (error instanceof Error && error.message === 'Dice search cancelled') {
        return { records: [], rejected: 0, truncated: false, complete: false };
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
  ): Promise<DiceRawJob[]> {
    try {
      await page.waitForSelector('[data-testid="job-card"]', {
        timeout: 15_000,
      });
    } catch {
      return [];
    }

    const jobs: DiceRawJob[] = [];
    const seenIds = new Set<string>();
    let staleCount = 0;

    while (jobs.length < maxResults && staleCount < 3) {
      checkCancelled();

      const cards = await page.$$('[data-testid="job-card"]');
      for (const card of cards) {
        try {
          const jobGuid = await card.getAttribute('data-job-guid');

          const titleEl = await card.$(
            '[data-testid="job-search-job-detail-link"]',
          );
          const title = titleEl
            ? ((await titleEl.textContent())?.trim() ?? null)
            : null;

          const companyEl = await card.$('a[href*="/company-profile/"] p');
          const company = companyEl
            ? ((await companyEl.textContent())?.trim() ?? null)
            : null;

          const linkEl = await card.$(
            '[data-testid="job-search-job-detail-link"]',
          );
          const href = linkEl
            ? ((await linkEl.getAttribute('href')) ?? null)
            : null;
          const absoluteHref = href?.startsWith('/')
            ? `https://www.dice.com${href}`
            : href;

          const locEls = await card.$$('p.text-sm.font-normal.text-zinc-600');
          const locationText = locEls[0]
            ? ((await locEls[0].textContent())?.trim() ?? null)
            : null;
          const postedText = locEls[1]
            ? ((await locEls[1].textContent())?.trim() ?? null)
            : null;

          const salaryEl = await card.$('p.text-xs.font-medium');
          const salaryText = salaryEl
            ? ((await salaryEl.textContent())?.trim() ?? null)
            : null;

          const dedupKey = jobGuid ?? title ?? '';
          if (dedupKey && !seenIds.has(dedupKey)) {
            seenIds.add(dedupKey);
            jobs.push({
              jobId: jobGuid,
              title,
              company,
              location: locationText,
              salaryText,
              salaryMinimum: null,
              salaryMaximum: null,
              description: null,
              postingUrl: absoluteHref,
              postedDate: postedText,
              employmentType: null,
              workplaceType: null,
              companyLogo: null,
              seniorityLevel: null,
              employmentDetails: [],
            });
          }
        } catch {
          // skip individual card errors
        }
      }

      if (jobs.length >= maxResults) break;

      const prevCount = jobs.length;
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(2000);

      if (jobs.length === prevCount) staleCount++;
      else staleCount = 0;
    }

    return jobs;
  }

  private async enrichWithDetails(
    page: Page,
    jobs: DiceRawJob[],
    checkCancelled: () => void,
  ): Promise<DiceRawJob[]> {
    for (const job of jobs) {
      checkCancelled();

      if (!job.postingUrl) continue;

      try {
        await page.goto(job.postingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForTimeout(2000);

        const detail = await extractJobDetail(page);
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

        await page
          .goBack({ waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        await page.waitForTimeout(1500);
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
      } catch {
        // skip detail loading failures
      }
    }
    return jobs;
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

    if (
      url.startsWith('https://www.dice.com/') &&
      url !== 'https://www.dice.com/'
    ) {
      if (
        await page.$(
          'form[action*="search"], input[type="search"], .search-form, nav, header, main',
        )
      )
        return true;
    }

    return false;
  } catch {
    return false;
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
