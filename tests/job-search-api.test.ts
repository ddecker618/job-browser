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
    'scope=everything',
    'unknown=value',
  ])('returns 400 for invalid query %s', async (query) => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/jobs/search?${query}`);
    expect(response.status).toBe(400);
  });

  it('reports the resolved scope and current score version on search responses', async () => {
    const handle = await backend();
    const all = await fetch(
      `${handle.url}/api/jobs/search?scope=all&pageSize=10`,
    );
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as {
      scope: string;
      currentScoreVersion: string | null;
    };
    expect(allBody.scope).toBe('all');
    expect(allBody.currentScoreVersion).toEqual(expect.any(String));

    const matches = await fetch(`${handle.url}/api/jobs/search?pageSize=10`);
    const matchesBody = (await matches.json()) as {
      scope: string;
      currentScoreVersion: string | null;
    };
    expect(matchesBody.scope).toBe('matches');
    expect(matchesBody.currentScoreVersion).toEqual(expect.any(String));
  });

  it('round-trips the remembered view scope through the API', async () => {
    const handle = await backend();
    expect(await readScope(handle)).toBe('matches');

    const put = await fetch(`${handle.url}/api/view-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()) as { scope: string }).toEqual({ scope: 'all' });
    expect(await readScope(handle)).toBe('all');

    const invalid = await fetch(`${handle.url}/api/view-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'everything' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('records scope on new saved filters and keeps legacy filters scope-free', async () => {
    const handle = await backend();
    const saved = await fetch(`${handle.url}/api/saved-filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Remote security',
        scope: 'all',
        filters: { remoteType: 'remote' },
      }),
    });
    expect(saved.status).toBe(201);
    const created = (await saved.json()) as {
      scope: string | null;
      filters: Record<string, unknown>;
    };
    expect(created.scope).toBe('all');
    expect(created.filters).toEqual({ remoteType: 'remote' });

    const legacy = await fetch(`${handle.url}/api/saved-filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Legacy filter',
        filters: { company: 'Acme' },
      }),
    });
    expect(legacy.status).toBe(201);
    expect(
      ((await legacy.json()) as { scope: string | null }).scope,
    ).toBeNull();

    const listed = await fetch(`${handle.url}/api/saved-filters`);
    const filters = (await listed.json()) as {
      name: string;
      scope: string | null;
      filters: Record<string, unknown>;
    }[];
    expect(filters).toHaveLength(2);
    expect(filters.find((filter) => filter.name === 'Remote security')).toEqual(
      {
        id: expect.any(String) as unknown,
        name: 'Remote security',
        scope: 'all',
        filters: { remoteType: 'remote' },
      },
    );
    expect(filters.find((filter) => filter.name === 'Legacy filter')).toEqual({
      id: expect.any(String) as unknown,
      name: 'Legacy filter',
      scope: null,
      filters: { company: 'Acme' },
    });
  });

  async function readScope(handle: BackendHandle): Promise<string> {
    const response = await fetch(`${handle.url}/api/view-scope`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { scope: string }).scope;
  }

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
