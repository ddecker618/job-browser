import { describe, expect, it } from 'vitest';

import {
  resolveDesktopSmokeRoute,
  type DesktopSmokeRoute,
} from '../src/desktop/smokeNavigation.js';

describe('desktop smoke navigation', () => {
  it('resolves allowlisted routes on the current loopback origin', () => {
    expect(
      resolveDesktopSmokeRoute('http://127.0.0.1:43123/dashboard', '/jobs'),
    ).toBe('http://127.0.0.1:43123/jobs');
    expect(
      resolveDesktopSmokeRoute('http://localhost:5000/jobs', '/settings'),
    ).toBe('http://localhost:5000/settings');
  });

  it('rejects non-loopback origins', () => {
    expect(() =>
      resolveDesktopSmokeRoute('https://example.com/dashboard', '/jobs'),
    ).toThrow('loopback HTTP origin');
  });

  it('rejects routes outside the smoke-test allowlist at runtime', () => {
    expect(() =>
      resolveDesktopSmokeRoute(
        'http://127.0.0.1:43123/dashboard',
        '/untrusted' as DesktopSmokeRoute,
      ),
    ).toThrow('route is not allowed');
  });
});
