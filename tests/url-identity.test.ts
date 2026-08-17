import { describe, expect, it } from 'vitest';

import {
  atsTenantIdentity,
  canonicalConfigJson,
  normalizeDomainIdentity,
  normalizeEmployerName,
  normalizeUrlIdentity,
} from '../src/domain/urlIdentity.js';

describe('normalizeUrlIdentity', () => {
  it('lowercases the host and strips www when a second-level label remains', () => {
    expect(normalizeUrlIdentity('https://WWW.Acme.com/Careers')).toBe(
      'https://acme.com/Careers',
    );
    expect(normalizeUrlIdentity('https://www.jobs.lever.co/x')).toBe(
      'https://jobs.lever.co/x',
    );
  });

  it('removes fragments, default ports, and tracking parameters', () => {
    expect(
      normalizeUrlIdentity(
        'https://boards.greenhouse.io/acme?utm_source=x&a=1&utm_medium=y&a=2#jobs',
      ),
    ).toBe('https://boards.greenhouse.io/acme?a=1&a=2');
    expect(normalizeUrlIdentity('https://acme.com:443/careers')).toBe(
      'https://acme.com/careers',
    );
    expect(normalizeUrlIdentity('https://jobs.lever.co/acme?ref=twitter')).toBe(
      'https://jobs.lever.co/acme',
    );
  });

  it('sorts remaining query parameters deterministically', () => {
    expect(normalizeUrlIdentity('https://acme.com/careers?z=1&a=2&b=3')).toBe(
      'https://acme.com/careers?a=2&b=3&z=1',
    );
  });

  it('collapses repeated slashes and trims a trailing slash', () => {
    expect(normalizeUrlIdentity('https://acme.com//careers///')).toBe(
      'https://acme.com/careers',
    );
  });

  it('returns null for invalid or non-HTTP(S) URLs', () => {
    expect(normalizeUrlIdentity('not a url')).toBeNull();
    expect(normalizeUrlIdentity('ftp://acme.com/jobs')).toBeNull();
    expect(normalizeUrlIdentity('file:///private/jobs')).toBeNull();
  });

  it('preserves ATS tenant tokens that are not tracking parameters', () => {
    expect(
      normalizeUrlIdentity('https://boards.greenhouse.io/acme?board_token=x'),
    ).toBe('https://boards.greenhouse.io/acme?board_token=x');
  });
});

describe('normalizeDomainIdentity', () => {
  it('accepts bare hostnames and full URLs', () => {
    expect(normalizeDomainIdentity('https://www.example.com/careers')).toBe(
      'example.com',
    );
    expect(normalizeDomainIdentity('EXAMPLE.COM')).toBe('example.com');
    expect(normalizeDomainIdentity('boards.greenhouse.io')).toBe(
      'boards.greenhouse.io',
    );
  });

  it('returns null for unusable input', () => {
    expect(normalizeDomainIdentity('')).toBeNull();
    expect(normalizeDomainIdentity('   ')).toBeNull();
    expect(normalizeDomainIdentity('https://')).toBeNull();
  });
});

describe('normalizeEmployerName', () => {
  it('matches the employers.normalized_name storage format', () => {
    expect(normalizeEmployerName('  Acme   Corporation ')).toBe(
      'acme corporation',
    );
  });
});

describe('canonicalConfigJson', () => {
  it('produces deterministic key-sorted JSON', () => {
    expect(
      canonicalConfigJson({
        z: 1,
        a: { d: 2, c: 3 },
        list: [{ b: 2, a: 1 }],
      }),
    ).toBe('{"a":{"c":3,"d":2},"list":[{"a":1,"b":2}],"z":1}');
  });
});

describe('atsTenantIdentity', () => {
  it('extracts a stable tenant identity per provider', () => {
    expect(atsTenantIdentity('greenhouse', { boardToken: 'acme' })).toBe(
      'greenhouse:acme',
    );
    expect(atsTenantIdentity('lever', { site: 'acme' })).toBe('lever:acme');
    expect(atsTenantIdentity('ashby', { boardName: 'acme' })).toBe(
      'ashby:acme',
    );
    expect(atsTenantIdentity('workday', { tenant: 'acme', site: 'ext' })).toBe(
      'workday:acme:ext',
    );
    expect(
      atsTenantIdentity('smartrecruiters', { companyIdentifier: 'acme' }),
    ).toBe('smartrecruiters:acme');
    expect(atsTenantIdentity('icims', { company: 'acme' })).toBe('icims:acme');
  });

  it('returns null when no tenant can be derived', () => {
    expect(atsTenantIdentity('greenhouse', {})).toBeNull();
    expect(atsTenantIdentity('greenhouse', { boardToken: '' })).toBeNull();
    expect(atsTenantIdentity('greenhouse', null)).toBeNull();
    expect(
      atsTenantIdentity('unknown-provider', { boardToken: 'acme' }),
    ).toBeNull();
  });
});
