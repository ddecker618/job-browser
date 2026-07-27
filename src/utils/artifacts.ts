import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function saveHtmlSnapshot(
  providerId: string,
  runId: string,
  html: string,
): string {
  const directory = resolve(
    process.cwd(),
    'artifacts',
    'providers',
    providerId,
  );
  const snapshotPath = resolve(directory, `${runId}.html`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(snapshotPath, html, 'utf8');
  return snapshotPath;
}
