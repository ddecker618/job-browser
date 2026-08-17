import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startBackend, type BackendHandle } from '../src/server/backend.js';
import { EMPLOYER_MANIFEST_VERSION } from '../src/models/employer-manifest.js';
import type { EmployerManifestImportResult } from '../src/models/employer-manifest.js';

const handles: BackendHandle[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function startTestBackend(): Promise<BackendHandle> {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-import-api-'));
  directories.push(directory);
  const handle = await startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
  });
  handles.push(handle);
  return handle;
}

async function employerCount(handle: BackendHandle): Promise<number> {
  const employers = (await fetch(`${handle.url}/api/employers`).then((result) =>
    result.json(),
  )) as unknown[];
  return employers.length;
}

async function importManifest(
  handle: BackendHandle,
  body: unknown,
): Promise<Response> {
  return fetch(`${handle.url}/api/employer-discovery/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('employer manifest import API', () => {
  it('imports a JSON manifest end to end', async () => {
    const handle = await startTestBackend();
    const before = await employerCount(handle);

    const response = await importManifest(handle, {
      format: 'json',
      contents: JSON.stringify({
        version: EMPLOYER_MANIFEST_VERSION,
        imports: [
          {
            employerName: 'Acme',
            careersUrl: 'https://boards.greenhouse.io/acme',
            provenance: 'api-test',
            enabled: true,
          },
        ],
      }),
      dryRun: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as EmployerManifestImportResult;
    expect(body).toMatchObject({
      version: EMPLOYER_MANIFEST_VERSION,
      dryRun: false,
      inputRows: 1,
      employersCreated: 1,
      careerSitesCreated: 1,
      sourcesCreated: 1,
      batchErrors: 0,
    });
    expect(body.rows[0]).toMatchObject({ status: 'created', index: 0 });

    expect(await employerCount(handle)).toBe(before + 1);
  });

  it('imports a CSV manifest end to end', async () => {
    const handle = await startTestBackend();
    const before = await employerCount(handle);

    const response = await importManifest(handle, {
      format: 'csv',
      contents: [
        'version,employerName,rootDomain,careersUrl,expectedAtsFamily,atsTenant,provenance,batchId,notes,enabled',
        `${EMPLOYER_MANIFEST_VERSION},Globex,,https://jobs.lever.co/globex,,,api-test,,,true`,
      ].join('\n'),
      dryRun: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as EmployerManifestImportResult;
    expect(body).toMatchObject({
      inputRows: 1,
      employersCreated: 1,
      sourcesCreated: 1,
      batchErrors: 0,
    });
    expect(await employerCount(handle)).toBe(before + 1);
  });

  it('performs no writes for a dry-run import', async () => {
    const handle = await startTestBackend();
    const before = await employerCount(handle);

    const response = await importManifest(handle, {
      format: 'json',
      contents: JSON.stringify({
        version: EMPLOYER_MANIFEST_VERSION,
        imports: [
          {
            employerName: 'Initech',
            careersUrl: 'https://boards.greenhouse.io/initech',
            provenance: 'api-test',
          },
        ],
      }),
      dryRun: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as EmployerManifestImportResult;
    expect(body).toMatchObject({ dryRun: true, employersCreated: 1 });
    expect(await employerCount(handle)).toBe(before);
  });

  it('rejects an invalid request body', async () => {
    const handle = await startTestBackend();
    const response = await importManifest(handle, {
      format: 'yaml',
      contents: 'nothing',
    });
    expect(response.status).toBe(400);
  });

  it('returns an error for an invalid manifest', async () => {
    const handle = await startTestBackend();
    const response = await importManifest(handle, {
      format: 'json',
      contents: JSON.stringify({ version: 'not-a-version', imports: [] }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});
