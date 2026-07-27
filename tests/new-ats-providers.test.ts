import { describe, expect, it, vi } from 'vitest';

import { BambooHrProvider } from '../src/providers/bambooHr.provider.js';
import { RecruiteeProvider } from '../src/providers/recruitee.provider.js';
import { SmartRecruitersProvider } from '../src/providers/smartRecruiters.provider.js';
import { TeamtailorProvider } from '../src/providers/teamtailor.provider.js';
import {
  ProviderHttpClient,
  type ProviderHttpTransport,
} from '../src/providers/providerHttpClient.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: false,
  limit: 20,
} as const;

describe('new public ATS providers', () => {
  it.each([
    [
      new SmartRecruitersProvider(),
      { companyIdentifier: 'FixtureCorp', company: 'Fixture Corp' },
      'Senior Security Engineer',
      'https://jobs.smartrecruiters.com/FixtureCorp/sec-101',
      1,
    ],
    [
      new BambooHrProvider(),
      { companyDomain: 'fixture', company: 'Fixture Bamboo' },
      'Cloud Security Analyst',
      'https://fixture.bamboohr.com/careers/101',
      1,
    ],
    [
      new RecruiteeProvider(),
      { origin: 'https://fixture.recruitee.com', company: 'Fixture Recruitee' },
      'Application Security Engineer',
      'https://fixture.recruitee.com/o/application-security-engineer',
      1,
    ],
    [
      new TeamtailorProvider(),
      {
        feedUrl: 'https://fixture.teamtailor.com/jobs.rss',
        company: 'Fixture Teamtailor',
      },
      'Security Operations Engineer',
      'https://fixture.teamtailor.com/jobs/tt-301-security-operations-engineer',
      1,
    ],
  ] as const)(
    'validates, fetches its deterministic fixture, rejects malformed records, and normalizes %s',
    async (provider, configuration, title, postingUrl, rejected) => {
      await expect(
        provider.validateConfiguration({ ...configuration, unexpected: true }),
      ).resolves.toMatchObject({ valid: false });
      const search = await provider.search(request, {
        fixtureOnly: true,
        configuration,
      });
      const result = await provider.fetch(search);
      expect(result).toMatchObject({ rejected, complete: true });
      expect(result.records).toHaveLength(1);
      expect(
        provider.validate(
          provider.normalize(result.records[0], '2026-07-19T12:00:00.000Z'),
        ),
      ).toMatchObject({ title, postingUrl });
    },
  );

  it('rejects unsafe or non-exact configuration', async () => {
    await expect(
      new BambooHrProvider().validateConfiguration({
        companyDomain: 'acme.bamboohr.com',
        company: 'Acme',
      }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      new RecruiteeProvider().validateConfiguration({
        origin: 'http://localhost:3000',
        company: 'Acme',
      }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      new TeamtailorProvider().validateConfiguration({
        feedUrl: 'http://acme.example/jobs.rss',
        company: 'Acme',
      }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('uses realistic SmartRecruiters list/detail shapes and the public posting id', async () => {
    const transport = vi.fn<ProviderHttpTransport>((_resolved, url) => {
      const payload = url.pathname.endsWith('/postings')
        ? {
            content: [
              {
                id: '744000091234567',
                uuid: 'internal-uuid-must-not-be-used',
                name: 'Senior Security Engineer',
                company: { identifier: 'Acme', name: 'Acme, Inc.' },
                location: {
                  city: 'Boston',
                  region: 'Massachusetts',
                  country: 'US',
                  remote: true,
                },
                releasedDate: '2026-07-17T12:00:00Z',
                typeOfEmployment: { label: 'Full-time' },
                postingUrl:
                  'https://jobs.smartrecruiters.com/Acme/744000091234567-senior-security-engineer',
              },
            ],
            totalFound: 1,
          }
        : {
            id: '744000091234567',
            uuid: 'internal-uuid-must-not-be-used',
            name: 'Senior Security Engineer',
            company: { identifier: 'Acme', name: 'Acme, Inc.' },
            location: { city: 'Boston', country: 'US', remote: true },
            jobAd: {
              sections: {
                jobDescription: { text: '<p>Protect production systems.</p>' },
                qualifications: { text: '<p>Five years of experience.</p>' },
              },
            },
            postingUrl:
              'https://jobs.smartrecruiters.com/Acme/744000091234567-senior-security-engineer',
            applyUrl:
              'https://jobs.smartrecruiters.com/Acme/744000091234567-senior-security-engineer/apply',
          };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    const provider = new SmartRecruitersProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { companyIdentifier: 'Acme' },
    });
    const result = await provider.fetch(search);
    expect(transport.mock.calls[1]?.[1].pathname).toBe(
      '/v1/companies/Acme/postings/744000091234567',
    );
    const normalized = provider.normalize(
      result.records[0],
      '2026-07-19T12:00:00.000Z',
    );
    expect(normalized).toMatchObject({
      company: 'Acme, Inc.',
      description: 'Protect production systems.',
      requirements: 'Five years of experience.',
      postingUrl:
        'https://jobs.smartrecruiters.com/Acme/744000091234567-senior-security-engineer',
      applicationUrls: [
        'https://jobs.smartrecruiters.com/Acme/744000091234567-senior-security-engineer/apply',
      ],
    });
  });

  it('parses BambooHR jobOpening details without retaining application fields', async () => {
    const list = {
      result: [
        {
          id: 101,
          jobOpeningName: 'Cloud Security Analyst',
          departmentLabel: 'Security',
          employmentStatusLabel: 'Full-Time',
          atsLocation: { city: 'Denver', state: 'Colorado', country: 'US' },
          isRemote: true,
          locationType: 'Remote',
          summary: '<p>List summary remains available.</p>',
          jobOpeningShareUrl: 'https://acme.bamboohr.com/careers/101',
        },
      ],
    };
    const detail = {
      result: {
        jobOpening: {
          ...list.result[0],
          description: '<p>Detailed cloud security work.</p>',
          datePosted: '2026-07-16T14:00:00Z',
          compensation: {
            minimum: 110000,
            maximum: 145000,
            currency: 'USD',
            interval: 'year',
          },
        },
        formFields: [
          { id: 'genderIdentity', value: 'must-not-be-stored' },
          { id: 'ethnicity', value: 'must-not-be-stored' },
        ],
      },
    };
    const transport = vi.fn<ProviderHttpTransport>((_resolved, url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(url.pathname.endsWith('/detail') ? detail : list),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const provider = new BambooHrProvider(client(transport));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { companyDomain: 'acme', company: 'Acme' },
    });
    const result = await provider.fetch(search);
    expect(result.records[0]).not.toHaveProperty('formFields');
    expect(JSON.stringify(result.records)).not.toContain('genderIdentity');
    expect(
      provider.normalize(result.records[0], '2026-07-19T12:00:00.000Z'),
    ).toMatchObject({
      location: 'Denver, Colorado, US',
      remoteType: 'remote',
      employmentType: 'full-time',
      department: 'Security',
      salaryMinimum: 110000,
      salaryMaximum: 145000,
      description: 'Detailed cloud security work.',
      postingUrl: 'https://acme.bamboohr.com/careers/101',
      applicationUrls: [],
    });
  });

  it('preserves the BambooHR list summary when detail retrieval fails', async () => {
    const transport = vi.fn<ProviderHttpTransport>((_resolved, url) =>
      Promise.resolve(
        url.pathname.endsWith('/detail')
          ? new Response('unavailable', { status: 500 })
          : new Response(
              JSON.stringify({
                result: [
                  {
                    id: 101,
                    jobOpeningName: 'Security Analyst',
                    summary: '<p>Summary from list.</p>',
                  },
                ],
              }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
      ),
    );
    const provider = new BambooHrProvider(client(transport));
    const result = await provider.fetch(
      await provider.search(request, {
        fixtureOnly: false,
        configuration: { companyDomain: 'acme', company: 'Acme' },
      }),
    );
    expect(
      provider.normalize(result.records[0], '2026-07-19T12:00:00.000Z')
        .description,
    ).toBe('Summary from list.');
  });
});

function client(transport: ProviderHttpTransport): ProviderHttpClient {
  return new ProviderHttpClient({
    timeoutMs: 1_000,
    maxRetries: 0,
    resolver: (url) => Promise.resolve({ pinned: url.hostname }),
    transport,
    writeLog: () => undefined,
  });
}
