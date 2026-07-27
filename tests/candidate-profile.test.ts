import { describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';

describe('candidate profile', () => {
  it('loads and validates the committed profile', () => {
    const profile = loadCandidateProfile();

    expect(profile.preferredLocations).toContainEqual({
      city: 'Highland',
      state: 'Illinois',
    });
    expect(profile.searchRadiusMiles).toBe(45);
    expect(profile.secondarySearchRadiusMiles).toBe(60);
    expect(profile.desiredJobTitles).toContain('Cybersecurity Analyst');
    expect(profile.certifications).toContain('CompTIA Security+');
    expect(profile.degrees[0]?.expectedCompletion).toBe('2027-08');
    expect(profile.clearanceEligibility).toBe('unknown');
    expect(profile.yearsOfExperience).toBeNull();
  });
});
