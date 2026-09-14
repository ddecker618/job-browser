import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startBackend, type BackendHandle } from '../src/server/backend.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
});

describe('PUT /api/scheduler-control', () => {
  it('flips schedulerEnabled without touching employerDiscoveryEnabled', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-scheduler-control-'),
    );
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);

    // Establish an explicit employer-discovery opt-out.
    const initialPut = await fetch(`${handle.url}/api/discovery/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schedulerEnabled: true,
        employerDiscoveryEnabled: false,
      }),
    });
    expect(initialPut.status).toBe(200);

    // Toggle the scheduler; the employer-discovery opt-out must survive.
    const toggle = await fetch(`${handle.url}/api/scheduler-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedulerEnabled: false }),
    });
    expect(toggle.status).toBe(200);
    const toggleBody = (await toggle.json()) as {
      schedulerEnabled: boolean;
      employerDiscoveryEnabled: boolean;
    };
    expect(toggleBody.schedulerEnabled).toBe(false);
    expect(toggleBody.employerDiscoveryEnabled).toBe(false);

    // The discovery control endpoint should agree.
    const summary = await fetch(`${handle.url}/api/sources/control-center`);
    expect(summary.status).toBe(200);
    const summaryBody = (await summary.json()) as {
      schedulerEnabled: boolean;
      employerDiscoveryEnabled: boolean;
    };
    expect(summaryBody.schedulerEnabled).toBe(false);
    expect(summaryBody.employerDiscoveryEnabled).toBe(false);
  });

  it('rejects a body without schedulerEnabled with 400', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-scheduler-control-'),
    );
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);

    const response = await fetch(`${handle.url}/api/scheduler-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('rejects extra fields with 400 (strict body)', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-scheduler-control-'),
    );
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);

    const response = await fetch(`${handle.url}/api/scheduler-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schedulerEnabled: false,
        employerDiscoveryEnabled: false,
      }),
    });
    expect(response.status).toBe(400);
  });
});
