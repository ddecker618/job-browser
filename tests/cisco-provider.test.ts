import { afterEach, describe, expect, it, vi } from 'vitest';

import { CiscoProvider } from '../src/providers/cisco.provider.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;

afterEach(() => vi.unstubAllGlobals());

describe('CiscoProvider', () => {
  it('has correct metadata', () => {
    const provider = new CiscoProvider();
    expect(provider.id).toBe('cisco');
    expect(provider.name).toBe('Cisco Careers');
    expect(provider.type).toBe('ats');
    expect(provider.capabilities).toMatchObject({
      keywordSearch: true,
      locationSearch: true,
      remoteFilter: true,
      pagination: true,
      compensation: true,
    });
  });

  it('succeeds validation with empty configuration', async () => {
    const provider = new CiscoProvider();
    const result = await provider.validateConfiguration({});
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Cisco Careers configuration is valid');
  });

  it('succeeds validation with custom overrides', async () => {
    const provider = new CiscoProvider();
    const result = await provider.validateConfiguration({
      company: 'Custom Company',
    });
    expect(result.valid).toBe(true);
  });

  it('builds search target with hardcoded Workday config', async () => {
    const provider = new CiscoProvider();
    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration: {},
    });
    const url = new URL(search.target);
    expect(url.origin).toBe('https://cisco.wd5.myworkdayjobs.com');
    expect(url.pathname).toBe('/wday/cxs/cisco/Cisco_Careers/jobs');
    expect(url.searchParams.get('_tenant')).toBe('cisco');
    expect(url.searchParams.get('_site')).toBe('Cisco_Careers');
    expect(url.searchParams.get('_company')).toBe('Cisco');
  });

  it('fetches and normalizes fixture data', async () => {
    const provider = new CiscoProvider();
    const jobs = await provider.fetch(
      await provider.search(request, { fixtureOnly: true, configuration: {} }),
    );
    expect(jobs.records.length).toBeGreaterThanOrEqual(1);
    const normalized = provider.validate(
      provider.normalize(jobs.records[0], '2026-07-18T12:00:00.000Z'),
    );
    expect(normalized).toMatchObject({
      sourceType: 'cisco',
      sourceName: 'Cisco Careers',
      company: 'Cisco',
      remoteType: 'remote',
      employmentType: 'full-time',
    });
    expect(normalized.externalId).toBeDefined();
    expect(normalized.title).toBeDefined();
    expect(normalized.postingUrl).toBeDefined();
  });
});
