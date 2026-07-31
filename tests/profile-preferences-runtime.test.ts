import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import {
  loadUnifiedLegacyPreferences,
  saveUnifiedProfilePreferences,
} from '../src/preferences/profilePreferencesRuntime.js';
import { ProfilePreferencesStore } from '../src/preferences/profilePreferencesStore.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('profile preferences runtime bridge', () => {
  it('uses the unified document when it is present', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-profile-runtime-'),
    );
    directories.push(directory);
    const candidatePath = join(directory, 'candidate-profile.json');
    const scoringPath = join(directory, 'scoring-config.json');
    const unifiedPath = join(directory, 'profile-preferences.json');
    const candidate = candidateProfileSchema.parse({
      id: 'runtime-candidate',
      name: 'Runtime Candidate',
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: 20,
      secondarySearchRadiusMiles: 40,
      remotePreference: 'accepted',
      desiredSalary: null,
      certifications: [],
      degrees: [],
      skills: ['Example Skill'],
      clearanceEligibility: 'unknown',
      yearsOfExperience: null,
      desiredJobTitles: ['Systems Administrator'],
      excludedJobTitles: [],
      desiredEmploymentTypes: ['full-time'],
    });
    const scoring = scoringConfigSchema.parse({
      weights: {
        title: 20,
        skills: 20,
        certifications: 10,
        location: 15,
        remotePreference: 10,
        salary: 10,
        experience: 5,
        employmentType: 5,
        recency: 5,
      },
      recommendationThresholds: {
        applyImmediately: 85,
        strongMatch: 70,
        possibleMatch: 50,
      },
      recency: { freshDays: 7, recentDays: 30 },
      skills: [],
      certifications: [],
    });
    writeFileSync(candidatePath, JSON.stringify(candidate));
    writeFileSync(scoringPath, JSON.stringify(scoring));
    saveUnifiedProfilePreferences(unifiedPath, {
      candidateProfile: candidate,
      searchProfile: DEFAULT_SEARCH_PROFILE,
      sourceQueryRoles: ['Systems Administrator'],
      scoringConfig: scoring,
    });

    expect(loadCandidateProfile(candidatePath, unifiedPath)).toEqual(candidate);
    expect(loadScoringConfig(scoringPath, unifiedPath)).toEqual(scoring);
    expect(loadUnifiedLegacyPreferences(unifiedPath)?.sourceQueryRoles).toEqual(
      ['Systems Administrator'],
    );
  });

  it('falls back to legacy files when the unified document is absent', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'job-browser-profile-fallback-'),
    );
    directories.push(directory);
    const candidatePath = join(directory, 'candidate-profile.json');
    const scoringPath = join(directory, 'scoring-config.json');
    const candidate = candidateProfileSchema.parse({
      id: 'legacy-candidate',
      name: 'Legacy Candidate',
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: 20,
      secondarySearchRadiusMiles: 40,
      remotePreference: 'accepted',
      desiredSalary: null,
      certifications: [],
      degrees: [],
      skills: [],
      clearanceEligibility: 'unknown',
      yearsOfExperience: null,
      desiredJobTitles: ['Network Administrator'],
      excludedJobTitles: [],
      desiredEmploymentTypes: ['full-time'],
    });
    const scoring = scoringConfigSchema.parse({
      weights: {
        title: 20,
        skills: 20,
        certifications: 10,
        location: 15,
        remotePreference: 10,
        salary: 10,
        experience: 5,
        employmentType: 5,
        recency: 5,
      },
      recommendationThresholds: {
        applyImmediately: 85,
        strongMatch: 70,
        possibleMatch: 50,
      },
      recency: { freshDays: 7, recentDays: 30 },
      skills: [],
      certifications: [],
    });
    writeFileSync(candidatePath, JSON.stringify(candidate));
    writeFileSync(scoringPath, JSON.stringify(scoring));

    expect(
      loadCandidateProfile(candidatePath, join(directory, 'missing.json')),
    ).toEqual(candidate);
    expect(
      loadScoringConfig(scoringPath, join(directory, 'missing.json')),
    ).toEqual(scoring);
  });

  it('does not make the runtime document available through the legacy bridge', () => {
    expect(loadUnifiedLegacyPreferences(undefined)).toBeNull();
    expect(
      new ProfilePreferencesStore(
        join(tmpdir(), 'missing-profile.json'),
      ).load(),
    ).toBeNull();
  });
});
