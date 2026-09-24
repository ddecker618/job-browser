import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardRepository } from '../src/database/dashboardRepository.js';
import { createTestDatabase } from './helpers/test-database.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { createEmptyPreferencesDraft } from '../src/schemas/onboarding.js';
import type { OnboardingReviewItem } from '../src/models/onboarding.js';
import {
  createDatabaseOnboardingProgressStore,
  loadOnboardingProgress,
  onboardingProgressKey,
  resetOnboardingProgress,
  saveOnboardingProgress,
} from '../src/repositories/onboarding-repository.js';
import {
  applyConfirmedReviewItems,
  completeOnboarding,
  resumeOnboardingProgress,
  reviewItemsFromProgress,
} from '../src/onboarding/onboarding-service.js';
import { fictionalResumedProgressSnapshot } from '../src/client/fixtures/onboarding.fixture.js';
import type { LegacyPreferences } from '../src/preferences/profilePreferencesAdapters.js';
import { loadUnifiedLegacyPreferences } from '../src/preferences/profilePreferencesRuntime.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function profile(id: string) {
  return candidateProfileSchema.parse({
    id,
    name: `Candidate ${id}`,
    preferredLocations: [{ city: 'Example City', state: 'EX' }],
    searchRadiusMiles: 20,
    secondarySearchRadiusMiles: 40,
    remotePreference: 'accepted',
    desiredSalary: {
      minimum: 70000,
      target: 90000,
      currency: 'USD',
    },
    certifications: ['Existing Certification'],
    degrees: [],
    skills: ['Existing Skill'],
    clearanceEligibility: 'unknown',
    yearsOfExperience: null,
    desiredJobTitles: ['Systems Administrator'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
  });
}

function preferencesFor(
  candidate: ReturnType<typeof profile>,
): LegacyPreferences {
  return {
    candidateProfile: candidate,
    searchProfile: DEFAULT_SEARCH_PROFILE,
    sourceQueryRoles: ['Systems Administrator'],
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
      skills: [],
      certifications: [],
    }),
  };
}

const reviewItems: readonly OnboardingReviewItem[] = [
  {
    id: 'skill-1',
    field: 'skills',
    value: 'Kubernetes',
    status: 'confirmed',
    reason: 'Resume heading',
  },
  {
    id: 'cert-1',
    field: 'certifications',
    value: 'Security+',
    status: 'suggested',
    reason: 'Resume text',
  },
];

describe('onboarding progress persistence', () => {
  it('persists through the real app_settings repository and isolates profiles', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    const store = createDatabaseOnboardingProgressStore(database);
    saveOnboardingProgress(
      repository,
      'candidate-one',
      fictionalResumedProgressSnapshot,
    );

    expect(loadOnboardingProgress(repository, 'candidate-one')).toEqual({
      kind: 'valid',
      snapshot: fictionalResumedProgressSnapshot,
    });
    expect(loadOnboardingProgress(repository, 'candidate-two')).toEqual({
      kind: 'missing',
    });
    expect(
      store.getSetting(onboardingProgressKey('candidate-one')),
    ).not.toBeNull();
    database.close();
  });

  it('distinguishes missing, malformed, unsupported and storage failures', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    expect(loadOnboardingProgress(repository, 'missing')).toEqual({
      kind: 'missing',
    });
    repository.saveSetting(onboardingProgressKey('bad'), '{');
    expect(loadOnboardingProgress(repository, 'bad').kind).toBe('malformed');
    repository.saveSetting(
      onboardingProgressKey('newer'),
      JSON.stringify({ version: 9 }),
    );
    expect(loadOnboardingProgress(repository, 'newer')).toEqual({
      kind: 'unsupported-version',
      version: 9,
    });
    const failingStore = {
      getSetting: () => {
        throw new Error('read failed');
      },
      saveSetting: () => {
        throw new Error('write failed');
      },
    };
    expect(loadOnboardingProgress(failingStore, 'candidate').kind).toBe(
      'storage-failure',
    );
    expect(() =>
      saveOnboardingProgress(
        failingStore,
        'candidate',
        fictionalResumedProgressSnapshot,
      ),
    ).toThrow('read failed');
    database.close();
  });

  it('restores version 2 review items and recovers a disabled salary position', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    const snapshot = {
      version: 2 as const,
      onboardingStep: 'review' as const,
      currentQuestion: 'salary' as const,
      answers: createEmptyPreferencesDraft(),
      reviewItems,
    };
    saveOnboardingProgress(repository, 'candidate-one', snapshot);
    const result = loadOnboardingProgress(repository, 'candidate-one');
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      const resumed = resumeOnboardingProgress(
        result,
        createEmptyPreferencesDraft(),
      );
      expect(resumed.question).toBe('desired-work');
      expect(result.snapshot.version).toBe(2);
      if (result.snapshot.version === 2)
        expect(result.snapshot.reviewItems).toEqual(reviewItems);
    }
    database.close();
  });

  it('requires an explicit reset before replacing invalid progress', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    repository.saveSetting(onboardingProgressKey('candidate-one'), '{bad');
    expect(loadOnboardingProgress(repository, 'candidate-one').kind).toBe(
      'malformed',
    );
    expect(() =>
      saveOnboardingProgress(
        repository,
        'candidate-one',
        fictionalResumedProgressSnapshot,
      ),
    ).toThrow('explicitly reset');
    resetOnboardingProgress(repository, 'candidate-one');
    expect(() =>
      saveOnboardingProgress(
        repository,
        'candidate-one',
        fictionalResumedProgressSnapshot,
      ),
    ).not.toThrow();
    expect(loadOnboardingProgress(repository, 'candidate-one').kind).toBe(
      'valid',
    );
    resetOnboardingProgress(repository, 'candidate-one');
    expect(loadOnboardingProgress(repository, 'candidate-one')).toEqual({
      kind: 'missing',
    });
    database.close();
  });

  it('applies only confirmed review facts, preserves existing facts and is idempotent', () => {
    const candidate = profile('candidate-one');
    const once = applyConfirmedReviewItems(candidate, reviewItems);
    const twice = applyConfirmedReviewItems(once, reviewItems);
    expect(once.skills).toEqual(['Existing Skill', 'Kubernetes']);
    expect(once.certifications).toEqual(['Existing Certification']);
    expect(twice).toEqual(once);
    expect(
      applyConfirmedReviewItems(once, [
        { ...reviewItems[0]!, status: 'unknown' },
      ]),
    ).toEqual(once);
  });

  it('writes profile data before clearing progress and retains progress when profile saving fails', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-'));
    temporaryDirectories.push(directory);
    const current = preferencesFor(profile('candidate-one'));
    saveOnboardingProgress(repository, 'candidate-one', {
      version: 2,
      onboardingStep: 'review',
      currentQuestion: null,
      answers: createEmptyPreferencesDraft(),
      reviewItems,
    });
    expect(() =>
      completeOnboarding(repository, {
        profilePreferencesPath: join(directory, 'missing', 'profile.json'),
        profilePreferences: {
          ...current,
          candidateProfile: { ...current.candidateProfile, name: '' },
        },
        preferences: {
          preferredLocations: current.candidateProfile.preferredLocations,
          searchRadiusMiles: 20,
          secondarySearchRadiusMiles: 40,
          remotePreference: 'accepted',
          desiredSalary: null,
          desiredJobTitles: ['Systems Administrator'],
          desiredEmploymentTypes: ['full-time'],
        },
        reviewItems,
        profileId: 'candidate-one',
      }),
    ).toThrow();
    expect(loadOnboardingProgress(repository, 'candidate-one').kind).toBe(
      'valid',
    );
    database.close();
  });

  it('applies preferences and confirmed facts once, then clears progress on retry', () => {
    const database = createTestDatabase();
    const repository = new DashboardRepository(database);
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-'));
    temporaryDirectories.push(directory);
    const current = preferencesFor(profile('candidate-one'));
    saveOnboardingProgress(repository, 'candidate-one', {
      version: 2,
      onboardingStep: 'review',
      currentQuestion: null,
      answers: createEmptyPreferencesDraft(),
      reviewItems,
    });
    const options = {
      profilePreferencesPath: join(directory, 'profile.json'),
      profilePreferences: current,
      preferences: {
        preferredLocations: current.candidateProfile.preferredLocations,
        searchRadiusMiles: 25,
        secondarySearchRadiusMiles: 50,
        remotePreference: 'preferred' as const,
        desiredSalary: null,
        desiredJobTitles: ['Network Administrator'],
        desiredEmploymentTypes: ['full-time' as const],
      },
      reviewItems: [{ ...reviewItems[0]!, status: 'confirmed' as const }],
      profileId: 'candidate-one',
    };
    const saved = completeOnboarding(repository, options);
    expect(saved.skills).toEqual(['Existing Skill', 'Kubernetes']);
    expect(saved.desiredSalary).toEqual(current.candidateProfile.desiredSalary);
    expect(loadOnboardingProgress(repository, 'candidate-one')).toEqual({
      kind: 'missing',
    });
    expect(
      loadUnifiedLegacyPreferences(options.profilePreferencesPath)
        ?.candidateProfile,
    ).toEqual(saved);
    database.close();
  });
});

// ---------------------------------------------------------------------------
// MR1-04 review-corrections coverage
// ---------------------------------------------------------------------------

function makeVersionOneSnapshot() {
  return {
    version: 1 as const,
    onboardingStep: 'preferences' as const,
    currentQuestion: 'travel-distance' as const,
    answers: {
      ...fictionalResumedProgressSnapshot.answers,
    },
  };
}

function makeVersionTwoSnapshot() {
  return {
    version: 2 as const,
    onboardingStep: 'review' as const,
    currentQuestion: null,
    answers: createEmptyPreferencesDraft(),
    reviewItems,
  };
}

describe('onboarding progress persistence — review corrections', () => {
  it('performs save, load, and reset through the real database adapter end-to-end', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const snapshot = makeVersionOneSnapshot();

    // save
    store.saveSetting(
      onboardingProgressKey('candidate-one'),
      JSON.stringify(snapshot),
    );

    // load via the adapter directly
    const raw = store.getSetting(onboardingProgressKey('candidate-one'));
    expect(raw).not.toBeNull();
    const loaded = loadOnboardingProgress(store, 'candidate-one');
    expect(loaded.kind).toBe('valid');
    if (loaded.kind !== 'valid') throw new Error('expected valid');
    expect(loaded.snapshot).toEqual(snapshot);

    // reset through the adapter and confirm missing
    expect(store.deleteSetting).toBeDefined();
    store.deleteSetting?.(onboardingProgressKey('candidate-one'));
    expect(loadOnboardingProgress(store, 'candidate-one')).toEqual({
      kind: 'missing',
    });
    database.close();
  });

  it('keeps a valid version-1 snapshot readable and does not silently promote it to version 2', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const v1 = makeVersionOneSnapshot();

    store.saveSetting(
      onboardingProgressKey('candidate-v1'),
      JSON.stringify(v1),
    );

    const loaded = loadOnboardingProgress(store, 'candidate-v1');
    expect(loaded.kind).toBe('valid');
    if (loaded.kind !== 'valid') throw new Error('expected valid');
    expect(loaded.snapshot.version).toBe(1);
    expect(loaded.snapshot.currentQuestion).toBe('travel-distance');
    expect(loaded.snapshot.answers).toEqual(v1.answers);

    // reviewItemsFromProgress must not invent review items for v1
    const items = reviewItemsFromProgress(loaded);
    expect(items).toEqual([]);

    // Loading must not mutate the underlying row.
    const rawBefore = store.getSetting(onboardingProgressKey('candidate-v1'));
    loadOnboardingProgress(store, 'candidate-v1');
    const rawAfter = store.getSetting(onboardingProgressKey('candidate-v1'));
    expect(rawAfter).toBe(rawBefore);
    expect(JSON.parse(rawAfter!)).toEqual(v1);
    database.close();
  });

  it('reports read failures, write failures, and reset failures independently and never converts them into success', () => {
    // --- read failure ---
    const readFailure = {
      getSetting: () => {
        throw new Error('boom read');
      },
      saveSetting: () => undefined,
    };
    expect(loadOnboardingProgress(readFailure, 'candidate').kind).toBe(
      'storage-failure',
    );
    // save must not reach saveSetting when read fails
    const readFailureWithSpy = {
      getSetting: () => {
        throw new Error('boom read');
      },
      saveSetting: vi.fn(),
    };
    expect(() =>
      saveOnboardingProgress(
        readFailureWithSpy,
        'candidate',
        makeVersionTwoSnapshot(),
      ),
    ).toThrow('boom read');
    expect(readFailureWithSpy.saveSetting).not.toHaveBeenCalled();

    // --- write failure after successful read ---
    const writeFailureStore = {
      getSetting: () => null,
      saveSetting: () => {
        throw new Error('boom write');
      },
    };
    // a missing slot is read fine but the write explodes
    expect(() =>
      saveOnboardingProgress(
        writeFailureStore,
        'candidate',
        makeVersionTwoSnapshot(),
      ),
    ).toThrow('boom write');
    // a follow-up load still reports missing, not success
    expect(loadOnboardingProgress(writeFailureStore, 'candidate').kind).toBe(
      'missing',
    );

    // --- reset failure ---
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    saveOnboardingProgress(store, 'candidate', makeVersionTwoSnapshot());
    const resetFailureStore = {
      getSetting: (key: string) => store.getSetting(key),
      saveSetting: (key: string, value: string) =>
        store.saveSetting(key, value),
      deleteSetting: () => {
        throw new Error('boom reset');
      },
    };
    expect(() =>
      resetOnboardingProgress(resetFailureStore, 'candidate'),
    ).toThrow('boom reset');
    // progress must still be present and reportable, never silently missing
    const afterFailedReset = loadOnboardingProgress(store, 'candidate');
    expect(afterFailedReset.kind).toBe('valid');
    database.close();
  });

  it('distinguishes missing, malformed, and unsupported progress, requires explicit reset, and keeps them recoverable', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);

    // missing
    expect(loadOnboardingProgress(store, 'a').kind).toBe('missing');

    // malformed
    store.saveSetting(onboardingProgressKey('b'), '{not-json');
    const malformed = loadOnboardingProgress(store, 'b');
    expect(malformed.kind).toBe('malformed');
    if (malformed.kind !== 'malformed') throw new Error('expected malformed');
    expect(malformed.error).toBeInstanceOf(Error);

    // unsupported-version
    store.saveSetting(
      onboardingProgressKey('c'),
      JSON.stringify({ version: 99 }),
    );
    const unsupported = loadOnboardingProgress(store, 'c');
    expect(unsupported).toEqual({ kind: 'unsupported-version', version: 99 });

    // Cannot silently overwrite: save must throw on both malformed and
    // unsupported-version entries until the caller explicitly resets them.
    expect(() =>
      saveOnboardingProgress(store, 'b', makeVersionTwoSnapshot()),
    ).toThrow('explicitly reset');
    expect(() =>
      saveOnboardingProgress(store, 'c', makeVersionTwoSnapshot()),
    ).toThrow('explicitly reset');

    // A subsequent load still reports the same distinguishable state, and
    // the underlying row is still recoverable / reportable.
    expect(loadOnboardingProgress(store, 'b').kind).toBe('malformed');
    expect(loadOnboardingProgress(store, 'c')).toEqual({
      kind: 'unsupported-version',
      version: 99,
    });

    // An explicit reset turns them into missing so the next save succeeds.
    resetOnboardingProgress(store, 'b');
    resetOnboardingProgress(store, 'c');
    expect(loadOnboardingProgress(store, 'b').kind).toBe('missing');
    expect(loadOnboardingProgress(store, 'c').kind).toBe('missing');
    expect(() =>
      saveOnboardingProgress(store, 'b', makeVersionTwoSnapshot()),
    ).not.toThrow();
    database.close();
  });

  it('reports a reset failure on completion but does not duplicate confirmed facts on retry, and a later successful reset clears the exact original profile-scoped progress key', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-'));
    temporaryDirectories.push(directory);
    const current = preferencesFor(profile('candidate-one'));

    // pre-existing onboarding progress stored under the original profile id
    saveOnboardingProgress(store, 'candidate-one', makeVersionTwoSnapshot());
    expect(loadOnboardingProgress(store, 'candidate-one').kind).toBe('valid');

    // Build a store whose deleteSetting fails: completeOnboarding writes
    // the profile successfully, then the reset throws and surfaces.
    const resetFailureStore = {
      getSetting: (key: string) => store.getSetting(key),
      saveSetting: (key: string, value: string) =>
        store.saveSetting(key, value),
      deleteSetting: () => {
        throw new Error('boom reset');
      },
    };

    const baseOptions = {
      profilePreferencesPath: join(directory, 'profile.json'),
      preferences: {
        preferredLocations: current.candidateProfile.preferredLocations,
        searchRadiusMiles: 25,
        secondarySearchRadiusMiles: 50,
        remotePreference: 'preferred' as const,
        desiredSalary: null,
        desiredJobTitles: ['Network Administrator'],
        desiredEmploymentTypes: ['full-time' as const],
      },
      reviewItems: [
        {
          id: 'skill-1',
          field: 'skills' as const,
          value: 'Kubernetes',
          status: 'confirmed' as const,
          reason: null,
        },
      ],
      profileId: 'candidate-one',
    };

    // First completion: profile write succeeds, reset throws, progress remains.
    let thrown: unknown;
    try {
      completeOnboarding(resetFailureStore, {
        ...baseOptions,
        profilePreferences: current,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('boom reset');

    // Progress remains recoverable; the profile file was written exactly
    // once (verified through the actual file contents).
    const afterFirstFailure = loadOnboardingProgress(store, 'candidate-one');
    expect(afterFirstFailure.kind).toBe('valid');
    const onDisk = loadUnifiedLegacyPreferences(
      baseOptions.profilePreferencesPath,
    );
    expect(onDisk?.candidateProfile.skills).toEqual([
      'Existing Skill',
      'Kubernetes',
    ]);

    // Retry: reset still fails, so we only need to assert that confirmed
    // skills and certifications are not duplicated despite two save
    // attempts, and progress is still recoverable.
    thrown = undefined;
    try {
      completeOnboarding(resetFailureStore, {
        ...baseOptions,
        profilePreferences: onDisk ?? current,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('boom reset');
    const onDiskAfterRetry = loadUnifiedLegacyPreferences(
      baseOptions.profilePreferencesPath,
    );
    expect(onDiskAfterRetry?.candidateProfile.skills).toEqual([
      'Existing Skill',
      'Kubernetes',
    ]);
    expect(onDiskAfterRetry?.candidateProfile.certifications).toEqual([
      'Existing Certification',
    ]);
    expect(loadOnboardingProgress(store, 'candidate-one').kind).toBe('valid');

    // A later successful reset clears the exact original
    // onboardingProgress:candidate-one key and nothing else.
    resetOnboardingProgress(store, 'candidate-one');
    expect(loadOnboardingProgress(store, 'candidate-one')).toEqual({
      kind: 'missing',
    });
    // no other key was created for a different profile id
    expect(store.getSetting(onboardingProgressKey('candidate-two'))).toBeNull();
    database.close();
  });

  it('keeps profile application conservative and never writes directly through SQLite as a second profile authority', () => {
    const before = profile('candidate-one');
    const applied = applyConfirmedReviewItems(before, [
      // suggestions and unknown items must not apply
      {
        id: 's',
        field: 'skills',
        value: 'Should Not Apply',
        status: 'suggested',
        reason: 'Resume text',
      },
      {
        id: 'u',
        field: 'certifications',
        value: 'Mystery Cert',
        status: 'unknown',
        reason: null,
      },
      // confirmed blank values must not apply
      {
        id: 'b',
        field: 'skills',
        value: '   ',
        status: 'confirmed',
        reason: null,
      },
      // confirmed real value applies once
      {
        id: 'k',
        field: 'skills',
        value: 'Kubernetes',
        status: 'confirmed',
        reason: null,
      },
    ]);

    expect(applied.skills).toEqual(['Existing Skill', 'Kubernetes']);
    expect(applied.certifications).toEqual(['Existing Certification']);
    expect(applied.desiredSalary).toEqual(before.desiredSalary);
    expect(applied.id).toBe(before.id);
    expect(applied.name).toBe(before.name);
    expect(applied.clearanceEligibility).toBe(before.clearanceEligibility);

    // Idempotent: applying the same items again does not change anything.
    const twice = applyConfirmedReviewItems(applied, [
      {
        id: 'k',
        field: 'skills',
        value: 'Kubernetes',
        status: 'confirmed',
        reason: null,
      },
    ]);
    expect(twice).toEqual(applied);

    // No direct SQLite write happens from the onboarding service itself:
    // applyConfirmedReviewItems is a pure projection over the profile.
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const candidateId = before.id;
    expect(store.getSetting(onboardingProgressKey(candidateId))).toBeNull();
    database.close();
  });
});
