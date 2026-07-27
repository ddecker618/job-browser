import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { StructuredDataProvider } from '../src/providers/structuredData.provider.js';

const request = {
  query: '',
  location: null,
  remoteOnly: false,
  limit: 10,
} as const;

const fixtures = (name: string): string =>
  fileURLToPath(new URL(`../src/fixtures/${name}`, import.meta.url));

describe('StructuredDataProvider', () => {
  it.each([
    ['structured-jobposting-page.html', 'Senior Security Engineer', 'remote'],
    ['structured-job-feed.json', 'Platform Engineer', 'onsite'],
    ['structured-job-feed.xml', 'Security Operations Analyst', 'onsite'],
  ] as const)(
    'loads and normalizes %s without live network access',
    async (name, title, remoteType) => {
      const provider = new StructuredDataProvider(() =>
        Promise.reject(new Error('network must not be called')),
      );
      const search = await provider.search(request, {
        fixtureOnly: true,
        fixturePath: fixtures(name),
      });
      const records = await provider.fetch(search);
      const normalized = provider.validate(
        provider.normalize(records.records[0], '2026-07-18T12:00:00.000Z'),
      );

      expect(records.records).toHaveLength(1);
      expect(normalized.title).toBe(title);
      expect(normalized.remoteType).toBe(remoteType);
      expect(normalized.postingUrl).toMatch(/^https:\/\//);
    },
  );

  it('normalizes schema.org salary, employment, location, and dates', async () => {
    const provider = new StructuredDataProvider();
    const search = await provider.search(request, {
      fixtureOnly: true,
      fixturePath: fixtures('structured-jobposting-page.html'),
    });
    const records = await provider.fetch(search);
    const job = provider.normalize(
      records.records[0],
      '2026-07-18T12:00:00.000Z',
    );
    expect(job).toMatchObject({
      company: 'Example Labs',
      employmentType: 'full-time',
      salaryMinimum: 140000,
      salaryMaximum: 175000,
      datePosted: '2026-07-15T00:00:00.000Z',
      postingUrl: 'https://example.com/careers/SEC-101',
    });
    expect(globalThis).not.toHaveProperty('__fixtureScriptExecuted');
  });

  it('validates and previews a source before it can be enabled', async () => {
    const provider = new StructuredDataProvider((url) =>
      Promise.resolve({
        url: String(url),
        status: 200,
        headers: { 'content-type': 'application/ld+json' },
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            '@type': 'JobPosting',
            title: 'Detection Engineer',
            hiringOrganization: { name: 'Example Security' },
            jobLocationType: 'TELECOMMUTE',
          }),
      }),
    );
    const validation = await provider.validateConfiguration({
      url: 'https://jobs.example.com/feed.json',
    });
    expect(validation).toMatchObject({
      valid: true,
      normalizedConfiguration: { url: 'https://jobs.example.com/feed.json' },
      preview: {
        format: 'json',
        jobCount: 1,
        samples: [{ title: 'Detection Engineer', company: 'Example Security' }],
      },
    });
  });

  it('rejects invalid configuration and unsupported content safely', async () => {
    const provider = new StructuredDataProvider((url) =>
      Promise.resolve({
        url: String(url),
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: new Uint8Array(),
        text: () => 'not a supported feed',
      }),
    );
    await expect(
      provider.validateConfiguration({ url: 'file:///tmp/jobs.json' }),
    ).resolves.toMatchObject({
      valid: false,
      preview: null,
    });
    await expect(
      provider.validateConfiguration({ url: 'https://jobs.example.com/feed' }),
    ).resolves.toMatchObject({
      valid: false,
      message: 'Structured source returned an unsupported content type',
    });
  });
});
