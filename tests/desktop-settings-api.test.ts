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

describe('desktop settings API', () => {
  it('defaults closeToTray to true when no value is persisted', async () => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/desktop-settings`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { closeToTray: boolean };
    expect(body.closeToTray).toBe(true);
  });

  it('round-trips closeToTray through PUT and GET', async () => {
    const handle = await backend();
    const putOff = await fetch(`${handle.url}/api/desktop-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closeToTray: false }),
    });
    expect(putOff.status).toBe(200);
    expect(
      ((await putOff.json()) as { closeToTray: boolean }).closeToTray,
    ).toBe(false);

    const getAfterOff = await fetch(`${handle.url}/api/desktop-settings`);
    expect(
      ((await getAfterOff.json()) as { closeToTray: boolean }).closeToTray,
    ).toBe(false);

    const putOn = await fetch(`${handle.url}/api/desktop-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closeToTray: true }),
    });
    expect(((await putOn.json()) as { closeToTray: boolean }).closeToTray).toBe(
      true,
    );
  });

  it('returns 400 when the body is not a boolean', async () => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/desktop-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closeToTray: 'yes' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when extra fields are present (strict body)', async () => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/desktop-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closeToTray: true, extra: true }),
    });
    expect(response.status).toBe(400);
  });

  it('reports the tray summary with scheduler state and attention counts', async () => {
    const handle = await backend();
    const response = await fetch(`${handle.url}/api/tray-summary`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schedulerEnabled: boolean;
      running: boolean;
      attentionSources: number;
      startupComplete: boolean;
    };
    expect(typeof body.schedulerEnabled).toBe('boolean');
    expect(typeof body.running).toBe('boolean');
    expect(typeof body.attentionSources).toBe('number');
    expect(body.startupComplete).toBe(true);
  });
});

async function backend(): Promise<BackendHandle> {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-desktop-api-'));
  directories.push(directory);
  const handle = await startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
  });
  handles.push(handle);
  return handle;
}
