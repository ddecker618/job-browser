import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scanDirectory, scanText } from './helpers/privacy-markers.js';

const FORBIDDEN_PERSONAL_FILE_TYPES =
  /\.(sqlite|sqlite-shm|sqlite-wal|db|docx|doc|pdf|xlsx|pptx|p12|pfx|pem)$/i;

function readOwnerAttribution(): string {
  const parsedPackageJson: unknown = JSON.parse(
    readFileSync('package.json', 'utf8'),
  );
  if (
    typeof parsedPackageJson !== 'object' ||
    parsedPackageJson === null ||
    !('author' in parsedPackageJson) ||
    typeof parsedPackageJson.author !== 'string'
  ) {
    throw new Error('package.json must declare a string author attribution');
  }
  return parsedPackageJson.author;
}

const PUBLIC_OWNER_ATTRIBUTION = readOwnerAttribution();
const OWNER_ATTRIBUTION_FILES = new Set([
  'EULA.txt',
  'LICENSE.txt',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
]);

function normalizePath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

function contentForPrivacyScan(file: string, content: string): string {
  const normalized = normalizePath(file);
  if (normalized === 'THIRD_PARTY_NOTICES.md') return '';
  if (OWNER_ATTRIBUTION_FILES.has(normalized)) {
    return content.replaceAll(PUBLIC_OWNER_ATTRIBUTION, '');
  }
  return content;
}

function trackedFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const legalFiles = [...OWNER_ATTRIBUTION_FILES].filter((file) =>
    existsSync(file),
  );
  return [...new Set([...tracked, ...legalFiles])];
}

describe('distribution privacy', () => {
  it('publishes the owner name only in approved legal-attribution files', () => {
    const filesWithOwnerName = trackedFiles()
      .filter((file) =>
        readFileSync(file, 'utf8').includes(PUBLIC_OWNER_ATTRIBUTION),
      )
      .map(normalizePath)
      .sort();
    expect(filesWithOwnerName).toEqual([...OWNER_ATTRIBUTION_FILES].sort());
  });
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
      for (const marker of scanText(contentForPrivacyScan(file, content)))
        hits.push(`${file}: ${marker}`);
    }
    expect(hits).toEqual([]);
  });

  it('contains no personal-data markers in compiled output', () => {
    const distRoot = resolve(process.cwd(), 'dist');
    if (!existsSync(distRoot)) return;
    expect(
      scanDirectory(distRoot, (file, content) =>
        contentForPrivacyScan(relative(distRoot, file), content),
      ),
    ).toEqual([]);
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
        const hits = scanDirectory(extractDir, (file, content) =>
          contentForPrivacyScan(relative(extractDir, file), content),
        ).filter((hit) => !/[/\\]node_modules[/\\]/.test(hit));
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
