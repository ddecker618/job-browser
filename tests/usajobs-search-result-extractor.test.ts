// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { searchResultsExtractor } from '../src/providers/usajobs/searchResultExtractor.js';

function renderSearchPage({
  withResults = true,
  noSearchResultsElement = true,
}: {
  withResults?: boolean;
  noSearchResultsElement?: boolean;
} = {}): void {
  const section = `
    <section class="page-section">
      <h2><a href="/job/878163700" data-document-id="878163700">Systems Administrator</a></h2>
      <div><strong>National Institute of Standards and Technology</strong> • Department of Commerce</div>
      <div class="flex items-center"><svg></svg>Rockville, Maryland</div>
      <div class="mt-2 italic text-gray-dark"><svg></svg> <span>Open 07/28/2026 to 08/04/2026</span></div>
      <div class="badge">Starting at $121,785 Per year (ZP 4)</div>
      <div class="badge">Full-time</div>
      <div class="badge">Permanent</div>
    </section>
  `;
  const noResults = noSearchResultsElement
    ? '<div id="no-search-results" class="hidden">No jobs found</div>'
    : '';
  document.body.innerHTML = `
    ${withResults ? `<div id="search-results">${section}${section}</div>` : ''}
    ${noResults}
    ${withResults ? '<button id="page-m-next">Next</button>' : ''}
  `;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('searchResultsExtractor', () => {
  it('extracts cards and reports noResults=false when results are present even if the hidden no-results element exists', () => {
    renderSearchPage();

    const data = searchResultsExtractor();

    expect(data.cards).toHaveLength(2);
    expect(data.noResults).toBe(false);
    expect(data.hasNext).toBe(true);
    expect(data.cards[0]).toMatchObject({
      id: '878163700',
      title: 'Systems Administrator',
      agency: 'National Institute of Standards and Technology',
      department: 'Department of Commerce',
      location: 'Rockville, Maryland',
      dateText: 'Open 07/28/2026 to 08/04/2026',
      salaryText: 'Starting at $121,785 Per year (ZP 4)',
      workSchedule: 'Full-time',
      appointmentType: 'Permanent',
    });
  });

  it('reports noResults=true only when there are no cards', () => {
    renderSearchPage({ withResults: false });

    const data = searchResultsExtractor();

    expect(data.cards).toHaveLength(0);
    expect(data.noResults).toBe(true);
    expect(data.hasNext).toBe(false);
  });
});
