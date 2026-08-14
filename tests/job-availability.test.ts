import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  verifyJobAvailability,
  type AvailabilityFetcher,
} from '../src/intelligence/jobAvailability.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import {
  startBackend,
  type BackendHandle,
} from '../src/server/backend.js';
import { createJobFixture } from './helpers/job-fixture.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('verifyJobAvailability', () => {
  it('treats a missing posting URL as alive (unverifiable)', async () => {
    const outcome = await verifyJobAvailability(null);
    expect(outcome.available).toBe(true);
    expect(outcome.reason).toBe('alive');
  });

  it('reports a posting closed when the fetched page is closed', async () => {
    const fetcher: AvailabilityFetcher = () =>
      Promise.resolve({
        status: 200,
        text: 'Sorry, this position has been filled.',
      });
    const outcome = await verifyJobAvailability(
      'https://jobs.example.test/closed-job',
      fetcher,
    );
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBe('closed');
    expect(outcome.statusCode).toBe(200);
  });

  it('reports a posting alive when the fetched page is live', async () => {
    const fetcher: AvailabilityFetcher = () =>
      Promise.resolve({
        status: 200,
        text: 'Security Engineer - Remote. Apply now.',
      });
    const outcome = await verifyJobAvailability(
      'https://jobs.example.test/live-job',
      fetcher,
    );
    expect(outcome.available).toBe(true);
    expect(outcome.reason).toBe('alive');
  });

  it('reports unreachable when the fetch fails', async () => {
    const fetcher: AvailabilityFetcher = () =>
      Promise.reject(new Error('connection refused'));
    const outcome = await verifyJobAvailability(
      'https://jobs.example.test/refused',
      fetcher,
    );
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBe('unreachable');
    expect(outcome.statusCode).toBeNull();
  });
});

describe('job availability REST API', () => {
  it('removes and restores a current job through the availability endpoint', async () => {
    const fixture = await backend();
    const jobId = fixture.jobId;
    const url = `${fixture.handle.url}/api/jobs/${jobId}/availability`;

    let response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove' }),
    });
    expect(response.status).toBe(200);
    let body = (await response.json()) as {
      changed: boolean;
      job: { id: string; active: boolean; userRemoved: boolean };
    };
    expect(body.changed).toBe(true);
    expect(body.job).toMatchObject({ id: jobId, active: false, userRemoved: true });

    response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    });
    expect(response.status).toBe(200);
    body = (await response.json()) as {
      changed: boolean;
      job: { id: string; active: boolean; userRemoved: boolean };
    };
    expect(body.changed).toBe(true);
    expect(body.job).toMatchObject({ id: jobId, active: true, userRemoved: false });
  });

  it('rejects an unknown availability action', async () => {
    const fixture = await backend();
    const response = await fetch(
      `${fixture.handle.url}/api/jobs/${fixture.jobId}/availability`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'explode' }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing job', async () => {
    const fixture = await backend();
    const response = await fetch(
      `${fixture.handle.url}/api/jobs/does-not-exist/availability`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      },
    );
    expect(response.status).toBe(404);
  });

  it('does not mark a job inactive when verification is low-confidence (unreachable)', async () => {
    const fixture = await backend(
      () => {
        throw new Error('network timeout');
      },
    );
    const url = `${fixture.handle.url}/api/jobs/${fixture.jobId}/availability`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      job: { id: string; active: boolean; userRemoved: boolean };
      outcome: { reason: string; available: boolean };
    };
    expect(body.outcome.reason).toBe('unreachable');
    // Low-confidence failures never auto-remove the job.
    expect(body.job).toMatchObject({ id: fixture.jobId, active: true });
  });

  it('marks a job inactive when verification is definitively closed', async () => {
    const fixture = await backend(() =>
      Promise.resolve({ status: 200, text: 'This job is no longer available' }),
    );
    const url = `${fixture.handle.url}/api/jobs/${fixture.jobId}/availability`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      job: { id: string; active: boolean };
      outcome: { reason: string };
    };
    expect(body.outcome.reason).toBe('closed');
    expect(body.job).toMatchObject({ id: fixture.jobId, active: false });
  });
});

async function backend(
  availabilityFetcher?: AvailabilityFetcher,
): Promise<{
  handle: BackendHandle;
  jobId: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-availability-api-'));
  directories.push(directory);
  const handle = await startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
    resumeDirectory: join(directory, 'resumes'),
    clientDirectory: join(directory, 'client'),
    enableScheduler: false,
    apiRequestsPerMinute: 1_000,
    ...(availabilityFetcher === undefined
      ? {}
      : { availabilityFetcher }),
    logger: () => undefined,
  });
  handles.push(handle);

  const source = new SourceRepository(handle.database).create(
    {
      displayName: 'Availability Fixture Careers',
      employer: 'Availability Fixture Employer',
      providerId: 'availability-source-provider',
      careersUrl: 'https://careers.example.test',
      configuration: {},
      searchCriteria: {
        query: 'security',
        location: null,
        remoteOnly: false,
        limit: 5,
      },
      enabled: false,
      schedule: { enabled: false, cadence: 'manual', dailyLocalTime: null },
    },
    'valid',
  );
  const jobId = '20000000-0000-4000-8000-000000000101';
  const jobs = new JobRepository(handle.database);
  jobs.upsertObservation({
    job: createJobFixture({
      id: jobId,
      title: 'Availability API Security Engineer',
      normalizedTitle: 'availability api security engineer',
      status: 'new',
    }),
    sourceId: source.id,
    providerId: 'availability-observed-provider',
    rawData: createJobFixture({ id: jobId }),
  });
  return { handle, jobId };
}