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
    rmSync(directory, { recursive: true, force: true });
});

describe('job search API', () => {
  it('returns a typed page without changing the legacy jobs route', async () => {
    const handle = await backend();
    const search = await fetch(`${handle.url}/api/jobs/search?pageSize=10`);
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      items: unknown[];
      total: number;
    };
    expect(searchBody).toMatchObject({
      page: 1,
      pageSize: 10,
    });
    const legacy = await fetch(`${handle.url}/api/jobs`);
    expect(legacy.status).toBe(200);
    const legacyBody = (await legacy.json()) as unknown[];
    expect(searchBody.total).toBe(legacyBody.length);
    expect(searchBody.items).toHaveLength(legacyBody.length);
  });

  it.each([
    'page=0',
    'pageSize=101',
    'pageSize=ten',
    'minScore=101',
    'minSalary=-1',
    'minScore=80&maxScore=20',
    'status=unknown',
    'newlyDiscovered=1',
    'firstDiscoveredFrom=yesterday',
    'sort=raw_sql',
    'unknown=value',
  ])('returns 400 for invalid query %s', async (query) => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/jobs/search?${query}`);
    expect(response.status).toBe(400);
  });

  async function backend(): Promise<BackendHandle> {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-search-api-'));
    directories.push(directory);
    const handle = await startBackend({
      databasePath: join(directory, 'jobs.sqlite'),
    });
    handles.push(handle);
    return handle;
  }
});
