import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  fromLegacyPreferences,
  toLegacyPreferences,
} from '../src/preferences/profilePreferencesAdapters.js';
import {
  deserializeProfilePreferences,
  ProfilePreferencesStore,
  serializeProfilePreferences,
} from '../src/preferences/profilePreferencesStore.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { searchProfileSchema } from '../src/config/search-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function createLegacyPreferences() {
  return {
    candidateProfile: candidateProfileSchema.parse({
      id: 'sample-candidate',
      name: 'Sample Candidate',
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: 25,
      secondarySearchRadiusMiles: 40,
      remotePreference: 'accepted',
      desiredSalary: { minimum: 60_000, target: 80_000, currency: 'USD' },
      certifications: ['Example Certification'],
      degrees: [
        {
          name: 'Example Degree',
          institution: 'Example University',
          status: 'in progress',
          expectedCompletion: '2030-01',
        },
      ],
      skills: ['Example Skill'],
      clearanceEligibility: 'unknown',
      yearsOfExperience: 2,
      desiredJobTitles: ['Example Analyst'],
      excludedJobTitles: ['Example Director'],
      desiredEmploymentTypes: ['full-time'],
    }),
    searchProfile: searchProfileSchema.parse({
      families: [
        {
          key: 'example',
          displayName: 'Example Roles',
          enabled: true,
          priority: 1,
          titles: ['Example Analyst'],
        },
      ],
      prioritizeRemote: true,
      maxOnsiteDistanceMiles: 25,
      preferredLocation: 'Example City, EX',
      maxExperienceYears: 3,
      maxQueriesPerRun: 10,
    }),
    scoringConfig: scoringConfigSchema.parse({
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
      skills: [{ name: 'Example Skill', aliases: ['example skill'] }],
      certifications: [
        {
          name: 'Example Certification',
          aliases: ['example certification'],
        },
      ],
    }),
    sourceQueryRoles: ['Example Analyst'],
  };
}

describe('profile preferences infrastructure', () => {
  it('round-trips all legacy preference domains through the unified document', () => {
    const legacy = createLegacyPreferences();
    const document = fromLegacyPreferences(legacy);
    const restored = toLegacyPreferences(document);

    expect(restored).toEqual(legacy);
  });

  it('serializes and validates a unified document', () => {
    const document = fromLegacyPreferences(createLegacyPreferences());
    const restored = deserializeProfilePreferences(
      serializeProfilePreferences(document),
    );

    expect(restored).toEqual(document);
    expect(restored.schemaVersion).toBe(1);
  });

  it('rejects malformed documents during deserialization', () => {
    expect(() =>
      deserializeProfilePreferences('{"schemaVersion":2}'),
    ).toThrow();
  });

  it('loads a missing file as null without creating it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-profile-'));
    directories.push(directory);
    const path = join(directory, 'settings', 'profile-preferences.json');
    const store = new ProfilePreferencesStore(path);

    expect(store.load()).toBeNull();
    expect(readdirSync(directory)).toEqual([]);
  });

  it('saves atomically and replaces an existing document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-profile-'));
    directories.push(directory);
    const path = join(directory, 'settings', 'profile-preferences.json');
    const store = new ProfilePreferencesStore(path);
    const first = fromLegacyPreferences(createLegacyPreferences());
    const second = {
      ...first,
      candidate: { ...first.candidate, name: 'Updated Sample Candidate' },
    };

    store.save(first);
    store.save(second);

    expect(store.load()).toEqual(second);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(second);
    expect(readdirSync(join(directory, 'settings'))).toEqual([
      'profile-preferences.json',
    ]);
  });
});
