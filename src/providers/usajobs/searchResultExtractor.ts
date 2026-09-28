import type { Page } from 'playwright';

export interface UsaJobsSearchCard {
  id: string;
  title: string;
  href: string;
  agency: string;
  department: string;
  location: string;
  dateText: string;
  salaryText: string | null;
  workSchedule: string | null;
  appointmentType: string | null;
}

export interface UsaJobsSearchPageData {
  cards: UsaJobsSearchCard[];
  hasNext: boolean;
  noResults: boolean;
}

export function hasVerifiableSearchState(): boolean {
  const noResults = document.querySelector<HTMLElement>('#no-search-results');
  const style = noResults ? globalThis.getComputedStyle(noResults) : null;
  const visibleNoResults =
    !!noResults &&
    !noResults.hidden &&
    !noResults.classList.contains('hidden') &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden';
  return (
    document.querySelectorAll('#search-results .page-section').length > 0 ||
    visibleNoResults
  );
}

export function searchResultsExtractor(): UsaJobsSearchPageData {
  const clean = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
  };

  const results = document.querySelector('#search-results');
  const hasNext = !!document.querySelector('#page-m-next');
  const cards: UsaJobsSearchCard[] = [];

  if (results) {
    const sections = results.querySelectorAll(':scope > .page-section');
    for (const section of sections) {
      const link = section.querySelector('h2 a[href*="/job/"]');
      if (!link) continue;

      const href = link.getAttribute('href') ?? '';
      const id =
        link.getAttribute('data-document-id') ??
        href.split('/').filter(Boolean).pop() ??
        '';

      const title = clean(link.textContent);

      const strong = section.querySelector('strong');
      const orgDiv = strong ? strong.closest('div') : null;
      const orgText = orgDiv ? clean(orgDiv.textContent) : '';
      const orgParts = orgText.split('•');
      const agency = strong
        ? clean(strong.textContent)
        : clean(orgParts[0] ?? '');
      const department =
        orgParts.length > 1 ? clean(orgParts.slice(1).join('•')) : '';

      let location = '';
      const locDiv = section.querySelector('div.flex.items-center');
      if (locDiv) {
        location = clean(locDiv.textContent.replace(/^location_on/i, ''));
      }

      let dateText = '';
      const dateDiv = section.querySelector('div.mt-2.italic');
      if (dateDiv) {
        dateText = clean(dateDiv.textContent);
      }

      const badges = [...section.querySelectorAll('.badge')].map((b) =>
        clean(b.textContent),
      );
      let salaryText: string | null = null;
      let workSchedule: string | null = null;
      let appointmentType: string | null = null;
      for (const badge of badges) {
        if (/^\$|starting at|per year|salary/i.test(badge)) {
          salaryText = badge;
        } else if (
          /full[- ]time|part[- ]time|intermittent|ad hoc/i.test(badge)
        ) {
          workSchedule = badge;
        } else if (
          /permanent|multiple|term|temporary|internship|detail|student|recent graduates/i.test(
            badge,
          )
        ) {
          appointmentType = badge;
        }
      }

      cards.push({
        id,
        title,
        href,
        agency,
        department,
        location,
        dateText,
        salaryText,
        workSchedule,
        appointmentType,
      });
    }
  }

  const noResultsElement =
    document.querySelector<HTMLElement>('#no-search-results');
  const noResultsStyle = noResultsElement
    ? globalThis.getComputedStyle(noResultsElement)
    : null;
  const noResults =
    cards.length === 0 &&
    !!noResultsElement &&
    !noResultsElement.hidden &&
    !noResultsElement.classList.contains('hidden') &&
    noResultsStyle?.display !== 'none' &&
    noResultsStyle?.visibility !== 'hidden';

  return { cards, hasNext, noResults };
}

export async function extractSearchPage(
  page: Page,
): Promise<UsaJobsSearchPageData> {
  return page.evaluate(searchResultsExtractor);
}
