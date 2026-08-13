import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startBackend, type BackendHandle } from '../src/server/backend.js';
import type { OutcomeAnalytics } from '../src/models/outcome-analytics.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('outcome analytics API', () => {
  it('returns auditable zero-sample metadata for an empty cohort', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-outcomes-api-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);
    const query = new URLSearchParams({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-02-01T00:00:00.000Z',
    });
    const response = await fetch(
      `${handle.url}/api/analytics/application-outcomes?${query.toString()}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as OutcomeAnalytics;
    expect(body).toMatchObject({
      definition: 'application-outcomes-v1',
      definitionVersion: 1,
      scope: 'installation-local',
      applications: { cohortSize: 0 },
    });
    expect(body.sourceDataWatermark).toMatch(/^[a-f0-9]{64}$/);
    expect(body.applications.everReached[0]).toMatchObject({
      numerator: 0,
      denominator: 0,
      sampleSize: 0,
      rate: null,
    });
  });
});
