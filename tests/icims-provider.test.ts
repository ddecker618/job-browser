import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectAts } from '../src/domain/atsDetector.js';
import { IcimsProvider } from '../src/providers/icims.provider.js';
import type { ProviderHttpTransport } from '../src/providers/providerHttpClient.js';
import type { PublicFetchResponse } from '../src/security/boundedPublicFetch.js';
import { providerTestClient } from './provider-test-client.js';

const discoveredAt = '2026-07-20T12:00:00.000Z';
const request = {
  query: 'security',
  location: null,
  remoteOnly: false,
  limit: 20,
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

function job(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data: {
      slug: String(id),
      req_id: String(id),
      title: `Engineer ${String(id)}`,
      description: '<p>Build reliable systems.</p>',
      city: 'Seattle',
      state: 'Washington',
      country: 'United States',
      categories: ['Technology'],
      employment_type: 'FULL_TIME',
      hiring_organization: 'Fixture Corp',
      posted_date: '2026-07-15T12:00:00+0000',
      apply_url: `https://fixture.icims.com/jobs/${String(id)}/login`,
      canonical_url: `https://careers.fixture.example/jobs/${String(id)}`,
      ats_code: 'icims',
      ...overrides,
    },
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(url: string, html: string): PublicFetchResponse {
  return {
    url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: new TextEncoder().encode(html),
    text: () => html,
  };
}

describe('iCIMS provider', () => {
  it('loads its fixture, rejects malformed records, filters, and normalizes', async () => {
    const provider = new IcimsProvider();
    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration: {
        portalUrl: 'https://careers.fixture.example/jobs/search',
        company: 'Fixture Corp',
      },
    });

    expect(search.target).toBe(
      'https://careers.fixture.example/api/jobs?_company=Fixture+Corp',
    );
    const result = await provider.fetch(search);
    expect(result).toMatchObject({
      rejected: 1,
      complete: true,
      truncated: false,
      unfilteredCount: 3,
    });
    expect(result.records).toHaveLength(1);

    const normalized = provider.validate(
      provider.normalize(result.records[0], discoveredAt),
    );
    expect(normalized).toMatchObject({
      externalId: '18317',
      title: 'Security Analyst',
      company: 'Fixture Corp',
      department: 'Security',
      location: 'Denver, Colorado, United States',
      city: 'Denver',
      state: 'Colorado',
      remoteType: 'onsite',
      employmentType: 'full-time',
      datePosted: '2026-07-14T12:00:00.000Z',
      postingUrl: 'https://careers.fixturecorp.com/jobs/18317',
      applicationUrls: ['https://fixture.icims.com/jobs/18317/login'],
      salaryMinimum: null,
      salaryMaximum: null,
    });
    expect(normalized.description).toBe(
      'Monitor and respond to security incidents across the organization.',
    );
  });

  it('validates and normalizes portal origins while rejecting malformed configuration', async () => {
    const provider = new IcimsProvider();
    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: false,
    });
    for (const portalUrl of [
      '',
      'http://careers.example.com',
      'https://',
      'https://user:secret@careers.example.com',
    ]) {
      await expect(
        provider.validateConfiguration({ portalUrl }),
      ).resolves.toMatchObject({ valid: false });
    }
    await expect(
      provider.validateConfiguration({
        portalUrl: 'https://careers.example.com/jobs/search',
        unexpected: true,
      }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('validates the public iCIMS feed and reports incompatible and rate-limited portals', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const validProvider = new IcimsProvider(
      providerTestClient(() =>
        Promise.resolve(response({ jobs: [job(1)], totalCount: 1 })),
      ),
    );
    await expect(
      validProvider.validateConfiguration({
        portalUrl: 'https://careers.example.com/jobs/search',
      }),
    ).resolves.toMatchObject({
      valid: true,
      normalizedConfiguration: {
        portalUrl: 'https://careers.example.com',
      },
    });

    const incompatible = new IcimsProvider(
      providerTestClient(() =>
        Promise.resolve(
          response({
            jobs: [job(2, { ats_code: 'other' })],
            totalCount: 1,
          }),
        ),
      ),
    );
    await expect(
      incompatible.validateConfiguration({
        portalUrl: 'https://careers.example.com',
      }),
    ).resolves.toMatchObject({
      valid: false,
      message: 'The public jobs endpoint is not an iCIMS careers feed',
    });

    const limited = new IcimsProvider(
      providerTestClient(() => Promise.resolve(response({}, 429))),
    );
    await expect(
      limited.validateConfiguration({
        portalUrl: 'https://careers.example.com',
      }),
    ).resolves.toMatchObject({
      valid: false,
      message: 'iCIMS careers site rate limited validation',
    });

    const unavailable = new IcimsProvider(
      providerTestClient(() => Promise.resolve(response({}, 404))),
    );
    await expect(
      unavailable.validateConfiguration({
        portalUrl: 'https://careers.example.com',
      }),
    ).resolves.toMatchObject({
      valid: false,
      message:
        'iCIMS careers site not found - the /api/jobs endpoint was not found',
    });
  });

  it('continues pagination when an earlier full page does not match filters', async () => {
    const calls: URL[] = [];
    const provider = new IcimsProvider(
      providerTestClient((url) => {
        calls.push(new URL(url));
        const page = url.searchParams.get('page');
        return Promise.resolve(
          page === '1'
            ? response({
                jobs: Array.from({ length: 50 }, (_, index) => job(index + 1)),
                totalCount: 51,
              })
            : response({
                jobs: [job(51, { title: 'Security Engineer' })],
                totalCount: 51,
              }),
        );
      }),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { portalUrl: 'https://careers.example.com' },
    });

    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(1);
    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(calls.map((url) => url.searchParams.get('page'))).toEqual([
      '1',
      '2',
    ]);
    expect(calls.every((url) => url.searchParams.get('limit') === '50')).toBe(
      true,
    );
  });

  it('suppresses duplicate identities without counting them as malformed', async () => {
    const duplicate = job(7, { title: 'Security Engineer' });
    const provider = new IcimsProvider(
      providerTestClient(() =>
        Promise.resolve(
          response({ jobs: [duplicate, duplicate], totalCount: 2 }),
        ),
      ),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { portalUrl: 'https://careers.example.com' },
    });
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(1);
    expect(result.rejected).toBe(0);
    expect(result.unfilteredCount).toBe(2);
  });

  it('handles empty boards and rejects malformed top-level responses', async () => {
    const empty = new IcimsProvider(
      providerTestClient(() =>
        Promise.resolve(response({ jobs: [], totalCount: 0 })),
      ),
    );
    const emptySearch = await empty.search(request, {
      fixtureOnly: false,
      configuration: { portalUrl: 'https://careers.example.com' },
    });
    await expect(empty.fetch(emptySearch)).resolves.toMatchObject({
      records: [],
      rejected: 0,
      complete: true,
      truncated: false,
    });

    const malformed = new IcimsProvider(
      providerTestClient(() => Promise.resolve(response({ jobs: null }))),
    );
    const malformedSearch = await malformed.search(request, {
      fixtureOnly: false,
      configuration: { portalUrl: 'https://careers.example.com' },
    });
    await expect(malformed.fetch(malformedSearch)).rejects.toThrow(
      'iCIMS response must contain a jobs array',
    );
  });

  it('normalizes partial records with configured employer and explicit remote status', async () => {
    const provider = new IcimsProvider(
      providerTestClient(() =>
        Promise.resolve(
          response({
            jobs: [
              job(8, {
                title: 'Remote Support Specialist',
                description: null,
                city: null,
                state: null,
                country: null,
                location_name: 'Remote',
                categories: [],
                employment_type: 'PART_TIME',
                hiring_organization: null,
                apply_url: null,
                canonical_url: null,
                posted_date: null,
                remote: true,
              }),
            ],
            totalCount: 1,
          }),
        ),
      ),
    );
    const search = await provider.search(
      { query: '', location: null, remoteOnly: true, limit: 20 },
      {
        fixtureOnly: false,
        configuration: {
          portalUrl: 'https://careers.example.com',
          company: 'Configured Employer',
        },
      },
    );
    const result = await provider.fetch(search);
    const normalized = provider.validate(
      provider.normalize(result.records[0], discoveredAt),
    );
    expect(normalized).toMatchObject({
      company: 'Configured Employer',
      location: 'Remote',
      remoteType: 'remote',
      employmentType: 'part-time',
      department: null,
      description: null,
      postingUrl: null,
      applicationUrls: [],
      datePosted: null,
    });
  });

  it('fails the run rather than returning a partial page when pagination fails', async () => {
    const transport = vi.fn<ProviderHttpTransport>((_resolved, url) =>
      url.searchParams.get('page') === '1'
        ? Promise.resolve(
            response({
              jobs: Array.from({ length: 50 }, (_, index) => job(index + 1)),
              totalCount: 51,
            }),
          )
        : Promise.resolve(response({}, 503)),
    );
    const provider = new IcimsProvider(
      providerTestClient((url, init) => transport({}, url, init)),
    );
    const search = await provider.search(
      { query: '', location: null, remoteOnly: false, limit: 100 },
      {
        fixtureOnly: false,
        configuration: { portalUrl: 'https://careers.example.com' },
      },
    );
    await expect(provider.fetch(search)).rejects.toThrow('iCIMS (HTTP 503)');
  });
});

describe('iCIMS ATS detection', () => {
  it('extracts a hosted iCIMS portal origin and company identifier', async () => {
    await expect(
      detectAts('https://careers-example-company.icims.com/jobs/search', {
        fetchPublic: (value) => {
          if (String(value).includes('/api/jobs')) {
            return Promise.resolve({
              url: String(value),
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: new TextEncoder().encode(JSON.stringify({ jobs: [] })),
              text: () => JSON.stringify({ jobs: [] }),
            });
          }
          return Promise.resolve(htmlResponse(String(value), ''));
        },
      }),
    ).resolves.toMatchObject({
      detectedPlatform: 'iCIMS',
      suggestedProvider: 'icims',
      supportState: 'supported',
      extractedConfiguration: {
        portalUrl: 'https://careers-example-company.icims.com',
        company: 'example company',
      },
    });
  });

  it('detects iCIMS evidence on vanity domains and requests portal configuration', async () => {
    await expect(
      detectAts('https://careers.example.com/jobs', {
        fetchPublic: (value) => {
          if (String(value).includes('/api/jobs')) {
            return Promise.resolve({
              url: String(value),
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: new TextEncoder().encode(JSON.stringify({ jobs: [] })),
              text: () => JSON.stringify({ jobs: [] }),
            });
          }
          return Promise.resolve(
            htmlResponse(
              String(value),
              '<meta name="generator" content="iCIMS Career Portal">',
            ),
          );
        },
      }),
    ).resolves.toMatchObject({
      detectedPlatform: 'iCIMS',
      suggestedProvider: 'icims',
      supportState: 'supported-with-configuration',
      extractedConfiguration: null,
    });
  });

  it('detects modern Jibe/iCIMS via jasession cookie', async () => {
    const result = await detectAts('https://careers.example.com/jobs', {
      fetchPublic: (value) =>
        Promise.resolve({
          url: String(value),
          status: 200,
          headers: {
            'content-type': 'text/html',
            'set-cookie': 'jasession=s%3Aabc123',
          },
          body: new TextEncoder().encode('<html></html>'),
          text: () => '<html></html>',
        }),
    });
    expect(result).toMatchObject({
      detectedPlatform: 'iCIMS',
      suggestedProvider: 'icims',
      supportState: 'supported-with-configuration',
      failureCategory: null,
    });
    expect(result.positiveSignals).toContain(
      'set-cookie header contains "jasession"',
    );
  });

  it('detects legacy iCIMS portals and sets failureCategory legacy_portal', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const result = await detectAts('https://careers-example.icims.com', {
      fetchPublic: (value) => {
        if (String(value).includes('/api/jobs')) {
          return Promise.resolve({
            url: String(value),
            status: 404,
            headers: { 'content-type': 'text/html' },
            body: new TextEncoder().encode('Not Found'),
            text: () => 'Not Found',
          });
        }
        return Promise.resolve({
          url: String(value),
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode('<html>icims</html>'),
          text: () => '<html>icims</html>',
        });
      },
    });

    expect(result).toMatchObject({
      detectedPlatform: 'iCIMS',
      suggestedProvider: null,
      supportState: 'detected-but-unsupported',
      failureCategory: 'legacy_portal',
    });
  });

  it('reports timeout failures with proper category and explanation', async () => {
    const result = await detectAts('https://careers.example.com', {
      fetchPublic: () => Promise.reject(new Error('Public request timed out')),
    });
    expect(result).toMatchObject({
      detectedPlatform: null,
      supportState: 'unsupported',
      failureCategory: 'timeout',
      explanation: 'The connection to the site timed out.',
    });
  });

  it('reports unreachable failures with proper category', async () => {
    const result = await detectAts('https://careers.example.com', {
      fetchPublic: () => Promise.reject(new Error('Public request failed')),
    });
    expect(result).toMatchObject({
      detectedPlatform: null,
      supportState: 'unsupported',
      failureCategory: 'unreachable',
    });
  });

  it('reports blocked access with proper category', async () => {
    const result = await detectAts('https://careers.example.com', {
      fetchPublic: (value) =>
        Promise.resolve({
          url: String(value),
          status: 403,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode('Blocked by Akamai'),
          text: () => 'Blocked by Akamai',
        }),
    });
    expect(result).toMatchObject({
      detectedPlatform: null,
      supportState: 'unsupported',
      failureCategory: 'blocked',
      httpStatus: 403,
    });
  });

  it('reports invalid URLs with proper category', async () => {
    const result = await detectAts('not-a-valid-url');
    expect(result).toMatchObject({
      detectedPlatform: null,
      supportState: 'unsupported',
      failureCategory: 'invalid_url',
    });
  });

  it('validates configuration with mock Jibe response returning diagnostics and preview', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const provider = new IcimsProvider(
      providerTestClient(() => {
        return Promise.resolve(
          response({
            jobs: [
              job(1, {
                title: 'Security Engineer',
                city: 'Denver',
                state: 'CO',
                ats_code: 'icims',
              }),
            ],
            totalCount: 1,
          }),
        );
      }),
    );

    const result = await provider.validateConfiguration({
      portalUrl: 'https://careers.example.com',
      company: 'example',
    });

    expect(result).toMatchObject({
      valid: true,
      preview: {
        format: 'iCIMS Jibe API',
        jobCount: 1,
        samples: [
          {
            title: 'Security Engineer',
            company: 'example',
            location: 'Denver, CO',
          },
        ],
      },
      diagnostics: {
        provider: 'icims',
        resolvedPortalUrl: 'https://careers.example.com',
        httpStatus: 200,
        schemaRecognized: true,
        sampleCount: 1,
      },
    });
  });

  it('validates legacy iCIMS portal returning legacy_portal category', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const provider = new IcimsProvider(
      providerTestClient(() => {
        return Promise.resolve(response({}, 404));
      }),
    );

    const result = await provider.validateConfiguration({
      portalUrl: 'https://careers-legacy.icims.com',
      variant: 'jibe_json',
    });

    expect(result).toMatchObject({
      valid: false,
      failureCategory: 'legacy_portal',
      message:
        'This appears to be a legacy iCIMS portal, which is not supported.',
    });
  });

  it('validates 403/blocked access returning blocked category', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const provider = new IcimsProvider(
      providerTestClient(() => Promise.resolve(response({}, 403))),
    );

    const result = await provider.validateConfiguration({
      portalUrl: 'https://careers.example.com',
      variant: 'jibe_json',
    });

    expect(result).toMatchObject({
      valid: false,
      failureCategory: 'blocked',
    });
  });

  it('validates timeout returning timeout category', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');

    const provider = new IcimsProvider(
      providerTestClient(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('timeout')), 1500);
        });
      }),
    );

    const result = await provider.validateConfiguration({
      portalUrl: 'https://careers.example.com',
      variant: 'jibe_json',
    });

    expect(result).toMatchObject({
      valid: false,
      failureCategory: 'timeout',
    });
  });

  // ----------------------------------------------------
  // New Hosted iCIMS Tests (v1 & v2)
  // ----------------------------------------------------

  describe('Hosted iCIMS Variants Validation & Discovery', () => {
    it('discovers jobs via sitemap for v1 hosted variant', async () => {
      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://careers.example.com/jobs/101/software-engineer/job</loc></url>
        <url><loc>https://careers.example.com/jobs/102/data-scientist/job</loc></url>
        <url><loc>https://careers.example.com/jobs/login</loc></url>
      </urlset>`;

      const jobDetailHtml = `<!DOCTYPE html>
      <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Staff Engineer",
          "description": "Develop systems.",
          "jobLocation": {
            "address": {
              "addressLocality": "Chicago",
              "addressRegion": "IL"
            }
          }
        }
        </script>
      </head>
      <body></body>
      </html>`;

      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/sitemap.xml') {
            return Promise.resolve(
              new Response(sitemapXml, {
                status: 200,
                headers: { 'Content-Type': 'application/xml' },
              }),
            );
          }
          if (url.pathname.includes('/jobs/')) {
            return Promise.resolve(
              new Response(jobDetailHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      const fetchResult = await provider.fetch({
        request: {
          query: 'Staff',
          location: null,
          remoteOnly: false,
          limit: 10,
        },
        target: 'https://careers.example.com/jobs/search',
        fixturePath: null,
        configuration: {
          portalUrl: 'https://careers.example.com',
          variant: 'icims_hosted_v1',
        },
      });

      expect(fetchResult.records).toHaveLength(2);
      expect(fetchResult.records[0]).toMatchObject({
        title: 'Staff Engineer',
        city: 'Chicago',
        state: 'IL',
      });
    });

    it('discovers jobs via search page crawler for v1 when sitemap fails', async () => {
      const searchHtml = `<!DOCTYPE html>
      <html>
      <body>
        <a href="/jobs/201/devops/job">DevOps Engineer</a>
        <a href="/jobs/candidate/login">Login</a>
      </body>
      </html>`;

      const detailHtml = `<!DOCTYPE html>
      <html>
      <body>
        <h1 class="iCIMS_Header">DevOps Engineer (ID: 201)</h1>
        <div class="iCIMS_InfoMsg_JobDescription">Maintain infrastructure.</div>
        <div class="iCIMS_JobHeaderTable">Location: US-IL-Chicago</div>
      </body>
      </html>`;

      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/sitemap.xml') {
            return Promise.resolve(new Response('', { status: 404 }));
          }
          if (url.pathname === '/jobs/search') {
            return Promise.resolve(
              new Response(searchHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          if (url.pathname.includes('/jobs/')) {
            return Promise.resolve(
              new Response(detailHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      const fetchResult = await provider.fetch({
        request: {
          query: 'DevOps',
          location: null,
          remoteOnly: false,
          limit: 10,
        },
        target: 'https://careers.example.com/jobs/search',
        fixturePath: null,
        configuration: {
          portalUrl: 'https://careers.example.com',
          variant: 'icims_hosted_v1',
        },
      });

      expect(fetchResult.records).toHaveLength(1);
      expect(fetchResult.records[0]).toMatchObject({
        title: 'DevOps Engineer',
        location_name: 'Chicago, IL, US',
      });
    });

    it('terminates pagination if no new jobs are discovered', async () => {
      const searchHtml = `<!DOCTYPE html>
      <html><body><a href="/jobs/301/test/job">Test Job</a></body></html>`;

      let callCount = 0;
      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/sitemap.xml') {
            return Promise.resolve(new Response('', { status: 404 }));
          }
          if (url.pathname === '/jobs/search') {
            callCount++;
            return Promise.resolve(
              new Response(searchHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          if (url.pathname.includes('/jobs/')) {
            return Promise.resolve(
              new Response('<html><body><h1>Job</h1></body></html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      await provider.fetch({
        request: {
          query: 'Job',
          location: null,
          remoteOnly: false,
          limit: 100,
        },
        target: 'https://careers.example.com/jobs/search',
        fixturePath: null,
        configuration: {
          portalUrl: 'https://careers.example.com',
          variant: 'icims_hosted_v1',
        },
      });

      expect(callCount).toBeLessThan(3);
    });

    it('limits validation on zero-results pages', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VITEST', 'false');

      const zeroResultsHtml = `<html><body><div class="iCIMS_Message">No jobs found matching your criteria.</div></body></html>`;

      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/sitemap.xml') {
            return Promise.resolve(new Response('', { status: 404 }));
          }
          if (url.pathname === '/jobs/search') {
            return Promise.resolve(
              new Response(zeroResultsHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      const result = await provider.validateConfiguration({
        portalUrl: 'https://careers.example.com',
        variant: 'icims_hosted_v1',
      });

      expect(result.valid).toBe(true);
      expect(result.preview?.jobCount).toBe(0);
    });

    it('handles location normalization cases (encoded location vs UNAVAILABLE)', async () => {
      const detailHtml = `<!DOCTYPE html>
      <html>
      <body>
        <h1 class="iCIMS_Header">Job 1</h1>
        <div class="iCIMS_JobHeaderTable">Location: US-IL-Chicago</div>
      </body>
      </html>`;

      const detailHtmlUnavailable = `<!DOCTYPE html>
      <html>
      <body>
        <h1 class="iCIMS_Header">Job 2</h1>
        <div class="iCIMS_JobHeaderTable">Location: UNAVAILABLE</div>
      </body>
      </html>`;

      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/sitemap.xml') {
            return Promise.resolve(new Response('', { status: 404 }));
          }
          if (url.pathname === '/jobs/search') {
            return Promise.resolve(
              new Response(
                `<html><body><a href="/jobs/401/j1/job">J1</a><a href="/jobs/402/j2/job">J2</a></body></html>`,
                { status: 200, headers: { 'Content-Type': 'text/html' } },
              ),
            );
          }
          if (url.pathname.includes('/401')) {
            return Promise.resolve(
              new Response(detailHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          if (url.pathname.includes('/402')) {
            return Promise.resolve(
              new Response(detailHtmlUnavailable, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              }),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      const fetchResult = await provider.fetch({
        request: { query: '', location: null, remoteOnly: false, limit: 10 },
        target: 'https://careers.example.com/jobs/search',
        fixturePath: null,
        configuration: {
          portalUrl: 'https://careers.example.com',
          variant: 'icims_hosted_v1',
        },
      });

      expect(fetchResult.records).toHaveLength(2);
      expect(
        provider.normalize(fetchResult.records[0], discoveredAt),
      ).toMatchObject({
        location: 'Chicago, IL, US',
      });
      expect(
        provider.normalize(fetchResult.records[1], discoveredAt),
      ).toMatchObject({
        location: null,
      });
    });

    it('discovers jobs via hosted v2 json=true endpoint', async () => {
      const v2Response = {
        jobs: [
          {
            slug: '501',
            req_id: '501',
            title: 'Staff Engineer',
            canonical_url: 'https://careers.example.com/jobs/501',
          },
        ],
      };

      const provider = new IcimsProvider(
        providerTestClient((url) => {
          if (url.pathname === '/jobs/search') {
            return Promise.resolve(
              new Response(JSON.stringify(v2Response), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          }
          if (url.pathname.includes('/501')) {
            return Promise.resolve(
              new Response(
                '<html><body><h1>Staff Engineer</h1></body></html>',
                { status: 200, headers: { 'Content-Type': 'text/html' } },
              ),
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      const fetchResult = await provider.fetch({
        request: { query: '', location: null, remoteOnly: false, limit: 10 },
        target: 'https://careers.example.com/jobs/search',
        fixturePath: null,
        configuration: {
          portalUrl: 'https://careers.example.com',
          variant: 'icims_hosted_v2',
        },
      });

      expect(fetchResult.records).toHaveLength(1);
      expect(fetchResult.records[0]).toMatchObject({
        title: 'Staff Engineer',
      });
    });
  });

  describe('ATS Detection iCIMS Variant Classification', () => {
    it('detects Starr as supported icims_hosted_v1', async () => {
      const result = await detectAts(
        'https://careers-starr.icims.com/jobs/intro',
        {
          fetchPublic: (url) => {
            if (url.toString().includes('/sitemap.xml')) {
              return Promise.resolve(
                htmlResponse(url.toString(), '<urlset></urlset>'),
              );
            }
            return Promise.resolve(
              htmlResponse(
                url.toString(),
                '<html><body><a href="/jobs/search">Search</a></body></html>',
              ),
            );
          },
        },
      );

      expect(result).toMatchObject({
        detectedPlatform: 'iCIMS',
        suggestedProvider: 'icims',
        supportState: 'supported',
        variant: 'icims_hosted_v1',
      });
    });

    it('detects modern Jibe via /api/jobs probe success', async () => {
      const result = await detectAts('https://careers.example.com', {
        fetchPublic: (url) => {
          const uStr = url.toString();
          if (uStr.includes('/api/jobs')) {
            return Promise.resolve({
              url: uStr,
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: new TextEncoder().encode(JSON.stringify({ jobs: [] })),
              text: () => JSON.stringify({ jobs: [] }),
            });
          }
          return Promise.resolve(
            htmlResponse(uStr, '<html><body>icims</body></html>'),
          );
        },
      });

      expect(result).toMatchObject({
        detectedPlatform: 'iCIMS',
        suggestedProvider: 'icims',
        variant: 'jibe_json',
      });
    });

    it('detects internal-* hosted v2 variants', async () => {
      const result = await detectAts('https://internal-example.icims.com', {
        fetchPublic: (url) => {
          return Promise.resolve(
            htmlResponse(url.toString(), '<html><body>icims</body></html>'),
          );
        },
      });

      expect(result).toMatchObject({
        detectedPlatform: 'iCIMS',
        suggestedProvider: 'icims',
        variant: 'icims_hosted_v2',
      });
    });
  });
});
