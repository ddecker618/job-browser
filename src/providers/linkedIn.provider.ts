import { z } from 'zod';
import { resolve } from 'node:path';
import { log } from '../logging/logger.js';
import { BaseProvider } from './baseProvider.js';
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
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import {
  launchBrowserSession,
  closeBrowserSession,
  waitForLogin,
  navigateWithRetry,
  isLoggedIn,
  takeDiagnosticScreenshot,
  detectSecurityChallenge,
} from './linkedIn/browserSession.js';
import {
  buildLinkedInSearchUrl,
  buildJobDetailUrl,
  DATE_POSTED_MAP,
  EMPLOYMENT_TYPE_MAP,
  REMOTE_MAP,
} from './linkedIn/searchUrlBuilder.js';
import {
  extractJobCards,
  waitForSearchResults,
} from './linkedIn/resultCardExtractor.js';
import {
  extractJobDetail,
  parseSeniorityLevel,
  parseEmploymentType,
  parseWorkplaceType,
} from './linkedIn/jobDetailExtractor.js';
import { recordDiagnosticStage } from './linkedIn/diagnostics.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/linkedin-search-response.html', import.meta.url),
);

const linkedInQuerySchema = z.strictObject({
  keywords: z.string().trim().min(1, 'Keywords are required'),
  location: z.string().optional().default(''),
});

const linkedInConfigurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  location: z.string().optional().default(''),
  queries: z.array(linkedInQuerySchema).optional().default([
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
  datePosted: z.enum(['24h', 'week', 'month', 'any']).optional().default('any'),
  experienceLevel: z.string().optional().default(''),
  employmentType: z.string().optional().default(''),
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  minSalary: z.number().int().min(0).optional().default(0),
  browserProfileDir: z.string().optional(),
  headless: z.boolean().optional().default(false),
  keepBrowserOpen: z.boolean().optional().default(false),
  debugMode: z.boolean().optional().default(false),
});

type LinkedInConfiguration = z.infer<typeof linkedInConfigurationSchema>;

interface ResolvedQuery {
  keywords: string;
  location: string;
  remoteFilter: string | null;
  distance: number | null;
  datePosted: string | null;
  experienceLevel: string | null;
  employmentType: string | null;
  salary: number | null;
}

export class LinkedInProvider extends BaseProvider {
  public readonly id = 'linkedin';
  public readonly name = 'LinkedIn Jobs';
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
      process.env['JOB_BROWSER_LINKEDIN_PROFILE'] ??
      resolve(process.cwd(), 'linkedin-profile')
    );
  }

  private resolveQueries(
    config: LinkedInConfiguration,
    requestQuery?: string | null,
  ): ResolvedQuery[] {
    const remoteFilter = config.remoteFilter
      ? (REMOTE_MAP[config.remoteFilter] ?? null)
      : null;
    const datePosted = DATE_POSTED_MAP[config.datePosted] ?? 'any';
    const experienceLevel = config.experienceLevel || null;
    const employmentType = config.employmentType
      ? (EMPLOYMENT_TYPE_MAP[config.employmentType] ?? null)
      : null;
    const distance = config.distance || null;
    const salary = config.minSalary || null;

    const shared = {
      remoteFilter,
      datePosted,
      experienceLevel,
      employmentType,
      distance,
      salary,
    };

    if (config.queries.length > 0) {
      return config.queries.map((q) => ({
        keywords: q.keywords,
        location: q.location || '',
        ...shared,
      }));
    }

    const keywords =
      (config.searchKeywords || requestQuery) ?? 'systems administrator';
    return [
      {
        keywords,
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
    const parsed = linkedInConfigurationSchema.safeParse(configuration);
    return {
      valid: parsed.success,
      message: parsed.success
        ? 'LinkedIn configuration is valid'
        : `LinkedIn configuration error: ${parsed.error.message}`,
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
        : request.location;
    const keywords = firstQuery?.keywords ?? configuredKeywords;
    const searchLocation = firstQuery?.location ?? configuredLocation;

    const target = buildLinkedInSearchUrl({
      keywords,
      location: searchLocation,
      remoteFilter: config.remoteFilter
        ? (REMOTE_MAP[config.remoteFilter] ?? null)
        : null,
      distance: config.distance || null,
      datePosted: DATE_POSTED_MAP[config.datePosted] ?? 'any',
      experienceLevel: config.experienceLevel || null,
      employmentType: config.employmentType
        ? (EMPLOYMENT_TYPE_MAP[config.employmentType] ?? null)
        : null,
      salary: config.minSalary || null,
      sortBy: 'DD',
      page: 1,
    });

    recordDiagnosticStage('search-url-built', target);

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

    if (search.fixturePath !== null) {
      return this.fetchFixture(search);
    }

    const config = search.configuration as unknown as LinkedInConfiguration;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config) {
      throw new Error('LinkedIn configuration is missing');
    }
    const debugMode = config.debugMode;
    const profileDir = resolve(
      process.cwd(),
      config.browserProfileDir ?? this.resolveBrowserProfileDir(),
    );
    const maxResults = config.maxResults;
    const keepBrowserOpen = config.keepBrowserOpen;

    if (!profileDir) {
      throw new Error('LinkedIn browser profile directory is not configured');
    }

    const signal = search.signal;
    const checkCancelled = (): void => {
      if (this.cancelRequested || signal?.aborted) {
        throw new Error('LinkedIn search cancelled');
      }
    };

    checkCancelled();

    try {
      recordDiagnosticStage('launching-browser');
      const { page } = await launchBrowserSession({
        profileDir,
        headless: false,
      });

      checkCancelled();

      const loggedIn = await isLoggedIn(page);
      if (!loggedIn) {
        recordDiagnosticStage('waiting-for-login');
        await page.goto('https://www.linkedin.com/login', {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });

        const loginCompleted = await waitForLogin(page, 300_000);
        if (!loginCompleted) {
          throw new Error(
            'LinkedIn login timed out. Please log in manually and try again.',
          );
        }
      }

      checkCancelled();

      if (await detectSecurityChallenge(page)) {
        recordDiagnosticStage('security-challenge-detected');
        log('warn', 'Security challenge detected on LinkedIn');
        await takeDiagnosticScreenshot(page, 'security-challenge');

        for (let i = 0; i < 60; i++) {
          checkCancelled();
          if (!(await detectSecurityChallenge(page))) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      checkCancelled();

      const queries = this.resolveQueries(config, search.request.query);
      const allCards: Record<string, unknown>[] = [];

      for (let qi = 0; qi < queries.length; qi++) {
        checkCancelled();

        const q = queries[qi];
        if (!q) continue;
        const queryUrl = buildLinkedInSearchUrl({
          keywords: q.keywords,
          location: q.location || null,
          remoteFilter: q.remoteFilter,
          distance: q.distance,
          datePosted: q.datePosted,
          experienceLevel: q.experienceLevel,
          employmentType: q.employmentType,
          salary: q.salary,
          sortBy: 'DD',
          page: 1,
        });

        recordDiagnosticStage(
          `navigating-to-query-${String(qi + 1)}`,
          queryUrl,
        );
        await navigateWithRetry(page, queryUrl, { retries: 3 });

        checkCancelled();
        await page.waitForTimeout(3000);

        const hasResults = await waitForSearchResults(page, 30_000);
        if (!hasResults) {
          log(
            'warn',
            `No search results for query ${String(qi + 1)}: ${q.keywords}`,
          );
          await takeDiagnosticScreenshot(page, `no-results-${String(qi + 1)}`);
          continue;
        }

        await page.waitForTimeout(2000);

        const cards = await this.collectCards(
          page,
          maxResults,
          checkCancelled,
          debugMode,
        );
        allCards.push(...cards);
        recordDiagnosticStage(
          `collected-cards-q${String(qi + 1)}`,
          `${String(cards.length)} cards`,
        );
      }

      checkCancelled();

      if (allCards.length === 0) {
        return {
          records: [],
          rejected: 0,
          truncated: false,
          complete: true,
        };
      }

      const enrichedJobs = await this.enrichWithDetails(
        page,
        allCards,
        checkCancelled,
        debugMode,
      );
      checkCancelled();

      if (!keepBrowserOpen) {
        recordDiagnosticStage('closing-browser');
        await closeBrowserSession().catch(() => {
          /* empty */
        });
      }

      const records = enrichedJobs.map((job) => ({
        ...job,
        providerId: this.id,
        providerName: this.name,
        searchQuery: search.request,
        discoveredAt: new Date().toISOString(),
        source: 'LinkedIn',
      }));

      return {
        records,
        rejected: 0,
        truncated: allCards.length > maxResults,
        complete: allCards.length <= maxResults,
      };
    } catch (error) {
      await closeBrowserSession().catch(() => {
        /* empty */
      });

      if (
        error instanceof Error &&
        error.message === 'LinkedIn search cancelled'
      ) {
        return {
          records: [],
          rejected: 0,
          truncated: false,
          complete: false,
        };
      }

      throw error;
    }
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const job = rawJob as Record<string, unknown>;

    const rawTitle = job['title'];
    const rawCompany = job['company'];
    const rawLocation = job['location'];
    const title = typeof rawTitle === 'string' ? rawTitle : '';
    const company = typeof rawCompany === 'string' ? rawCompany : '';
    const location = typeof rawLocation === 'string' ? rawLocation : '';
    const externalId = typeof job['jobId'] === 'string' ? job['jobId'] : null;
    const postingUrl = typeof job['href'] === 'string' ? job['href'] : null;
    const salaryText =
      typeof job['salaryText'] === 'string' ? job['salaryText'] : null;
    const description =
      typeof job['description'] === 'string' ? job['description'] : null;
    const workplaceType =
      typeof job['workplaceType'] === 'string' ? job['workplaceType'] : null;
    const employmentType =
      typeof job['employmentType'] === 'string' ? job['employmentType'] : null;
    const seniorityLevel =
      typeof job['seniorityLevel'] === 'string' ? job['seniorityLevel'] : null;
    const rawDatePosted = job['datePostedEstimated'];
    const datePosted = typeof rawDatePosted === 'string' ? rawDatePosted : null;

    const parsedSalary = parseSalaryFromTextSync(salaryText);

    const state = location.includes(',')
      ? (location.split(',')[1]?.trim() ?? null)
      : null;
    const city = location.includes(',')
      ? (location.split(',')[0]?.trim() ?? null)
      : null;

    return normalizeJob({
      externalId,
      title: title || 'Untitled Position',
      company: company || 'Unknown Company',
      location: location || null,
      city,
      state,
      remoteType: parseWorkplaceType(
        workplaceType,
      ) as NormalizedJob['remoteType'],
      employmentType: parseEmploymentType(
        employmentType,
      ) as NormalizedJob['employmentType'],
      salaryMinimum: parsedSalary.minimum,
      salaryMaximum: parsedSalary.maximum,
      salaryText: salaryText ?? null,
      description: description ?? null,
      requirements: null,
      preferredQualifications: null,
      postingUrl: postingUrl ?? null,
      providerId: this.id,
      providerName: this.name,
      datePosted: datePosted ?? null,
      discoveredAt,
      seniorityLevel: parseSeniorityLevel(
        seniorityLevel,
      ) as NormalizedJob['seniorityLevel'],
    });
  }

  private parseConfig(
    configuration: Record<string, unknown>,
  ): LinkedInConfiguration {
    return linkedInConfigurationSchema.parse(configuration);
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
          datePostedText: '3 days ago',
          datePostedEstimated: new Date(
            Date.now() - 3 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          promoted: false,
          easyApply: true,
          href: 'https://www.linkedin.com/jobs/view/123456',
          workplaceType: 'remote',
          employmentType: 'full-time',
          applicantCount: '50',
          description:
            'This is a test job description for Software Engineer position.',
          searchQuery: {
            query: 'systems administrator',
            location: null,
            remoteOnly: false,
            limit: 25,
          },
          providerId: this.id,
          providerName: this.name,
          source: 'LinkedIn',
        },
      ],
      rejected: 0,
      truncated: false,
      complete: true,
    };
  }

  private async collectCards(
    page: Page,
    maxResults: number,
    checkCancelled: () => void,
    debugMode: boolean,
  ): Promise<Record<string, unknown>[]> {
    const allCards: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();
    let staleScrollCount = 0;

    while (allCards.length < maxResults && staleScrollCount < 3) {
      checkCancelled();

      const cards = await extractJobCards(page);
      for (const card of cards) {
        const id =
          card.jobId ?? String(card.company) + '-' + String(card.title);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allCards.push(card as unknown as Record<string, unknown>);
          if (allCards.length >= maxResults) break;
        }
      }

      if (allCards.length >= maxResults) break;

      const previousCount = allCards.length;
      await page.evaluate(() => {
        const list = document.querySelector('.jobs-search-results-list');
        if (list) {
          list.scrollTop = list.scrollHeight;
        } else {
          window.scrollBy(0, 800);
        }
      });
      await page.waitForTimeout(2000);

      if (allCards.length === previousCount) {
        staleScrollCount++;
      } else {
        staleScrollCount = 0;
      }
    }

    if (debugMode) {
      recordDiagnosticStage(
        'scroll-complete',
        String(allCards.length) + ' total cards collected',
      );
    }

    return allCards;
  }

  private async enrichWithDetails(
    page: Page,
    cards: Record<string, unknown>[],
    checkCancelled: () => void,
    debugMode: boolean,
  ): Promise<Record<string, unknown>[]> {
    const enriched: Record<string, unknown>[] = [];

    for (let i = 0; i < cards.length; i++) {
      checkCancelled();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const card = cards[i]!;
      const jobId = card['jobId'] as string | null;

      if (debugMode) {
        recordDiagnosticStage(
          'processing-job-' + String(i + 1),
          'Job ID: ' + (jobId ?? 'unknown'),
        );
      }

      if (jobId) {
        try {
          const detailUrl = buildJobDetailUrl(jobId);
          await page.goto(detailUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          await page.waitForTimeout(1500);

          const detail = await extractJobDetail(page);
          enriched.push({
            ...card,
            description: detail.description ?? card['description'],
            workplaceType: detail.workplaceType ?? card['workplaceType'],
            employmentType: detail.employmentType ?? card['employmentType'],
            seniorityLevel: detail.seniorityLevel,
            applicantCount: detail.applicantCount ?? card['applicantCount'],
            easyApply: detail.easyApply || card['easyApply'],
            companyLogo: detail.companyLogo,
          });

          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(1500);
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
        } catch (error) {
          log('warn', `Failed to open job detail page for job ${jobId}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          enriched.push(card);
        }
      } else {
        enriched.push(card);
      }
    }

    return enriched;
  }
}

function parseSalaryFromTextSync(text: string | null): {
  minimum: number | null;
  maximum: number | null;
} {
  if (!text) return { minimum: null, maximum: null };
  const cleaned = text.replace(/[^0-9,.kK\-–—to]/g, ' ').trim();
  const numbers = cleaned.match(/\$?([0-9,]+)(\.?[0-9]*)\s*(k|K)?/g);
  if (!numbers) return { minimum: null, maximum: null };
  const parsed = numbers
    .map((n) => {
      const num = parseFloat(n.replace(/[$,]/g, ''));
      if (n.toLowerCase().includes('k')) return num * 1000;
      return num;
    })
    .filter((n) => !isNaN(n) && n > 0);
  if (parsed.length === 0) return { minimum: null, maximum: null };
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (parsed.length === 1) return { minimum: parsed[0]!, maximum: null };
  return { minimum: Math.min(...parsed), maximum: Math.max(...parsed) };
}

let defaultInstance: LinkedInProvider | null = null;

export function getLinkedInProvider(): LinkedInProvider {
  defaultInstance ??= new LinkedInProvider();
  return defaultInstance;
}

export default getLinkedInProvider();
