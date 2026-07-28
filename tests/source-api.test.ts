import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConfiguredSource } from '../src/models/source-management.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('source management API', () => {
  it('seeds public and browser starter sources', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-default-sources-'),
    );
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
      seedDefaultSources: true,
    });
    handles.push(handle);

    const control = (await fetch(
      `${handle.url}/api/sources/control-center`,
    ).then((response) => response.json())) as {
      sources: {
        id: string;
        providerId: string | null;
        enabled: boolean;
        configurationStatus: string;
      }[];
    };

    expect(control.sources.map((source) => source.providerId)).toEqual(
      expect.arrayContaining([
        'remote-ok',
        'builtin',
        'wellfound',
        'ziprecruiter',
        'dice',
        'indeed',
      ]),
    );
    expect(control.sources).toHaveLength(6);
    expect(
      control.sources
        .filter((source) => source.enabled)
        .map((source) => source.providerId),
    ).toEqual(expect.arrayContaining(['remote-ok', 'builtin']));
    expect(
      control.sources.every((source) => source.configurationStatus === 'valid'),
    ).toBe(true);
  });

  it('lists provider capabilities and creates a validated disabled source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-source-api-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);
    const providers = (await fetch(`${handle.url}/api/providers`).then(
      (response) => response.json(),
    )) as { id: string }[];
    expect(providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining([
        'remote-ok',
        'greenhouse',
        'lever',
        'ashby',
        'workday',
        'smartrecruiters',
        'bamboohr',
        'recruitee',
        'teamtailor',
        'usajobs',
        'structured-data',
        'builtin',
        'linkedin',
        'dice',
        'wellfound',
        'ziprecruiter',
      ]),
    );
    expect(providers.every((provider) => 'supportState' in provider)).toBe(
      true,
    );
    const created = await fetch(`${handle.url}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Example Ashby',
        employer: 'Example',
        providerId: 'ashby',
        careersUrl: 'https://jobs.ashbyhq.com/example',
        configuration: { boardName: 'example', company: 'Example' },
        searchCriteria: {
          query: 'security',
          location: null,
          remoteOnly: false,
          limit: 50,
        },
        enabled: false,
        schedule: { enabled: false, cadence: 'manual', dailyLocalTime: null },
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      providerId: 'ashby',
      configurationStatus: 'valid',
    });
    const control = (await fetch(
      `${handle.url}/api/sources/control-center`,
    ).then((response) => response.json())) as {
      summary: { disabledSources: number };
    };
    expect(control.summary.disabledSources).toBe(1);
  });

  it('rejects cross-origin source mutations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-source-origin-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);
    const response = await fetch(`${handle.url}/api/discovery/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ schedulerEnabled: true }),
    });
    expect(response.status).toBe(403);
  });

  it('returns an ATS suggestion without creating or enabling a source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-detection-api-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
      atsDetector: (url) =>
        Promise.resolve({
          detectedPlatform: 'BambooHR',
          confidence: 0.99,
          confidenceLabel: 'high',
          supportState: 'supported',
          suggestedProvider: 'bamboohr',
          extractedConfiguration: { companyDomain: 'acme' },
          structuredFallback: false,
          explanation: 'Confirm before creating a source.',
          resolvedUrl: url,
        }),
    });
    handles.push(handle);
    const detection = await fetch(`${handle.url}/api/sources/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://acme.bamboohr.com/careers' }),
    });
    expect(detection.status).toBe(200);
    expect(await detection.json()).toMatchObject({
      suggestedProvider: 'bamboohr',
      supportState: 'supported',
    });
    const control = (await fetch(
      `${handle.url}/api/sources/control-center`,
    ).then((response) => response.json())) as {
      sources: { providerId: string | null }[];
    };
    expect(
      control.sources.some((source) => source.providerId === 'bamboohr'),
    ).toBe(false);
  });

  it('handles source scheduling lifecycle correctly (create, update daily, update manual)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-schedule-api-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);

    // 1. Create a daily scheduled source
    const createRes = await fetch(`${handle.url}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Daily Scheduled Source',
        employer: 'Daily Employer',
        providerId: 'ashby',
        careersUrl: 'https://jobs.ashbyhq.com/example',
        configuration: { boardName: 'example' },
        searchCriteria: {
          query: 'security',
          location: null,
          remoteOnly: false,
          limit: 25,
        },
        enabled: true,
        schedule: {
          enabled: true,
          cadence: 'daily',
          dailyLocalTime: '09:00',
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const createdSource = (await createRes.json()) as ConfiguredSource;
    expect(createdSource.schedule.enabled).toBe(true);
    expect(createdSource.schedule.cadence).toBe('daily');
    expect(createdSource.schedule.dailyLocalTime).toBe('09:00');
    expect(createdSource.schedule.nextRunAt).not.toBeNull();

    // 2. Fetch it and verify nextRunAt is returned
    const getRes = await fetch(`${handle.url}/api/sources/control-center`);
    expect(getRes.status).toBe(200);
    const data = (await getRes.json()) as { sources: ConfiguredSource[] };
    const dailySource = data.sources.find((s) => s.id === createdSource.id);
    expect(dailySource).toBeDefined();
    if (dailySource !== undefined) {
      expect(dailySource.schedule.enabled).toBe(true);
      expect(dailySource.schedule.cadence).toBe('daily');
      expect(dailySource.schedule.dailyLocalTime).toBe('09:00');
      expect(dailySource.schedule.nextRunAt).not.toBeNull();
    }

    // 3. Update the source back to manual
    const updateRes = await fetch(
      `${handle.url}/api/sources/${createdSource.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Daily Scheduled Source',
          employer: 'Daily Employer',
          providerId: 'ashby',
          careersUrl: 'https://jobs.ashbyhq.com/example',
          configuration: { boardName: 'example' },
          searchCriteria: {
            query: 'security',
            location: null,
            remoteOnly: false,
            limit: 25,
          },
          enabled: true,
          schedule: {
            enabled: false,
            cadence: 'manual',
            dailyLocalTime: null,
          },
        }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updatedSource = (await updateRes.json()) as ConfiguredSource;
    expect(updatedSource.schedule.enabled).toBe(false);
    expect(updatedSource.schedule.cadence).toBe('manual');
    expect(updatedSource.schedule.nextRunAt).toBeNull();
  });
});
