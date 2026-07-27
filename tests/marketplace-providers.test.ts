import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BuiltInProvider,
  parseBuiltInJobPosting,
  parseBuiltInSearchHtml,
} from '../src/providers/builtin.provider.js';
import { WellfoundProvider } from '../src/providers/wellfound.provider.js';
import { ZipRecruiterProvider } from '../src/providers/ziprecruiter.provider.js';

const discoveredAt = '2026-01-01T00:00:00.000Z';

describe('Built In provider', () => {
  it('extracts job cards from Built In HTML', () => {
    const html = `
      <div id="job-card-42" data-id="job-card">
        <a data-id="company-title">Example Co</a>
        <a data-id="job-card-title" href="/job/software-engineer/42">Software Engineer</a>
        <span>Remote</span>
        <span>$100K - $130K</span>
      </div>
    `;
    const jobs = parseBuiltInSearchHtml(
      html,
      'https://builtin.com/jobs?search=engineer',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('42');
    expect(jobs[0]?.title).toBe('Software Engineer');
    expect(jobs[0]?.company).toBe('Example Co');
    expect(jobs[0]?.postingUrl).toBe(
      'https://builtin.com/job/software-engineer/42',
    );
  });

  it('extracts JobPosting JSON-LD from a detail page', () => {
    const detail = parseBuiltInJobPosting(
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'JobPosting',
            title: 'Senior Engineer',
            description: '<p>Build reliable systems.</p>',
            datePosted: '2026-01-01',
            hiringOrganization: { name: 'Example Co' },
            jobLocation: {
              address: { addressLocality: 'Austin', addressRegion: 'TX' },
            },
            baseSalary: {
              currency: 'USD',
              value: { minValue: 140000, maxValue: 170000 },
            },
          },
        ],
      })}</script>`,
      'https://builtin.com/job/senior-engineer/42',
    );
    expect(detail?.title).toBe('Senior Engineer');
    expect(detail?.company).toBe('Example Co');
    expect(detail?.location).toBe('Austin, TX');
    expect(detail?.salaryMinimum).toBe(140000);
    expect(detail?.salaryMaximum).toBe(170000);
    expect(detail?.description).toBe('Build reliable systems.');
  });

  it('fetches and normalizes its fixture without network access', async () => {
    const provider = new BuiltInProvider();
    const result = await provider.fetch({
      request: {
        query: 'software engineer',
        location: null,
        remoteOnly: false,
        limit: 10,
      },
      target: 'https://builtin.com/jobs?search=software+engineer',
      fixturePath: resolve(
        process.cwd(),
        'src/fixtures/builtin-search-response.html',
      ),
      configuration: {},
    });
    expect(result.records).toHaveLength(1);
    const normalized = provider.normalize(result.records[0], discoveredAt);
    expect(normalized.sourceType).toBe('builtin');
    expect(normalized.company).toBe('Example Co');
    expect(normalized.remoteType).toBe('remote');
  });
});

describe.each([
  ['Wellfound', new WellfoundProvider(), 'wellfound'],
  ['ZipRecruiter', new ZipRecruiterProvider(), 'ziprecruiter'],
] as const)('%s provider', (name, provider, id) => {
  it('validates an empty configuration using defaults', async () => {
    const result = await provider.validateConfiguration({});
    expect(result.valid).toBe(true);
    expect(result.normalizedConfiguration).not.toBeNull();
    expect(result.normalizedConfiguration?.['keepBrowserOpen']).toBe(true);
  });

  it('returns a fixture record without launching a browser', async () => {
    const result = await provider.fetch({
      request: {
        query: 'software engineer',
        location: null,
        remoteOnly: false,
        limit: 10,
      },
      target: `https://www.${id}.com/jobs`,
      fixturePath: resolve(
        process.cwd(),
        `src/fixtures/${id}-search-response.json`,
      ),
      configuration: {},
    });
    expect(result.records).toHaveLength(1);
    const normalized = provider.normalize(result.records[0], discoveredAt);
    expect(normalized.sourceType).toBe(id);
    expect(normalized.postingUrl).not.toBeNull();
  });
});
