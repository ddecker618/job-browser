import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadJsonFixture(fixturePath: string): unknown {
  const absolutePath = resolve(fixturePath);
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load JSON fixture at ${absolutePath}: ${message}`,
      {
        cause: error,
      },
    );
  }
}
