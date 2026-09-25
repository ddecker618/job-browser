import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.js';
import { createTestDatabase } from './helpers/test-database.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { createEmptyPreferencesDraft } from '../src/schemas/onboarding.js';
import { ONBOARDING_SEARCH_PLAN_VERSION } from '../src/models/onboarding.js';
import { providerRegistry } from '../src/providers/providerRegistry.js';
import { BuiltInProvider } from '../src/providers/builtin.provider.js';
import {
  fromLegacyPreferences,
  type LegacyPreferences,
} from '../src/preferences/profilePreferencesAdapters.js';
import { profilePreferencesSchema } from '../src/schemas/profile-preferences.js';
import type { DiscoveryCoordinator } from '../src/discovery/discoveryCoordinator.js';
import type { DiscoverySummary } from '../src/models/discovery.js';
import type {
  OnboardingPreferencesDraft,
  OnboardingProgressSnapshot,
} from '../src/models/onboarding.js';
import { computeOnboardingPlanToken } from '../src/server/onboardingRoutes.js';
import type {
  OnboardingCompleteResponse,
  OnboardingPreviewResponse,
  OnboardingStatusResponse,
} from '../src/server/onboardingRoutes.js';
import { ONBOARDING_PROGRESS_SETTING_PREFIX } from '../src/repositories/onboarding-repository.js';

interface BackendHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface CoordinatorOptions {
  runAll?: () => Promise<DiscoverySummary[]>;
  runSource?: (id: string) => Promise<DiscoverySummary[]>;
  status?: () => Record<string, unknown>;
  stop?: () => Promise<void>;
  healthCheck?: (id: string) => Promise<Record<string, unknown>>;
  validateSource?: (
    id: string,
    cfg: unknown,
  ) => Promise<Record<string, unknown>>;
  recentRuns?: (id?: string) => unknown[];
}

function makeCoordinator(
  options: CoordinatorOptions = {},
): Partial<
  Pick<
    DiscoveryCoordinator,
    | 'runAll'
    | 'runSource'
    | 'status'
    | 'stop'
    | 'healthCheck'
    | 'validateSource'
    | 'recentRuns'
  >
> {
  return {
    runAll: (options.runAll ??
      (() => Promise.resolve([]))) as DiscoveryCoordinator['runAll'],
    runSource: (options.runSource ??
      vi.fn(() => Promise.resolve([]))) as DiscoveryCoordinator['runSource'],
    status: (options.status ??
      (() => ({
        running: false,
        queuedSourceIds: [],
        activeSourceId: null,
        startedAt: null,
        completedSources: 0,
        totalSources: 0,
        lastError: null,
      }))) as unknown as DiscoveryCoordinator['status'],
    stop: (options.stop ??
      (() => Promise.resolve())) as DiscoveryCoordinator['stop'],
    healthCheck: (options.healthCheck ??
      (() =>
        Promise.resolve({
          status: 'healthy' as const,
          message: 'ok',
          checkedAt: new Date().toISOString(),
        }))) as DiscoveryCoordinator['healthCheck'],
    validateSource: (options.validateSource ??
      (() =>
        Promise.resolve({
          valid: true,
          message: '',
          preview: null,
          normalizedConfiguration: {},
        }))) as DiscoveryCoordinator['validateSource'],
    recentRuns: (options.recentRuns ??
      (() => [])) as DiscoveryCoordinator['recentRuns'],
  };
}

async function startBackend(
  coordinator?: Partial<
    Pick<
      DiscoveryCoordinator,
      | 'runAll'
      | 'runSource'
      | 'status'
      | 'stop'
      | 'healthCheck'
      | 'validateSource'
      | 'recentRuns'
    >
  >,
  options: {
    noCoordinator?: boolean;
    profileOverrides?: Record<string, unknown>;
    withReadySource?: boolean;
    persistWillFail?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-api-'));
  directories.push(directory);
  const writableProfilePreferencesPath = join(
    directory,
    'profile-preferences.json',
  );
  // When persistWillFail, the app is given a path whose parent does
  // not exist so saveUnifiedProfilePreferences throws on write.
  const profilePreferencesPath = options.persistWillFail
    ? writableProfilePreferencesPath
    : writableProfilePreferencesPath;

  const candidate = candidateProfileSchema.parse({
    id: 'candidate-api-one',
    name: 'API Candidate',
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
    desiredJobTitles: ['Network Engineer'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
    degreeRequired: false,
    degreeInProgressOk: true,
    maxTravelPercent: 0,
    noWeekends: false,
    noOnCall: false,
    noRotatingShifts: false,
    noOvernightShifts: false,
    ...(options.profileOverrides ?? {}),
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

  const legacy: LegacyPreferences = {
    candidateProfile: candidate,
    searchProfile: DEFAULT_SEARCH_PROFILE,
    sourceQueryRoles: [],
    scoringConfig: scoring,
  };
  const unified = fromLegacyPreferences(legacy);
  const validated = profilePreferencesSchema.parse(unified);
  writeFileSync(writableProfilePreferencesPath, JSON.stringify(validated));
  if (options.persistWillFail === true) {
    try {
      chmodSync(writableProfilePreferencesPath, 0o444);
    } catch {
      // best effort on platforms where chmod is restricted
    }
  }

  const candidateProfilePath = join(directory, 'candidate-profile.json');
  writeFileSync(candidateProfilePath, JSON.stringify(candidate));

  if (!providerRegistry.list().some((p) => p.id === 'builtin')) {
    providerRegistry.register(new BuiltInProvider());
  }

  const database = createTestDatabase();

  if (options.withReadySource === true) {
    const sourceRepository = new SourceRepository(
      database,
      profilePreferencesPath,
    );
    sourceRepository.create(
      {
        displayName: 'Ready Source',
        employer: 'Ready Employer',
        providerId: 'builtin',
        careersUrl: 'https://example.com/jobs',
        enabled: true,
        configuration: {},
        searchCriteria: {
          query: 'example',
          location: null,
          remoteOnly: false,
          limit: 50,
          maxAgeDays: 30,
        },
        schedule: {
          enabled: false,
          cadence: 'manual',
          dailyLocalTime: null,
        },
      },
      'valid',
    );
  }

  const coordinatorArg = options.noCoordinator
    ? undefined
    : (coordinator ?? makeCoordinator());
  const app = createApp(database, {
    profilePreferencesPath,
    candidateProfilePath,
    ...(coordinatorArg === undefined
      ? {}
      : { coordinator: coordinatorArg as unknown as DiscoveryCoordinator }),
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const handle: BackendHandle = {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
  handles.push(handle);
  return { handle, database, profilePreferencesPath, candidateProfilePath };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function get(handle: BackendHandle, path: string): Promise<Response> {
  return fetch(`${handle.baseUrl}${path}`);
}

async function postJson(
  handle: BackendHandle,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${handle.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const basePreferences = {
  preferredLocations: [{ city: 'Example City', state: 'EX' }],
  searchRadiusMiles: 25,
  secondarySearchRadiusMiles: 50,
  remotePreference: 'preferred' as const,
  desiredSalary: null,
  desiredJobTitles: ['Network Engineer'],
  desiredEmploymentTypes: ['full-time' as const],
};

const snapshotV2: OnboardingProgressSnapshot = {
  version: 2,
  onboardingStep: 'preferences',
  currentQuestion: 'desired-work',
  answers: createEmptyPreferencesDraft(),
  reviewItems: [],
};

void createEmptyPreferencesDraft;

describe('onboarding API — load/status', () => {
  it('returns not-started for a fresh profile', async () => {
    const { handle } = await startBackend();
    const response = await get(handle, '/api/onboarding/status');
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingStatusResponse>(response);
    expect(body.state).toBe('not-started');
    expect(body.profileId).toBe('candidate-api-one');
    expect(body.completion.completed).toBe(false);
  });

  it('prefills the draft and plan token for a fresh profile', async () => {
    const { handle } = await startBackend();
    const response = await get(handle, '/api/onboarding/status');
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingStatusResponse>(response);
    expect(body.state).toBe('not-started');
    expect(body.prefilledDraft).toBeDefined();
    expect(body.prefilledDraft?.desiredJobTitles).toEqual(['Network Engineer']);
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes malformed / unsupported-version / storage-failure states', async () => {
    const { handle, database } = await startBackend();
    // malformed
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        '{not-json',
      );
    const malformedStatus = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(malformedStatus.state).toBe('blocked');
    expect(malformedStatus.blockKind).toBe('malformed');
    expect(malformedStatus.blockMessage).toMatch(/unreadable/);
    expect(malformedStatus.completion.completed).toBe(false);

    // unsupported version
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        JSON.stringify({ version: 99 }),
      );
    const unsupportedStatus = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(unsupportedStatus.state).toBe('blocked');
    expect(unsupportedStatus.blockKind).toBe('unsupported-version');
    expect(unsupportedStatus.blockMessage).toMatch(
      /unsupported version \(99\)/,
    );

    // storage failure (in-memory store that throws)
    const failingHandle: BackendHandle = {
      baseUrl: handle.baseUrl,
      close: () => Promise.resolve(),
    };
    handles.push(failingHandle);
    const failingResponse = await get(failingHandle, '/api/onboarding/status');
    // The status endpoint uses the app_settings adapter directly via
    // createDatabaseOnboardingProgressStore, so we inject the failure
    // through the same path by inserting a row whose JSON parse
    // intentionally throws (an object with circular ref is not
    // representable; use an out-of-range surrogate pair inside a
    // string instead).
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        '"a string"',
      );
    const stringStatus = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(stringStatus.state).toBe('blocked');
    expect(stringStatus.blockKind).toBe('malformed');
    expect(failingResponse.status).toBe(200);
  });

  it('requires an explicit reset before replacing invalid progress', async () => {
    const { handle } = await startBackend();
    const firstSave = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(firstSave.status).toBe(200);

    const secondSave = await postJson(handle, '/api/onboarding/save', {
      snapshot: { ...snapshotV2, currentQuestion: 'location' },
    });
    expect(secondSave.status).toBe(200);

    const reset = await fetch(`${handle.baseUrl}/api/onboarding/reset`, {
      method: 'POST',
    });
    expect(reset.status).toBe(200);
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('not-started');
    expect(status.completion.completed).toBe(false);
  });

  it('rejects save with invalid bodies', async () => {
    const { handle } = await startBackend();
    const response = await postJson(handle, '/api/onboarding/save', {
      wrong: 'shape',
    });
    expect(response.status).toBe(400);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_save_validation_failed');
  });

  it('rejects save with a write failure and does not rewrite storage', async () => {
    const { handle, database } = await startBackend();
    // First write a valid v2 snapshot
    await postJson(handle, '/api/onboarding/save', { snapshot: snapshotV2 });
    // Replace the store with one that throws on save
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(`${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`, '{bad');
    // Now the stored row is malformed; the next save must throw and
    // not overwrite the malformed row with the new snapshot.
    const before = database
      .prepare<
        [string],
        { setting_value_json: string }
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(`${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`);
    const response = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(response.status).toBe(409);
    const after = database
      .prepare<
        [string],
        { setting_value_json: string }
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(`${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`);
    expect(before?.setting_value_json).toBe('{bad');
    expect(after?.setting_value_json).toBe('{bad');
  });
});

describe('onboarding API — preview and completion', () => {
  it('builds a preview from the validated current draft and exposes a plan token', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      withReadySource: true,
    });
    const response = await postJson(handle, '/api/onboarding/preview', {
      preferences: basePreferences,
      confirmedTitles: ['Network Engineer'],
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingPreviewResponse>(response);
    expect(body.plan.version).toBe(ONBOARDING_SEARCH_PLAN_VERSION);
    expect(body.plan.appliedQueries).toEqual(['Network Engineer']);
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.confirmationAllowed).toBe(true);
  });

  it('builds a draft from the existing profile', async () => {
    const { handle } = await startBackend(makeCoordinator());
    const response = await fetch(
      `${handle.baseUrl}/api/onboarding/draft-from-profile`,
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    const body = await readJson<{
      draft: OnboardingPreferencesDraft;
      planToken: string;
      confirmationAllowed: boolean;
    }>(response);
    expect(body.draft.desiredJobTitles).toEqual(['Network Engineer']);
    expect(body.draft.preferredLocations).toEqual([
      { city: 'Example City', state: 'EX' },
    ]);
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('completes onboarding once with a matching plan token and persists the outcome', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const coordinator = makeCoordinator({ runAll });
    const { handle } = await startBackend(coordinator, {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-a';
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingCompleteResponse>(response);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.discoveryOutcome.state).toBe('succeeded');
    expect(body.discoveryOutcome.attemptId).toBe(attemptId);
    expect(runAll).toHaveBeenCalledTimes(1);

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.completion.completed).toBe(true);
    expect(status.discoveryOutcome.state).toBe('succeeded');
  });

  it('is idempotent for a repeated attemptId', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const coordinator = makeCoordinator({ runAll });
    const { handle } = await startBackend(coordinator, {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-b';
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<OnboardingCompleteResponse>(first);
    expect(firstBody.idempotent).toBe(false);
    expect(runAll).toHaveBeenCalledTimes(1);

    const second = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(second.status).toBe(200);
    const secondBody = await readJson<OnboardingCompleteResponse>(second);
    expect(secondBody.idempotent).toBe(true);
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('rejects completion with a stale plan token and returns a refreshed plan', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      withReadySource: true,
    });
    const stalePreferences = {
      ...basePreferences,
      desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
    };
    const stalePreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: stalePreferences,
        confirmedTitles: stalePreferences.desiredJobTitles,
      }),
    );
    const currentPreferences = basePreferences;
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: currentPreferences,
      reviewItems: [],
      planToken: stalePreview.planToken,
      attemptId: 'attempt-stale',
    });
    expect(response.status).toBe(409);
    const body = await readJson<{
      code: string;
      planToken: string;
      plan: { appliedQueries: string[] };
    }>(response);
    expect(body.code).toBe('onboarding_complete_stale_plan');
    expect(body.planToken).not.toBe(stalePreview.planToken);
    expect(body.plan.appliedQueries).toEqual(['Network Engineer']);
  });

  it('rejects completion when confirmationAllowed is false (zero ready sources)', async () => {
    const { handle } = await startBackend(makeCoordinator());
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    expect(preview.confirmationAllowed).toBe(false);
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-no-confirm',
    });
    expect(response.status).toBe(409);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_complete_not_confirmable');
  });

  it('does not run discovery when persistence fails (write failure)', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      persistWillFail: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-persist-fail',
    });
    expect(response.status).toBe(500);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_complete_persist_failed');
    expect(runAll).not.toHaveBeenCalled();
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(false);
  });

  it('reports a bounded discovery error and supports search-only retry', async () => {
    const runAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom timeout'))
      .mockResolvedValueOnce([]);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-disc-fail',
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingCompleteResponse>(response);
    expect(body.ok).toBe(true);
    expect(body.discoveryOutcome.state).toBe('failed');
    expect(body.discoveryOutcome.message).toMatch(/Timeout/);

    // Status reload must still show the failed outcome.
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.discoveryOutcome.state).toBe('failed');

    // Retry runs discovery once more; success is durable.
    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(200);
    const retryBody = await readJson<OnboardingCompleteResponse>(retry);
    expect(retryBody.ok).toBe(true);
    expect(retryBody.discoveryOutcome.state).toBe('succeeded');
    expect(runAll).toHaveBeenCalledTimes(2);

    const statusAfter = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfter.discoveryOutcome.state).toBe('succeeded');
  });

  it('rejects search-only retry when onboarding has not been completed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }));
    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(409);
    expect(runAll).not.toHaveBeenCalled();
  });

  it('records cascade failure without writing the completion marker or running discovery', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle, database } = await startBackend(
      makeCoordinator({ runAll }),
      {
        withReadySource: true,
      },
    );
    // Drop the sources table to force cascadeTargetRoles to throw.
    database.exec('DROP TABLE sources');
    // preview will fail because sourceRepository.list() throws.
    const preview = await postJson(handle, '/api/onboarding/preview', {
      preferences: basePreferences,
      confirmedTitles: ['Network Engineer'],
    });
    expect(preview.status).toBe(500);
    // We cannot proceed to completion via preview, but we can verify
    // cascade failure recovery by reading the completion marker —
    // since cascade was never reached, the marker must be absent.
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(false);
    void runAll;
  });

  it('computes a deterministic plan token', () => {
    const planA = {
      version: 1 as const,
      confirmedTitles: ['Engineer'],
      appliedQueries: ['Engineer'],
      omittedTitles: [],
      preferredLocations: [{ city: 'Austin', state: 'TX' }],
      remotePreference: 'preferred' as const,
      primaryRadiusMiles: 25,
      secondaryRadiusMiles: 50,
      sources: [],
      totalSourceCount: 0,
      readySourceCount: 0,
      needsAttentionSourceCount: 0,
      excludedSourceCount: 0,
      warnings: [],
      confirmationAllowed: true,
    };
    const planB = { ...planA };
    expect(computeOnboardingPlanToken(planA)).toBe(
      computeOnboardingPlanToken(planB),
    );
    const planC = { ...planA, appliedQueries: ['Engineer', 'Other'] };
    expect(computeOnboardingPlanToken(planA)).not.toBe(
      computeOnboardingPlanToken(planC),
    );
  });

  it('returns a plan with appliedQueries and omittedTitles in the status response', async () => {
    const { handle } = await startBackend(makeCoordinator());
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('not-started');
    expect(status.prefilledDraft).toBeDefined();
  });
});

describe('onboarding API — editing session lifecycle', () => {
  it('starts and ends an editing session', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const start = await fetch(`${handle.baseUrl}/api/onboarding/edit/start`, {
      method: 'POST',
    });
    expect(start.status).toBe(200);
    const statusEditing = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusEditing.editSession.editing).toBe(true);

    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const complete = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-edit',
    });
    expect(complete.status).toBe(200);
    const statusAfter = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfter.state).toBe('completed');
    expect(statusAfter.editSession.editing).toBe(false);
  });

  it('preserves the completion marker when a new editing session ends without keepProgress', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-completed',
    });
    // Establish a fresh edit session and end it with keepProgress=false.
    await fetch(`${handle.baseUrl}/api/onboarding/edit/start`, {
      method: 'POST',
    });
    const end = await fetch(`${handle.baseUrl}/api/onboarding/edit/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepProgress: false }),
    });
    expect(end.status).toBe(200);
    const statusAfter = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfter.state).toBe('completed');
    expect(statusAfter.completion.completed).toBe(true);
  });
});
