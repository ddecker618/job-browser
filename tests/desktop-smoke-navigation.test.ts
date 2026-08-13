import { describe, expect, it } from 'vitest';

import {
  DESKTOP_SMOKE_ROUTES,
  applicationIdFromSmokeCreateResponse,
  isApplicationListSmokeResponse,
  resolveDesktopSmokeApplicationDetailUrl,
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
    expect(
      resolveDesktopSmokeRoute('http://127.0.0.1:43123/jobs', '/applications'),
    ).toBe('http://127.0.0.1:43123/applications');
    expect(DESKTOP_SMOKE_ROUTES).toContain('/applications');
    expect(DESKTOP_SMOKE_ROUTES).toContain('/employers');
    expect(
      resolveDesktopSmokeApplicationDetailUrl(
        'http://127.0.0.1:43123/applications',
        'opaque/id ?value',
      ),
    ).toBe('http://127.0.0.1:43123/applications/opaque%2Fid%20%3Fvalue');
  });

  it('validates the bounded Applications list response shape', () => {
    expect(
      isApplicationListSmokeResponse({ items: [], nextCursor: null }),
    ).toBe(true);
    expect(
      isApplicationListSmokeResponse({ items: [{}], nextCursor: 'opaque' }),
    ).toBe(true);
    expect(
      isApplicationListSmokeResponse({ items: {}, nextCursor: null }),
    ).toBe(false);
    expect(isApplicationListSmokeResponse({ items: [], nextCursor: 1 })).toBe(
      false,
    );
  });

  it('validates the smoke Application creation response', () => {
    expect(
      applicationIdFromSmokeCreateResponse(
        {
          application: { id: 'application-1', jobId: 'job-1' },
          event: { id: 'event-1' },
          replayed: false,
        },
        'job-1',
        'event-1',
      ),
    ).toBe('application-1');
    expect(
      applicationIdFromSmokeCreateResponse(
        {
          application: { id: '', jobId: 'job-1' },
          event: { id: 'event-1' },
          replayed: false,
        },
        'job-1',
        'event-1',
      ),
    ).toBeNull();
  });

  it('rejects non-loopback origins', () => {
    expect(() =>
      resolveDesktopSmokeRoute('https://example.com/dashboard', '/jobs'),
    ).toThrow('loopback HTTP origin');
    expect(() =>
      resolveDesktopSmokeApplicationDetailUrl(
        'https://example.com/applications',
        'application-1',
      ),
    ).toThrow('loopback HTTP origin');
  });

  it('rejects empty dynamic Application IDs', () => {
    expect(() =>
      resolveDesktopSmokeApplicationDetailUrl(
        'http://127.0.0.1:43123/applications',
        '   ',
      ),
    ).toThrow('Application ID is invalid');
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
