import { describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';

describe('candidate profile', () => {
  it('loads and validates the committed profile', () => {
    const profile = loadCandidateProfile();

    expect(profile.preferredLocations).toContainEqual({
      city: 'Example City',
      state: 'EX',
    });
    expect(profile.searchRadiusMiles).toBe(25);
    expect(profile.secondarySearchRadiusMiles).toBe(50);
    expect(profile.desiredJobTitles).toContain('Cybersecurity Analyst');
    expect(profile.certifications).toContain('CompTIA Security+');
    expect(profile.degrees).toHaveLength(0);
    expect(profile.clearanceEligibility).toBe('unknown');
    expect(profile.yearsOfExperience).toBeNull();
  });
});
