import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startBackend, type BackendHandle } from '../src/server/backend.js';
import type { EmployerSeedImportResult } from '../src/models/employer.js';
import type { SourceControlCenter } from '../src/models/source-management.js';
import type { DiscoveryIntelligenceSummary } from '../src/models/employer-discovery-intelligence.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function startTestBackend(): Promise<BackendHandle> {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-employer-api-'));
  directories.push(directory);
  const handle = await startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
  });
  handles.push(handle);
  return handle;
}

describe('employer discovery API', () => {
  it('returns bounded validated Discovery Intelligence at an explicit timestamp', async () => {
    const handle = await startTestBackend();
    const response = await fetch(
      `${handle.url}/api/employer-discovery/intelligence?asOf=2026-08-12T12%3A00%3A00.000Z`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DiscoveryIntelligenceSummary;
    expect(body).toMatchObject({
      policyVersion: 'employer-discovery-intelligence-v1',
      evaluatedAt: '2026-08-12T12:00:00.000Z',
      activityWindow: { semantics: '[start,end)' },
      totals: { employers: 25, careerSites: 25 },
    });
    expect(body.sites.length).toBeLessThanOrEqual(100);
    expect(body.providers.length).toBeLessThanOrEqual(50);

    const invalid = await fetch(
      `${handle.url}/api/employer-discovery/intelligence?asOf=not-a-date`,
    );
    expect(invalid.status).toBe(400);
  });

  it('returns one site explanation and a bounded 404 for missing sites', async () => {
    const handle = await startTestBackend();
    const employers = (await fetch(`${handle.url}/api/employers`).then(
      (result) => result.json(),
    )) as { careerSites: { id: string }[] }[];
    const id = employers[0]!.careerSites[0]!.id;
    const response = await fetch(
      `${handle.url}/api/career-sites/${id}/intelligence?asOf=2026-08-12T12%3A00%3A00.000Z`,
    );
    expect(response.status).toBe(200);
    const decision = (await response.json()) as {
      careerSiteId: string;
      policyVersion: string;
      reasons: unknown[];
    };
    expect(decision).toMatchObject({
      careerSiteId: id,
      policyVersion: 'employer-discovery-intelligence-v1',
    });
    expect(Array.isArray(decision.reasons)).toBe(true);
    expect(
      (
        await fetch(
          `${handle.url}/api/career-sites/missing/intelligence?asOf=2026-08-12T12%3A00%3A00.000Z`,
        )
      ).status,
    ).toBe(404);
  });
  it('lists seeded employers with their career sites', async () => {
    const handle = await startTestBackend();
    const response = await fetch(`${handle.url}/api/employers`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      employer: { name: string };
      careerSites: { employerName: string }[];
    }[];

    expect(body).toHaveLength(25);
    const adobe = body.find((entry) => entry.employer.name === 'Adobe');
    expect(adobe?.careerSites[0]?.employerName).toBe('Adobe');
  });

  it('fetches a single employer with its career sites', async () => {
    const handle = await startTestBackend();
    const response = await fetch(`${handle.url}/api/employers`);
    const body = (await response.json()) as {
      employer: { id: string };
    }[];
    const employerId = body[0]!.employer.id;

    const detail = (await fetch(
      `${handle.url}/api/employers/${employerId}`,
    ).then((r) => r.json())) as {
      employer: { id: string };
      careerSites: unknown[];
    };

    expect(detail.employer.id).toBe(employerId);
    expect(detail.careerSites.length).toBeGreaterThanOrEqual(0);
  });

  it('creates an employer', async () => {
    const handle = await startTestBackend();
    const response = await fetch(`${handle.url}/api/employers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cyberdyne Systems', websiteUrl: null }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.name).toBe('Cyberdyne Systems');
  });

  it('adds a career site to an employer', async () => {
    const handle = await startTestBackend();
    const list = (await fetch(`${handle.url}/api/employers`).then((r) =>
      r.json(),
    )) as { employer: { id: string } }[];
    const employerId = list[0]!.employer.id;

    const response = await fetch(
      `${handle.url}/api/employers/${employerId}/career-sites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://jobs.lever.co/cyberdyne',
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      url: string;
      verificationState: string;
    };
    expect(body.url).toBe('https://jobs.lever.co/cyberdyne');
    expect(body.verificationState).toBe('unverified');
  });

  it('runs bounded discovery and retains an unknown ATS without creating a Source', async () => {
    const handle = await startTestBackend();
    const employers = (await fetch(`${handle.url}/api/employers`).then(
      (response) => response.json(),
    )) as { employer: { id: string } }[];
    const created = await fetch(
      `${handle.url}/api/employers/${employers[0]!.employer.id}/career-sites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://careers.example.invalid/jobs' }),
      },
    );
    const site = (await created.json()) as { id: string };

    const response = await fetch(
      `${handle.url}/api/career-sites/${site.id}/discover`,
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      counter: string;
      site: { discovery: { state: string; sourceId: string | null } };
    };
    expect(result).toMatchObject({
      counter: 'unsupported',
      site: { discovery: { state: 'unsupported', sourceId: null } },
    });
  });

  it('imports seeds idempotently and persists conservative automation settings', async () => {
    const handle = await startTestBackend();
    const seedBody = {
      seeds: [
        {
          name: 'Bounded Seed Employer',
          websiteUrl: null,
          careerSiteUrls: ['https://careers.example.invalid/jobs'],
          provenance: 'api-fixture',
        },
      ],
    };
    const first = (await fetch(`${handle.url}/api/employer-discovery/seeds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seedBody),
    }).then((response) => response.json())) as EmployerSeedImportResult;
    const second = (await fetch(`${handle.url}/api/employer-discovery/seeds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seedBody),
    }).then((response) => response.json())) as EmployerSeedImportResult;
    expect(first).toMatchObject({ employersCreated: 1, careerSitesCreated: 1 });
    expect(second).toMatchObject({ employersReused: 1, careerSitesReused: 1 });

    const defaults = (await fetch(
      `${handle.url}/api/sources/control-center`,
    ).then((response) => response.json())) as SourceControlCenter;
    expect(defaults).toMatchObject({
      schedulerEnabled: false,
      employerDiscoveryEnabled: false,
    });
    const saved = (await fetch(`${handle.url}/api/discovery/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schedulerEnabled: false,
        employerDiscoveryEnabled: true,
      }),
    }).then((response) => response.json())) as {
      schedulerEnabled: boolean;
      employerDiscoveryEnabled: boolean;
    };
    expect(saved).toEqual({
      schedulerEnabled: false,
      employerDiscoveryEnabled: true,
    });
  });

  it('verifies a career site and returns its fingerprint', async () => {
    const handle = await startTestBackend();
    const siteId = await createTestCareerSite(
      handle,
      'Verification Fixture',
      'https://boards.greenhouse.io/acme',
    );

    const response = await fetch(
      `${handle.url}/api/career-sites/${siteId}/verify`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      verificationState: string;
      fingerprint: { atsPlatform: string; atsDetectedProvider: string };
    };
    expect(body.verificationState).toBe('verified');
    expect(body.fingerprint.atsPlatform).toBe('Greenhouse');
    expect(body.fingerprint.atsDetectedProvider).toBe('greenhouse');
  });

  it('creates a discovery source from a verified career site', async () => {
    const handle = await startTestBackend();
    const siteId = await createTestCareerSite(
      handle,
      'Source Fixture',
      'https://boards.greenhouse.io/acme',
    );

    const verified = await fetch(
      `${handle.url}/api/career-sites/${siteId}/verify`,
      { method: 'POST' },
    );
    expect(verified.status).toBe(200);

    const response = await fetch(
      `${handle.url}/api/career-sites/${siteId}/source`,
      { method: 'POST' },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      providerId: string;
      configuration: Record<string, unknown>;
      careersUrl: string;
      enabled: boolean;
    };
    expect(body.providerId).toBe('greenhouse');
    expect(body.careersUrl).toBe('https://boards.greenhouse.io/acme');
    expect(body.configuration['boardToken']).toBe('acme');
    expect(body.enabled).toBe(false);
  });

  it('rejects creating a source for an unsupported career site', async () => {
    const handle = await startTestBackend();
    const siteId = await createTestCareerSite(
      handle,
      'Unsupported Fixture',
      'https://careers.example.invalid/jobs',
    );

    await fetch(`${handle.url}/api/career-sites/${siteId}/verify`, {
      method: 'POST',
    });

    const response = await fetch(
      `${handle.url}/api/career-sites/${siteId}/source`,
      { method: 'POST' },
    );

    expect(response.status).toBe(409);
  });

  it('rejects an invalid career site URL with a 400', async () => {
    const handle = await startTestBackend();
    const list = (await fetch(`${handle.url}/api/employers`).then((r) =>
      r.json(),
    )) as { employer: { id: string } }[];
    const employerId = list[0]!.employer.id;

    const response = await fetch(
      `${handle.url}/api/employers/${employerId}/career-sites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      },
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing employer', async () => {
    const handle = await startTestBackend();
    const response = await fetch(`${handle.url}/api/employers/does-not-exist`);

    expect(response.status).toBe(404);
  });
});

async function createTestCareerSite(
  handle: BackendHandle,
  employerName: string,
  url: string,
): Promise<string> {
  const employer = (await fetch(`${handle.url}/api/employers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: employerName, websiteUrl: null }),
  }).then((response) => response.json())) as { id: string };
  const site = (await fetch(
    `${handle.url}/api/employers/${employer.id}/career-sites`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    },
  ).then((response) => response.json())) as { id: string };
  return site.id;
}
