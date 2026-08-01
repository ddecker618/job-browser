import type { Page } from 'playwright';

export interface UsaJobsDetailData {
  title: string;
  text: string;
  pairs: { label: string; value: string }[];
  applyLinks: string[];
}

export function jobDetailExtractor(): UsaJobsDetailData {
  const clean = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
  };

  const main = document.querySelector('main');
  if (!main) return { title: '', text: '', pairs: [], applyLinks: [] };

  const text = main.innerText.replace(/\u00a0/g, ' ');

  const h1 = main.querySelector('h1');
  const title = h1 ? clean(h1.textContent) : '';

  const pairs: UsaJobsDetailData['pairs'] = [];
  for (const dl of main.querySelectorAll('dl')) {
    const dt = dl.querySelector('dt');
    const dd = dl.querySelector('dd');
    if (dt && dd) {
      pairs.push({
        label: clean(dt.textContent),
        value: clean(dd.textContent),
      });
    }
  }

  const applyLinks = [...main.querySelectorAll('a[href*="ApplyStart"]')].map(
    (a) => (a as HTMLAnchorElement).href,
  );

  return { title, text, pairs, applyLinks };
}

export async function extractJobDetail(page: Page): Promise<UsaJobsDetailData> {
  return page.evaluate(jobDetailExtractor);
}
