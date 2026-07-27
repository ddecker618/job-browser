import { describe, expect, it, vi } from 'vitest';

import { WorkableProvider } from '../src/providers/workable.provider.js';
import {
  ProviderHttpClient,
  type ProviderHttpTransport,
} from '../src/providers/providerHttpClient.js';
import { detectAts } from '../src/domain/atsDetector.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: false,
  limit: 20,
} as const;

const fixtureJobs = [
  {
    title: 'Senior Security Engineer',
    shortcode: 'FIXTURE01',
    code: 'SEC-001',
    employment_type: 'Full-time',
    telecommuting: true,
    department: 'Security',
    url: 'https://apply.workable.com/j/FIXTURE01',
    application_url: 'https://apply.workable.com/j/FIXTURE01/apply',
    published_on: '2026-07-17',
    created_at: '2026-07-17',
    country: 'United States',
    city: 'San Francisco',
    state: 'California',
    description:
      '<p>Protect production systems and infrastructure at Fixture Corp.</p>',
    locations: [
      {
        country: 'United States',
        countryCode: 'US',
        city: 'San Francisco',
        region: 'California',
        hidden: false,
      },
    ],
  },
  {
    title: 'Cloud Security Analyst',
    shortcode: 'FIXTURE02',
    code: 'SEC-002',
    employment_type: 'Full-time',
    telecommuting: false,
    department: 'Security',
    url: 'https://apply.workable.com/j/FIXTURE02',
    application_url: 'https://apply.workable.com/j/FIXTURE02/apply',
    published_on: '2026-07-16',
    created_at: '2026-07-15',
    country: 'United States',
    city: 'Denver',
    state: 'Colorado',
    description:
      '<p>Analyze cloud security posture and respond to threats.</p>',
    locations: [
      {
        country: 'United States',
        countryCode: 'US',
        city: 'Denver',
        region: 'Colorado',
        hidden: false,
      },
    ],
  },
];

function workableResponse(jobs: unknown[]) {
  return {
    name: 'Fixture Corp',
    description: 'Test company',
    jobs,
  };
}

function client(transport: ProviderHttpTransport): ProviderHttpClient {
  return new ProviderHttpClient({
    timeoutMs: 1_000,
    maxRetries: 0,
    resolver: (url) => Promise.resolve({ pinned: url.hostname }),
    transport,
    writeLog: () => undefined,
  });
}

describe('Workable provider', () => {
  it('validates, fetches its deterministic fixture, rejects malformed records, and normalizes', async () => {
    const provider = new WorkableProvider();
    await expect(
      provider.validateConfiguration({
        subdomain: 'fixturecorp',
        company: 'Fixture Corp',
        unexpected: true,
      }),
    ).resolves.toMatchObject({ valid: false });

    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration: { subdomain: 'fixturecorp', company: 'Fixture Corp' },
    });
    const result = await provider.fetch(search);
    expect(result).toMatchObject({
      rejected: 1,
      complete: true,
      truncated: false,
    });
    expect(result.records).toHaveLength(1);
    expect(
      provider.validate(
        provider.normalize(result.records[0], '2026-07-19T12:00:00.000Z'),
      ),
    ).toMatchObject({
      title: 'Senior Security Engineer',
      company: 'Fixture Corp',
      location: 'San Francisco, California, United States',
      remoteType: 'remote',
      employmentType: 'full-time',
      department: 'Security',
      postingUrl: 'https://apply.workable.com/j/FIXTURE01',
      applicationUrls: ['https://apply.workable.com/j/FIXTURE01/apply'],
      datePosted: '2026-07-17T00:00:00.000Z',
    });
  });

  it('parses live API response shape with full details', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify(workableResponse(fixtureJobs)), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { subdomain: 'fixturecorp', company: 'Fixture Corp' },
    });
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.complete).toBe(true);
    const normalized = provider.normalize(
      result.records[0],
      '2026-07-19T12:00:00.000Z',
    );
    expect(normalized).toMatchObject({
      company: 'Fixture Corp',
      title: 'Senior Security Engineer',
      description:
        'Protect production systems and infrastructure at Fixture Corp.',
      postingUrl: 'https://apply.workable.com/j/FIXTURE01',
      applicationUrls: ['https://apply.workable.com/j/FIXTURE01/apply'],
    });
  });

  it('rejects invalid configuration', async () => {
    const provider = new WorkableProvider();
    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: false,
    });

    await expect(
      provider.validateConfiguration({ subdomain: '' }),
    ).resolves.toMatchObject({ valid: false });

    await expect(
      provider.validateConfiguration({ subdomain: 'invalid!subdomain' }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('rejects non-HTTPS or unsafe configuration', async () => {
    const provider = new WorkableProvider();
    await expect(
      provider.validateConfiguration({ subdomain: 'test', company: '' }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('handles empty board with no jobs', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify(workableResponse([])), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { subdomain: 'emptycorp', company: 'Empty Corp' },
    });
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(0);
    expect(result.rejected).toBe(0);
    expect(result.complete).toBe(true);
  });

  it('handles malformed API response', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'Broken', jobs: null }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { subdomain: 'broken', company: 'Broken' },
    });
    await expect(provider.fetch(search)).rejects.toThrow(
      'Workable response must contain a jobs array',
    );
  });

  it('handles missing jobs key in response', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'Empty' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { subdomain: 'empty', company: 'Empty' },
    });
    await expect(provider.fetch(search)).rejects.toThrow(
      'Workable response must contain a jobs array',
    );
  });

  it('filters by query and location', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify(workableResponse(fixtureJobs)), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));

    const querySearch = await provider.search(
      { query: 'senior', location: null, remoteOnly: false, limit: 20 },
      { fixtureOnly: false, configuration: { subdomain: 'fixturecorp' } },
    );
    const queryResult = await provider.fetch(querySearch);
    expect(queryResult.records).toHaveLength(1);
    expect(
      provider.normalize(queryResult.records[0], '2026-07-19T12:00:00.000Z')
        .title,
    ).toBe('Senior Security Engineer');

    const locationSearch = await provider.search(
      { query: '', location: 'Denver', remoteOnly: false, limit: 20 },
      { fixtureOnly: false, configuration: { subdomain: 'fixturecorp' } },
    );
    const locationResult = await provider.fetch(locationSearch);
    expect(locationResult.records).toHaveLength(1);
    expect(
      provider.normalize(locationResult.records[0], '2026-07-19T12:00:00.000Z')
        .title,
    ).toBe('Cloud Security Analyst');
  });

  it('filters by remote only', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(JSON.stringify(workableResponse(fixtureJobs)), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const provider = new WorkableProvider(client(transport));

    const remoteSearch = await provider.search(
      { query: '', location: null, remoteOnly: true, limit: 20 },
      { fixtureOnly: false, configuration: { subdomain: 'fixturecorp' } },
    );
    const remoteResult = await provider.fetch(remoteSearch);
    expect(remoteResult.records).toHaveLength(1);
    expect(
      provider.normalize(remoteResult.records[0], '2026-07-19T12:00:00.000Z')
        .remoteType,
    ).toBe('remote');
  });

  it('normalizes with partial fields gracefully', async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            workableResponse([
              {
                title: 'Minimal Job',
                shortcode: 'MINIMAL01',
                employment_type: 'Part-time',
                telecommuting: false,
                description: null,
              },
            ]),
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const provider = new WorkableProvider(client(transport));
    const search = await provider.search(
      { query: '', location: null, remoteOnly: false, limit: 20 },
      {
        fixtureOnly: false,
        configuration: { subdomain: 'minimal', company: 'Minimal Inc' },
      },
    );
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(1);
    const normalized = provider.normalize(
      result.records[0],
      '2026-07-19T12:00:00.000Z',
    );
    expect(normalized).toMatchObject({
      title: 'Minimal Job',
      company: 'Minimal Inc',
      location: null,
      remoteType: 'unknown',
      employmentType: 'part-time',
      description: null,
      postingUrl: 'https://apply.workable.com/minimal',
      applicationUrls: [],
    });
  });
});

describe('Workable ATS detection', () => {
  it('detects apply.workable.com URLs', async () => {
    const result = await detectAts('https://apply.workable.com/huggingface/');
    expect(result.detectedPlatform).toBe('Workable');
    expect(result.suggestedProvider).toBe('workable');
    expect(result.extractedConfiguration).toMatchObject({
      subdomain: 'huggingface',
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.supportState).toBe('supported');
  });

  it('detects apply.workable.com URLs without trailing slash', async () => {
    const result = await detectAts('https://apply.workable.com/shopify');
    expect(result.detectedPlatform).toBe('Workable');
    expect(result.extractedConfiguration).toMatchObject({
      subdomain: 'shopify',
    });
  });

  it('detects www.workable.com company URLs', async () => {
    const result = await detectAts('https://www.workable.com/huggingface');
    expect(result.detectedPlatform).toBe('Workable');
    expect(result.extractedConfiguration).toMatchObject({
      subdomain: 'huggingface',
    });
  });
});
