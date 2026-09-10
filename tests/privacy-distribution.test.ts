import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scanDirectory, scanText } from './helpers/privacy-markers.js';

const FORBIDDEN_PERSONAL_FILE_TYPES =
  /\.(sqlite|sqlite-shm|sqlite-wal|db|docx|doc|pdf|xlsx|pptx|p12|pfx|pem)$/i;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

describe('distribution privacy', () => {
  it('contains no personal-data markers in tracked repository files', () => {
    const hits: string[] = [];
    for (const file of trackedFiles()) {
      if (!existsSync(file)) continue;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const marker of scanText(content)) hits.push(`${file}: ${marker}`);
    }
    expect(hits).toEqual([]);
  });

  it('contains no personal-data markers in compiled output', () => {
    const distRoot = resolve(process.cwd(), 'dist');
    if (!existsSync(distRoot)) return;
    expect(scanDirectory(distRoot)).toEqual([]);
  }, 30_000);

  const appAsarPath = resolve(
    process.cwd(),
    'release',
    'win-unpacked',
    'resources',
    'app.asar',
  );

  it.skipIf(!existsSync(appAsarPath))(
    'contains no personal data or personal file types inside the packaged app.asar',
    async () => {
      const { extractAll } = await import('@electron/asar');
      const extractDir = mkdtempSync(join(tmpdir(), 'job-browser-asar-'));
      try {
        extractAll(appAsarPath, extractDir);
        const hits = scanDirectory(extractDir).filter(
          (hit) => !/[/\\]node_modules[/\\]/.test(hit),
        );
        expect(hits).toEqual([]);

        const forbidden: string[] = [];
        const stack = [extractDir];
        while (stack.length > 0) {
          const current = stack.pop()!;
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (FORBIDDEN_PERSONAL_FILE_TYPES.test(full))
              forbidden.push(full);
          }
        }
        expect(forbidden).toEqual([]);
      } finally {
        rmSync(extractDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
