import type { Page } from 'playwright';
import { log } from '../../logging/logger.js';
import { takeDiagnosticScreenshot } from './browserSession.js';

export interface JobDetail {
  description: string | null;
  criteriaText: string | null;
  salaryInfo: string | null;
  workplaceType: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  applicantCount: string | null;
  easyApply: boolean;
  companyLogo: string | null;
}

export async function extractJobDetail(page: Page): Promise<JobDetail> {
  const result: JobDetail = {
    description: null,
    criteriaText: null,
    salaryInfo: null,
    workplaceType: null,
    employmentType: null,
    seniorityLevel: null,
    applicantCount: null,
    easyApply: false,
    companyLogo: null,
  };

  try {
    result.description = await extractDescription(page);
    result.criteriaText = await extractCriteriaText(page);
    result.salaryInfo = await extractSalaryInfo(page);
    result.applicantCount = await extractApplicantCount(page);
    result.easyApply = await detectEasyApply(page);

    const criteriaItems = await extractCriteriaItems(page);
    for (const item of criteriaItems) {
      const lower = item.toLowerCase();
      if (
        !result.workplaceType &&
        (lower.includes('remote') ||
          lower.includes('hybrid') ||
          lower.includes('on-site') ||
          lower.includes('onsite'))
      ) {
        result.workplaceType = item;
      }
      if (
        !result.employmentType &&
        (lower.includes('full-time') ||
          lower.includes('part-time') ||
          lower.includes('contract') ||
          lower.includes('temporary') ||
          lower.includes('internship'))
      ) {
        result.employmentType = item;
      }
      if (
        !result.seniorityLevel &&
        (lower.includes('senior') ||
          lower.includes('entry') ||
          lower.includes('mid') ||
          lower.includes('junior') ||
          lower.includes('lead') ||
          lower.includes('director') ||
          lower.includes('associate') ||
          lower.includes('executive') ||
          lower.includes('manager') ||
          lower.includes('internship') ||
          lower.includes('intern'))
      ) {
        result.seniorityLevel = item;
      }
    }

    result.companyLogo = await extractCompanyLogo(page);
  } catch (error) {
    log('error', 'Failed to extract job detail', {
      error: error instanceof Error ? error.message : String(error),
    });
    await takeDiagnosticScreenshot(page, 'detail-extraction-failed');
  }

  return result;
}

async function extractDescription(page: Page): Promise<string | null> {
  const selectors = [
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '.job-details-jobs-unified-top-card__description',
    '.jobs-description__content',
    '.show-more-less-html__markup',
    'article.jobs-description',
    '.job-view-layout .jobs-description',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const html = await element.innerHTML();
        const cleaned = html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length > 20) return cleaned;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function extractCriteriaText(page: Page): Promise<string | null> {
  const selectors = [
    '.job-details-jobs-unified-top-card__job-insight',
    '.jobs-unified-top-card__job-insight',
    '.job-criteria__wrapper',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text?.trim()) return text.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function extractSalaryInfo(page: Page): Promise<string | null> {
  const selectors = [
    '.job-details-jobs-unified-top-card__salary-info',
    '.jobs-unified-top-card__salary-info',
    '.salary compensation',
    '[class*="salary"]',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text?.trim()) return text.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function extractApplicantCount(page: Page): Promise<string | null> {
  const selectors = [
    '.job-details-jobs-unified-top-card__applicant-count',
    '.jobs-unified-top-card__applicant-count',
    '[class*="applicant"]',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text?.trim()) return text.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function detectEasyApply(page: Page): Promise<boolean> {
  const selectors = [
    '.jobs-easy-apply-button',
    'button[data-easy-apply]',
    'button[aria-label*="Easy Apply"]',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function extractCriteriaItems(page: Page): Promise<string[]> {
  const items: string[] = [];
  const selectors = [
    'li.job-criteria__item',
    '.jobs-unified-top-card__job-insight span',
    '[class*="job-criteria"] li',
  ];

  for (const selector of selectors) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const text = await el.textContent();
        if (text?.trim()) items.push(text.trim());
      }
      if (items.length > 0) break;
    } catch {
      continue;
    }
  }

  return items;
}

async function extractCompanyLogo(page: Page): Promise<string | null> {
  const selectors = [
    '.job-details-jobs-unified-top-card__company-logo img',
    '.jobs-unified-top-card__company-logo img',
    '.company-logo img',
    'img[class*="company"][class*="logo"]',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const src = await element.getAttribute('src');
        if (src) return src;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function parseSalaryFromText(text: string | null): {
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

  return {
    minimum: Math.min(...parsed),
    maximum: Math.max(...parsed),
  };
}

export function parseSeniorityLevel(text: string | null): string {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (lower.includes('internship') || lower.includes('intern')) return 'entry';
  if (lower.includes('entry')) return 'entry';
  if (lower.includes('junior')) return 'junior';
  if (
    lower.includes('mid') ||
    lower.includes('associate') ||
    lower.includes('mid-level')
  )
    return 'mid';
  if (lower.includes('senior') || lower.includes('sr.')) return 'senior';
  if (lower.includes('lead')) return 'lead';
  if (lower.includes('manager') || lower.includes('management'))
    return 'manager';
  if (lower.includes('director')) return 'director';
  if (
    lower.includes('executive') ||
    lower.includes('vp') ||
    lower.includes('chief')
  )
    return 'executive';
  return 'unknown';
}

export function parseEmploymentType(text: string | null): string {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (lower.includes('full-time')) return 'full-time';
  if (lower.includes('part-time')) return 'part-time';
  if (lower.includes('contract')) return 'contract';
  if (lower.includes('temporary') || lower.includes('temp')) return 'temporary';
  if (lower.includes('internship')) return 'internship';
  return 'unknown';
}

export function parseWorkplaceType(text: string | null): string {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (lower.includes('remote')) return 'remote';
  if (lower.includes('hybrid')) return 'hybrid';
  if (lower.includes('on-site') || lower.includes('onsite')) return 'onsite';
  return 'unknown';
}
