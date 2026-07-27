import type { Page } from 'playwright';
import { log } from '../../logging/logger.js';

import { extractJobIdFromCard, parseRelativeDate } from './searchUrlBuilder.js';
import { takeDiagnosticScreenshot } from './browserSession.js';

export interface RawJobCard {
  jobId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  datePostedText: string | null;
  datePostedEstimated: string | null;
  promoted: boolean;
  easyApply: boolean;
  href: string | null;
  workplaceType: string | null;
  employmentType: string | null;
  applicantCount: string | null;
}

export async function extractJobCards(page: Page): Promise<RawJobCard[]> {
  const cards: RawJobCard[] = [];

  try {
    const selectors = [
      '.job-card-container',
      '.jobs-search-results__list-item',
      'li[data-job-id]',
    ];

    let elements: Awaited<ReturnType<typeof page.$$>> = [];
    for (const sel of selectors) {
      elements = await page.$$(sel);
      if (elements.length > 0) break;
    }

    if (elements.length === 0) {
      log('warn', 'No job card elements found on search results page');
      return cards;
    }

    for (const element of elements) {
      try {
        const card = await extractSingleCard(element);
        if (card.title || card.jobId) {
          cards.push(card);
        }
      } catch {
        // skip individual card extraction failures
      }
    }
  } catch (error) {
    log('error', 'Failed to extract job cards', {
      error: error instanceof Error ? error.message : String(error),
    });
    await takeDiagnosticScreenshot(page, 'card-extraction-failed');
  }

  log(
    'info',
    'Extracted ' + String(cards.length) + ' job cards from search results',
  );
  return cards;
}

async function extractSingleCard(element: unknown): Promise<RawJobCard> {
  const card = element as {
    $: (s: string) => Promise<{
      textContent: () => Promise<string>;
      getAttribute: (a: string) => Promise<string | null>;
    } | null>;
  };

  const rawHref = await getAttribute(
    card,
    'a.job-card-list__title, .job-card-container__link, a[data-job-id]',
    'href',
  );
  const href = rawHref?.startsWith('/')
    ? `https://www.linkedin.com${rawHref}`
    : rawHref;
  const dataJobId = await getAttribute(card, '', 'data-job-id');
  const title = await getText(
    card,
    '.job-card-list__title, .artdeco-entity-lockup__title, [data-job-title], .job-card-search__title',
  );
  const company = await getText(
    card,
    '.job-card-container__company-name, .artdeco-entity-lockup__subtitle, .job-card-search__company-name',
  );
  const location = await getText(
    card,
    '.job-card-container__metadata-item, .job-card-search__location, .t-black--light',
  );
  const salaryText = await getText(
    card,
    '.job-card-container__salary-info, .job-card-search__salary-info',
  );
  const dateText = await getText(
    card,
    '.job-card-container__listed-state, time, .job-card-search__listed-state',
  );
  const insight = await getText(card, '.job-card-container__insight');
  const footerText = await getText(card, '.job-card-container__footer-wrapper');

  const jobId =
    extractJobIdFromCard({
      href,
      dataId: dataJobId,
      dataset: {},
    }) ?? (href ? extractIdFromHref(href) : null);

  const dateParsed = dateText
    ? parseRelativeDate(dateText)
    : { text: '', estimated: null };

  const workplaceType = detectWorkplaceType(
    String(location) + ' ' + String(insight) + ' ' + String(footerText),
  );
  const employmentType = detectEmploymentType(
    String(insight) + ' ' + String(footerText),
  );
  const applicantCount = detectApplicantCount(
    String(insight) + ' ' + String(footerText),
  );

  const promoted =
    (insight ?? '').toLowerCase().includes('promoted') ||
    (footerText ?? '').toLowerCase().includes('promoted');

  const easyApply =
    (insight ?? '').toLowerCase().includes('easy apply') ||
    (footerText ?? '').toLowerCase().includes('easy apply');

  return {
    jobId,
    title: title ?? null,
    company: company ?? null,
    location: location ?? null,
    salaryText: salaryText ?? null,
    datePostedText: dateText ?? null,
    datePostedEstimated: dateParsed.estimated,
    promoted,
    easyApply,
    href: href ?? null,
    workplaceType,
    employmentType,
    applicantCount,
  };
}

function extractIdFromHref(href: string): string | null {
  const match = /\/jobs\/view\/(\d+)/.exec(href);
  return match?.[1] ?? null;
}

function detectWorkplaceType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('remote')) return 'remote';
  if (lower.includes('hybrid')) return 'hybrid';
  if (lower.includes('on-site') || lower.includes('onsite')) return 'onsite';
  return null;
}

function detectEmploymentType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('full-time')) return 'full-time';
  if (lower.includes('part-time')) return 'part-time';
  if (lower.includes('contract')) return 'contract';
  if (lower.includes('temporary') || lower.includes('temp')) return 'temporary';
  if (lower.includes('internship')) return 'internship';
  return null;
}

function detectApplicantCount(text: string): string | null {
  const match = /(\d[\d,]*)\s*(applicant|application)/i.exec(text);
  return match?.[1] ?? null;
}

async function getText(
  element: unknown,
  selector: string,
): Promise<string | null> {
  try {
    const el = element as {
      $: (s: string) => Promise<{ textContent: () => Promise<string> } | null>;
    };
    const selectors = selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const found = await el.$(sel);
      if (found) {
        const text = await found.textContent();
        if (text.trim()) return text.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getAttribute(
  element: unknown,
  selector: string,
  attr: string,
): Promise<string | null> {
  try {
    const el = element as {
      $: (s: string) => Promise<{
        getAttribute: (a: string) => Promise<string | null>;
      } | null>;
    };
    if (!selector) {
      return null;
    }
    const selectors = selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const found = await el.$(sel);
      if (found) {
        const value = await found.getAttribute(attr);
        if (value) return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function clickJobCard(
  page: Page,
  index: number,
): Promise<boolean> {
  try {
    const cards = await page.$$('.job-card-container');
    if (index >= cards.length) return false;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await cards[index]!.click();
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}

export async function waitForSearchResults(
  page: Page,
  timeout = 30_000,
): Promise<boolean> {
  try {
    await page.waitForSelector(
      '.job-card-container, .jobs-search-results__list-item',
      {
        timeout,
        state: 'attached',
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function getResultCount(page: Page): Promise<number> {
  try {
    const text = await page.textContent(
      '.jobs-search-results-list__text, .jobs-search-results__count',
    );
    if (!text) return 0;
    const match = /(\d[\d,]*)/.exec(text);
    if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10);
    return 0;
  } catch {
    return 0;
  }
}
