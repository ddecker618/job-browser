// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';

import {
  extractJobCards,
  waitForSearchResults,
} from '../src/providers/linkedIn/resultCardExtractor.js';

interface ElementAdapter {
  $(selector: string): Promise<ElementAdapter | null>;
  $$(selector: string): Promise<ElementAdapter[]>;
  textContent(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
}

function adapter(element: Element): ElementAdapter {
  return {
    $: (selector) => {
      const found = element.querySelector(selector);
      return Promise.resolve(found === null ? null : adapter(found));
    },
    $$: (selector) =>
      Promise.resolve([...element.querySelectorAll(selector)].map(adapter)),
    textContent: () => Promise.resolve(element.textContent),
    getAttribute: (name) => Promise.resolve(element.getAttribute(name)),
  };
}

function fakePage(): Page {
  return {
    $$: (selector: string) =>
      Promise.resolve([...document.querySelectorAll(selector)].map(adapter)),
    waitForSelector: () => Promise.resolve(null),
  } as unknown as Page;
}

describe('LinkedIn redesigned result cards', () => {
  it('extracts stable semantic card fields without relying on randomized classes', async () => {
    document.body.innerHTML = `
      <div role="button" componentkey="job-card-component-ref-4468594928">
        <p><span>Selected, Mid-Level Linux Administrator (Verified job)</span></p>
        <p>Boeing</p>
        <p>Berkeley, MO (On-site)</p>
        <p><span>$95K/yr - $125K/yr</span></p>
        <p><span>Posted 5 days ago</span></p>
        <p>Easy Apply</p>
        <button aria-label="Dismiss Mid-Level Linux Administrator job"></button>
      </div>
      <div role="button" componentkey="job-card-component-ref-4461501043">
        <p><span>Information System Administrator</span></p>
        <p>Crossroads Courier</p>
        <p>St Louis, MO (Hybrid)</p>
        <p><span>3 weeks ago</span></p>
        <button aria-label="Dismiss Information System Administrator job"></button>
      </div>`;

    const cards = await extractJobCards(fakePage());

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      jobId: '4468594928',
      title: 'Mid-Level Linux Administrator',
      company: 'Boeing',
      location: 'Berkeley, MO (On-site)',
      salaryText: '$95K/yr - $125K/yr',
      href: 'https://www.linkedin.com/jobs/view/4468594928',
      workplaceType: 'onsite',
      easyApply: true,
    });
    expect(cards[1]).toMatchObject({
      jobId: '4461501043',
      company: 'Crossroads Courier',
      workplaceType: 'hybrid',
    });
  });

  it('waits for the semantic redesigned-card selector', async () => {
    let selector = '';
    const page = {
      waitForSelector: (value: string) => {
        selector = value;
        return Promise.resolve(null);
      },
    } as unknown as Page;

    await expect(waitForSearchResults(page, 10)).resolves.toBe(true);
    expect(selector).toContain(
      '[role="button"][componentkey^="job-card-component-ref-"]',
    );
  });
});
