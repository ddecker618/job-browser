import { describe, expect, it } from 'vitest';
import { detectCareerSiteProvider } from '../src/domain/atsFingerprint.js';

describe('detectCareerSiteProvider for cisco and crowdstrike', () => {
  it('detects cisco provider', () => {
    const signal = detectCareerSiteProvider('https://jobs.cisco.com/');
    expect(signal).not.toBeNull();
    expect(signal!.providerId).toBe('cisco');
    expect(signal!.configuration).toEqual({ company: 'cisco' });
  });

  it('detects crowdstrike workday tenant as generic workday provider', () => {
    const signal = detectCareerSiteProvider(
      'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers',
    );
    expect(signal).not.toBeNull();
    expect(signal!.providerId).toBe('workday');
    expect(signal!.configuration).toEqual({
      origin: 'https://crowdstrike.wd5.myworkdayjobs.com',
      tenant: 'crowdstrike',
      site: 'crowdstrikecareers',
    });
  });

  it('still detects generic workday provider', () => {
    const signal = detectCareerSiteProvider(
      'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    );
    expect(signal).not.toBeNull();
    expect(signal!.providerId).toBe('workday');
    expect(signal!.configuration).toEqual({
      origin: 'https://nvidia.wd5.myworkdayjobs.com',
      tenant: 'nvidia',
      site: 'NVIDIAExternalCareerSite',
    });
  });
});
