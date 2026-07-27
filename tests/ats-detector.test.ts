import { describe, expect, it } from 'vitest';

import { detectAts } from '../src/domain/atsDetector.js';
import type { PublicFetchResponse } from '../src/security/boundedPublicFetch.js';

function response(url: string, html = ''): PublicFetchResponse {
  return {
    url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: new TextEncoder().encode(html),
    text: () => html,
  };
}

describe('ATS detector', () => {
  it.each([
    [
      'https://boards.greenhouse.io/acme/jobs/1',
      'Greenhouse',
      'greenhouse',
      { boardToken: 'acme' },
    ],
    ['https://jobs.lever.co/acme/1', 'Lever', 'lever', { site: 'acme' }],
    ['https://jobs.ashbyhq.com/acme', 'Ashby', 'ashby', { boardName: 'acme' }],
    [
      'https://acme.bamboohr.com/careers',
      'BambooHR',
      'bamboohr',
      { companyDomain: 'acme' },
    ],
    [
      'https://acme.recruitee.com/o/security',
      'Recruitee',
      'recruitee',
      { origin: 'https://acme.recruitee.com', company: 'acme' },
    ],
    [
      'https://jobs.smartrecruiters.com/Acme/job',
      'SmartRecruiters',
      'smartrecruiters',
      { companyIdentifier: 'Acme' },
    ],
  ] as const)(
    'extracts supported configuration from %s',
    async (url, platform, provider, configuration) => {
      await expect(
        detectAts(url, {
          fetchPublic: (value) => Promise.resolve(response(String(value))),
        }),
      ).resolves.toMatchObject({
        detectedPlatform: platform,
        suggestedProvider: provider,
        extractedConfiguration: configuration,
        supportState: 'supported',
      });
    },
  );

  it('uses the final redirect URL and never executes inspected scripts', async () => {
    delete (globalThis as Record<string, unknown>)['detectorScriptRan'];
    const result = await detectAts('https://careers.example.com', {
      fetchPublic: () =>
        Promise.resolve(
          response(
            'https://jobs.ashbyhq.com/example',
            '<script>globalThis.detectorScriptRan=true</script>',
          ),
        ),
    });
    expect(result).toMatchObject({
      detectedPlatform: 'Ashby',
      resolvedUrl: 'https://jobs.ashbyhq.com/example',
    });
    expect(globalThis).not.toHaveProperty('detectorScriptRan');
  });

  it('reports supported iCIMS and offers structured fallback for unsupported platforms', async () => {
    const icims = await detectAts('https://careers-acme.icims.com/jobs/1', {
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
        return Promise.resolve(response(String(value)));
      },
    });
    expect(icims).toMatchObject({
      detectedPlatform: 'iCIMS',
      supportState: 'supported',
      suggestedProvider: 'icims',
      extractedConfiguration: {
        portalUrl: 'https://careers-acme.icims.com',
        company: 'acme',
      },
    });
    const fallback = await detectAts('https://jobs.jobvite.com/acme', {
      fetchPublic: (value) =>
        Promise.resolve(
          response(
            String(value),
            '<script type="application/ld+json">{"@type":"JobPosting"}</script>',
          ),
        ),
    });
    expect(fallback).toMatchObject({
      detectedPlatform: 'Jobvite',
      supportState: 'detected-but-unsupported',
      suggestedProvider: 'structured-data',
      structuredFallback: true,
      extractedConfiguration: null,
      fallbackConfiguration: { url: 'https://jobs.jobvite.com/acme' },
    });
  });

  it('recognizes SmartRecruiters careers pages and exact BambooHR domains', async () => {
    await expect(
      detectAts('https://careers.smartrecruiters.com/Acme/jobs', {
        fetchPublic: (value) => Promise.resolve(response(String(value))),
      }),
    ).resolves.toMatchObject({
      suggestedProvider: 'smartrecruiters',
      extractedConfiguration: { companyIdentifier: 'Acme' },
    });
    const nested = await detectAts('https://foo.bar.bamboohr.com/careers', {
      fetchPublic: (value) => Promise.resolve(response(String(value))),
    });
    expect(nested.suggestedProvider).not.toBe('bamboohr');
  });

  it('extracts Teamtailor RSS and Recruitee API evidence on custom domains', async () => {
    const teamtailor = await detectAts('https://careers.acme.example/jobs', {
      fetchPublic: (value) =>
        Promise.resolve(
          response(
            String(value),
            '<meta name="generator" content="Teamtailor"><link rel="alternate" type="application/rss+xml" href="/jobs.rss">',
          ),
        ),
    });
    expect(teamtailor).toMatchObject({
      suggestedProvider: 'teamtailor',
      extractedConfiguration: {
        feedUrl: 'https://careers.acme.example/jobs.rss',
        company: 'acme',
      },
    });
    const recruitee = await detectAts('https://careers.acme.example/jobs', {
      fetchPublic: (value) =>
        Promise.resolve(
          response(
            String(value),
            '<meta name="generator" content="Recruitee"><link href="/api/offers/">',
          ),
        ),
    });
    expect(recruitee).toMatchObject({
      suggestedProvider: 'recruitee',
      extractedConfiguration: { origin: 'https://careers.acme.example' },
    });
  });
});
