import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PERSONAL_MARKERS: readonly RegExp[] = [
  /C:[\\/]Users[\\/]/i,
  /AppData[\\/]Roaming/i,
  /AppData[\\/]Local/i,
  /\bdustin\b/i,
  /\bdusti\b/i,
  /\bdecker\b/i,
  /[\w.+-]+@(gmail|outlook|yahoo|hotmail|icloud|protonmail|proton\.me|pm\.me|aol|comcast|verizon)\./i,
];

export function scanText(content: string): string[] {
  const markers: string[] = [];
  for (const pattern of PERSONAL_MARKERS) {
    if (pattern.test(content)) markers.push(pattern.toString());
  }
  return markers;
}

export function walkFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else result.push(full);
    }
  }
  return result;
}

export function scanDirectory(root: string): string[] {
  const hits: string[] = [];
  for (const file of walkFiles(root)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      content = '';
    }
    for (const marker of scanText(content)) hits.push(`${file}: ${marker}`);
    const relativeName = file.slice(root.length).replace(/^[\\/]/, '');
    for (const pattern of PERSONAL_MARKERS) {
      if (pattern.test(relativeName))
        hits.push(`${file}: filename matches ${pattern.toString()}`);
    }
  }
  return hits;
}
