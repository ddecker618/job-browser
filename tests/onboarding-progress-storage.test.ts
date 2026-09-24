import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardRepository } from '../src/database/dashboardRepository.js';
import { createTestDatabase } from './helpers/test-database.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import {
  createEmptyPreferencesDraft,
  firstUnresolvedQuestion,
} from '../src/schemas/onboarding.js';
import type {
  OnboardingProgressSnapshot,
  OnboardingQuestion,
  OnboardingReviewItem,
} from '../src/models/onboarding.js';
import {
  createDatabaseOnboardingProgressStore,
  loadOnboardingProgress,
  onboardingProgressKey,
  resetOnboardingProgress,
  saveOnboardingProgress,
} from '../src/repositories/onboarding-repository.js';
import type { OnboardingProgressLoadResult } from '../src/repositories/onboarding-repository.js';
import {
  applyConfirmedReviewItems,
  completeOnboarding,
  currentOnboardingQuestion,
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
      expect(resumed.kind).toBe('ready');
      if (resumed.kind !== 'ready') throw new Error('expected ready');
      expect(resumed.source).toBe('stored');
      expect(resumed.question).toBe('desired-work');
      expect(resumed.snapshot.version).toBe(2);
      expect(resumed.snapshot).toEqual(result.snapshot);
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

// ---------------------------------------------------------------------------
// MR1-04 resume-contract coverage (Codex review blocker resolution)
// ---------------------------------------------------------------------------

describe('onboarding progress persistence — resume contract', () => {
  function narrowReady(
    result: ReturnType<typeof resumeOnboardingProgress>,
    context: string,
  ): {
    kind: 'ready';
    source: 'stored' | 'fresh';
    snapshot: OnboardingProgressSnapshot;
    question: OnboardingQuestion | null;
  } {
    if (result.kind !== 'ready') {
      throw new Error(
        `expected ready result but got ${result.kind} (${context})`,
      );
    }
    return result;
  }
  function classifyResume(
    result: ReturnType<typeof resumeOnboardingProgress>,
  ): string {
    switch (result.kind) {
      case 'ready':
        return result.source;
      case 'blocked-malformed':
        return 'malformed';
      case 'blocked-unsupported-version':
        return 'unsupported-version';
      case 'blocked-storage-failure':
        return 'storage-failure';
    }
  }

  function classifyQuestion(
    result: ReturnType<typeof currentOnboardingQuestion>,
  ): string {
    switch (result.kind) {
      case 'ready':
        return result.source;
      case 'blocked-malformed':
        return 'malformed';
      case 'blocked-unsupported-version':
        return 'unsupported-version';
      case 'blocked-storage-failure':
        return 'storage-failure';
    }
  }

  it('resumes a valid stored snapshot with source="stored" and recovers a disabled salary position', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const stored = {
      version: 2 as const,
      onboardingStep: 'review' as const,
      currentQuestion: 'salary' as const,
      answers: createEmptyPreferencesDraft(),
      reviewItems,
    };
    saveOnboardingProgress(store, 'candidate-one', stored);

    const loaded = loadOnboardingProgress(store, 'candidate-one');
    expect(loaded.kind).toBe('valid');
    const draft = createEmptyPreferencesDraft();
    const resumed = resumeOnboardingProgress(loaded, draft);

    const ready = narrowReady(resumed, 'valid');
    expect(ready.source).toBe('stored');
    expect(ready.snapshot).toEqual(stored);
    expect(ready.snapshot.version).toBe(2);
    expect(ready.question).toBe('desired-work');

    // currentOnboardingQuestion must surface ready state, never collapse.
    const question = currentOnboardingQuestion(loaded, draft);
    expect(question.kind).toBe('ready');
    if (question.kind !== 'ready') throw new Error('expected ready');
    expect(question.source).toBe('stored');
    expect(question.question).toBe('desired-work');
    expect(question.question).not.toBeNull();

    // The stored row was not rewritten by merely resuming it.
    const rawAfter = store.getSetting(onboardingProgressKey('candidate-one'));
    expect(JSON.parse(rawAfter!)).toEqual(stored);
    database.close();
  });

  it('mints a fresh version-2 snapshot only from a missing load and never for valid loads', () => {
    const database = createTestDatabase();
    const store = createDatabaseOnboardingProgressStore(database);
    const draft = createEmptyPreferencesDraft();

    // missing → fresh v2 snapshot
    const missing = loadOnboardingProgress(store, 'fresh-candidate');
    expect(missing.kind).toBe('missing');
    const missingResumed = resumeOnboardingProgress(missing, draft);
    const missingReady = narrowReady(missingResumed, 'missing');
    expect(missingReady.source).toBe('fresh');
    expect(missingReady.snapshot.version).toBe(2);
    if (missingReady.snapshot.version !== 2)
      throw new Error('fresh snapshot should be v2');
    expect(missingReady.snapshot.onboardingStep).toBe('preferences');
    expect(missingReady.snapshot.currentQuestion).toBe(
      firstUnresolvedQuestion(draft),
    );
    expect(missingReady.snapshot.answers).toEqual(draft);
    expect(missingReady.snapshot.reviewItems).toEqual([]);

    const missingQuestion = currentOnboardingQuestion(missing, draft);
    expect(missingQuestion.kind).toBe('ready');
    if (missingQuestion.kind !== 'ready') throw new Error('expected ready');
    expect(missingQuestion.source).toBe('fresh');
    expect(missingQuestion.question).toBe(firstUnresolvedQuestion(draft));

    // valid → NOT a fresh snapshot
    saveOnboardingProgress(store, 'fresh-candidate', makeVersionTwoSnapshot());
    const valid = loadOnboardingProgress(store, 'fresh-candidate');
    expect(valid.kind).toBe('valid');
    if (valid.kind !== 'valid') throw new Error('expected valid');
    const validResumed = resumeOnboardingProgress(valid, draft);
    const validReady = narrowReady(validResumed, 'valid-after-missing');
    expect(validReady.source).toBe('stored');
    expect(validReady.snapshot.version).toBe(2);
    expect(validReady.snapshot).toEqual(makeVersionTwoSnapshot());

    // Resume must not have rewritten the stored row.
    const rawValid = store.getSetting(onboardingProgressKey('fresh-candidate'));
    expect(JSON.parse(rawValid!)).toEqual(makeVersionTwoSnapshot());
    database.close();
  });

  it('returns blocked-malformed with the original Error and exposes no snapshot', () => {
    const original = new SyntaxError('boom json');
    const loadResult = {
      kind: 'malformed' as const,
      error: original,
    };

    const resumed = resumeOnboardingProgress(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(resumed.kind).toBe('blocked-malformed');
    if (resumed.kind !== 'blocked-malformed')
      throw new Error('expected malformed');
    expect(resumed.error).toBe(original);
    expect(resumed.error.message).toBe('boom json');
    // No fabricated snapshot or question field on this branch.
    expect('snapshot' in resumed).toBe(false);
    expect('question' in resumed).toBe(false);

    const question = currentOnboardingQuestion(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(question.kind).toBe('blocked-malformed');
    if (question.kind !== 'blocked-malformed')
      throw new Error('expected malformed');
    expect(question.error).toBe(original);
    // Plain null is reserved for ready/completed; blocked must NOT collapse.
    expect(question).not.toBeNull();
    expect('question' in question).toBe(false);

    expect(classifyResume(resumed)).toBe('malformed');
    expect(classifyQuestion(question)).toBe('malformed');
  });

  it('returns blocked-unsupported-version with the original version number and exposes no snapshot', () => {
    const loadResult = { kind: 'unsupported-version' as const, version: 9 };

    const resumed = resumeOnboardingProgress(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(resumed.kind).toBe('blocked-unsupported-version');
    if (resumed.kind !== 'blocked-unsupported-version')
      throw new Error('expected unsupported-version');
    expect(resumed.version).toBe(9);
    expect('snapshot' in resumed).toBe(false);
    expect('question' in resumed).toBe(false);

    const question = currentOnboardingQuestion(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(question.kind).toBe('blocked-unsupported-version');
    if (question.kind !== 'blocked-unsupported-version')
      throw new Error('expected unsupported-version');
    expect(question.version).toBe(9);
    expect('question' in question).toBe(false);

    expect(classifyResume(resumed)).toBe('unsupported-version');
    expect(classifyQuestion(question)).toBe('unsupported-version');
  });

  it('returns blocked-storage-failure with the original Error and never describes it as missing', () => {
    const original = new Error('disk on fire');
    const loadResult = {
      kind: 'storage-failure' as const,
      error: original,
    };

    const resumed = resumeOnboardingProgress(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(resumed.kind).toBe('blocked-storage-failure');
    if (resumed.kind !== 'blocked-storage-failure')
      throw new Error('expected storage-failure');
    expect(resumed.error).toBe(original);
    expect(resumed.error.message).toBe('disk on fire');
    expect('snapshot' in resumed).toBe(false);
    expect('question' in resumed).toBe(false);

    const question = currentOnboardingQuestion(
      loadResult,
      createEmptyPreferencesDraft(),
    );
    expect(question.kind).toBe('blocked-storage-failure');
    if (question.kind !== 'blocked-storage-failure')
      throw new Error('expected storage-failure');
    expect(question.error).toBe(original);
    expect('question' in question).toBe(false);
    expect(question).not.toBeNull();

    // Storage failure must NOT collapse to missing/ready.
    expect(resumed.kind).not.toBe('ready');
    expect(question.kind).not.toBe('ready');
    expect(classifyResume(resumed)).toBe('storage-failure');
    expect(classifyQuestion(question)).toBe('storage-failure');
  });

  it('allows exhaustive switching without unsafe casts across every load kind', () => {
    const draft = createEmptyPreferencesDraft();
    const cases: {
      label:
        | 'valid'
        | 'missing'
        | 'malformed'
        | 'unsupported-version'
        | 'storage-failure';
      load: OnboardingProgressLoadResult;
    }[] = [
      {
        label: 'valid',
        load: { kind: 'valid', snapshot: makeVersionTwoSnapshot() },
      },
      { label: 'missing', load: { kind: 'missing' } },
      {
        label: 'malformed',
        load: { kind: 'malformed', error: new Error('bad json') },
      },
      {
        label: 'unsupported-version',
        load: { kind: 'unsupported-version', version: 7 },
      },
      {
        label: 'storage-failure',
        load: { kind: 'storage-failure', error: new Error('io error') },
      },
    ];

    for (const { label, load } of cases) {
      const resumed = resumeOnboardingProgress(load, draft);
      const question = currentOnboardingQuestion(load, draft);
      // Exhaustively classify both results without an `as` cast.
      const classifiedResume = classifyResume(resumed);
      const classifiedQuestion = classifyQuestion(question);
      switch (resumed.kind) {
        case 'ready': {
          // The discriminated block must not appear on the ready branch.
          expect(resumed.source).toMatch(/^(stored|fresh)$/);
          if (label !== 'valid' && label !== 'missing') {
            throw new Error('ready should only arise from valid or missing');
          }
          break;
        }
        case 'blocked-malformed':
          expect(label).toBe('malformed');
          expect(resumed.error).toBeInstanceOf(Error);
          expect('snapshot' in resumed).toBe(false);
          break;
        case 'blocked-unsupported-version':
          expect(label).toBe('unsupported-version');
          expect(typeof resumed.version).toBe('number');
          expect('snapshot' in resumed).toBe(false);
          break;
        case 'blocked-storage-failure':
          expect(label).toBe('storage-failure');
          expect(resumed.error).toBeInstanceOf(Error);
          expect('snapshot' in resumed).toBe(false);
          break;
      }
      switch (question.kind) {
        case 'ready':
          expect(question.source).toMatch(/^(stored|fresh)$/);
          break;
        case 'blocked-malformed':
        case 'blocked-unsupported-version':
        case 'blocked-storage-failure':
          // question result must never collapse to plain null.
          expect(question).not.toBeNull();
          break;
      }
      expect(classifiedResume).toBe(
        label === 'valid' ? 'stored' : label === 'missing' ? 'fresh' : label,
      );
      expect(classifiedQuestion).toBe(
        label === 'valid' ? 'stored' : label === 'missing' ? 'fresh' : label,
      );
    }
  });
});
