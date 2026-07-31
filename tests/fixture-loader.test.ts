import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadJsonFixture } from '../src/utils/fixtureLoader.js';

describe('fixture loader', () => {
  it('loads JSON fixtures from disk', () => {
    const fixturePath = fileURLToPath(
      new URL(
        '../src/fixtures/smartrecruiters-search-response.json',
        import.meta.url,
      ),
    );
    const fixture = loadJsonFixture(fixturePath);

    expect(fixture).toEqual(
      expect.objectContaining({
        content: expect.any(Array) as unknown[],
      }),
    );
  });

  it('reports the fixture path when loading fails', () => {
    expect(() => loadJsonFixture('missing-provider-fixture.json')).toThrow(
      'missing-provider-fixture.json',
    );
  });
});
