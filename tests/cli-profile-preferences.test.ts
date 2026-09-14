import { describe, expect, it } from 'vitest';

import { resolveCliProfilePreferencesPath } from '../src/preferences/cliProfilePreferences.js';

describe('resolveCliProfilePreferencesPath', () => {
  it('returns undefined when no flag and no env var are present', () => {
    expect(
      resolveCliProfilePreferencesPath(['node', 'cli.js', '--fixture'], {}),
    ).toBeUndefined();
  });

  it('returns the path provided by --profile-preferences=', () => {
    expect(
      resolveCliProfilePreferencesPath(
        [
          'node',
          'cli.js',
          '--profile-preferences=/data/settings/profile-preferences.json',
        ],
        {},
      ),
    ).toBe('/data/settings/profile-preferences.json');
  });

  it('returns the path from PROFILE_PREFERENCES_PATH when no flag is set', () => {
    expect(
      resolveCliProfilePreferencesPath(['node', 'cli.js'], {
        PROFILE_PREFERENCES_PATH: '/data/settings/profile-preferences.json',
      }),
    ).toBe('/data/settings/profile-preferences.json');
  });

  it('prefers the --profile-preferences flag over the env var', () => {
    expect(
      resolveCliProfilePreferencesPath(
        ['node', 'cli.js', '--profile-preferences=/from/flag.json'],
        { PROFILE_PREFERENCES_PATH: '/from/env.json' },
      ),
    ).toBe('/from/flag.json');
  });

  it('ignores an empty --profile-preferences value and falls back to env', () => {
    expect(
      resolveCliProfilePreferencesPath(
        ['node', 'cli.js', '--profile-preferences='],
        { PROFILE_PREFERENCES_PATH: '/from/env.json' },
      ),
    ).toBe('/from/env.json');
  });

  it('ignores empty / whitespace env var and returns undefined', () => {
    expect(
      resolveCliProfilePreferencesPath(['node', 'cli.js'], {
        PROFILE_PREFERENCES_PATH: '   ',
      }),
    ).toBeUndefined();
  });

  it('trims whitespace from a non-empty env var', () => {
    expect(
      resolveCliProfilePreferencesPath(['node', 'cli.js'], {
        PROFILE_PREFERENCES_PATH: '  /data/settings/profile-preferences.json  ',
      }),
    ).toBe('/data/settings/profile-preferences.json');
  });
});
