import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startBackend, type BackendHandle } from '../src/server/backend.js';

const directories: string[] = [];
const handles: BackendHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('backend lifecycle', () => {
  it('initializes a first-run database, applies migrations, and stops cleanly', async () => {
    const directory = temporary();
    const handle = await backend(directory);
    handles.push(handle);
    expect(handle.pendingMigrations).toContain('005_resume_parsing_error.sql');
    expect((await fetch(`${handle.url}/api/health`)).ok).toBe(true);
    await handle.stop();
    handles.length = 0;
    expect(handle.database.open).toBe(false);
  });

  it('preserves existing database records and avoids conventional-port collisions', async () => {
    const directory = temporary();
    const databasePath = join(directory, 'jobs.sqlite');
    const first = await backend(directory, databasePath);
    first.database.exec(
      "CREATE TABLE preservation_marker (value TEXT); INSERT INTO preservation_marker VALUES ('kept')",
    );
    await first.stop();

    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen(4173, '127.0.0.1', resolve),
    );
    try {
      const second = await backend(directory, databasePath);
      handles.push(second);
      expect(new URL(second.url).port).not.toBe('4173');
      expect(
        second.database
          .prepare<
            [],
            { value: string }
          >('SELECT value FROM preservation_marker')
          .get()?.value,
      ).toBe('kept');
    } finally {
      occupied.close();
    }
  });
});

async function backend(
  directory: string,
  databasePath = join(directory, 'jobs.sqlite'),
) {
  return startBackend({
    databasePath,
    backupDirectory: join(directory, 'backups'),
    candidateProfilePath: join(
      process.cwd(),
      'config',
      'candidate-profile.json',
    ),
    scoringConfigPath: join(process.cwd(), 'config', 'scoring-config.json'),
    resumeDirectory: join(directory, 'resumes'),
    clientDirectory: join(process.cwd(), 'dist', 'client'),
    host: '127.0.0.1',
    port: 0,
  });
}

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-backend-'));
  directories.push(directory);
  return directory;
}
