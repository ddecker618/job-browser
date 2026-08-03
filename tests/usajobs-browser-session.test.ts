import { describe, expect, it } from 'vitest';

import {
  isUsaJobsAcknowledgementUrl,
  isUsaJobsAuthenticationUrl,
} from '../src/providers/usajobs/browserSession.js';

describe('USAJOBS browser-session URL validation', () => {
  it('accepts only the exact HTTPS USAJOBS login host for acknowledgement', () => {
    expect(
      isUsaJobsAcknowledgementUrl(
        'https://login.usajobs.gov/account/acknowledgement?next=%2F',
      ),
    ).toBe(true);
    expect(
      isUsaJobsAcknowledgementUrl(
        'http://login.usajobs.gov/account/acknowledgement',
      ),
    ).toBe(false);
  });

  it('rejects hostname-confusion and user-info URLs', () => {
    for (const url of [
      'https://login.usajobs.gov.evil.example/account/acknowledgement',
      'https://login.usajobs.gov@evil.example/account/acknowledgement',
      'https://evil.example/login.usajobs.gov/account/acknowledgement',
    ]) {
      expect(isUsaJobsAcknowledgementUrl(url)).toBe(false);
    }
  });

  it('does not classify attacker-controlled lookalike hosts as authentication', () => {
    expect(
      isUsaJobsAuthenticationUrl('https://login.usajobs.gov.evil.example/'),
    ).toBe(false);
    expect(
      isUsaJobsAuthenticationUrl('https://subdomain.login.gov.evil.example/'),
    ).toBe(false);
  });
});
