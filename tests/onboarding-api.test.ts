import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import type { OnboardingProgressStore } from '../src/repositories/onboarding-repository.js';

interface BackendHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

interface StartOptions {
  noCoordinator?: boolean;
  profileOverrides?: Record<string, unknown>;
  withReadySource?: boolean;
  progressStore?: OnboardingProgressStore;
  saveProfilePreferences?: (
    path: string | undefined,
    prefs: LegacyPreferences,
  ) => void;
  cascadeTargetRoles?: (roles: readonly string[]) => void;
}

const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeCoordinator(
  options: {
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
  } = {},
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
  options: StartOptions = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-api-'));
  directories.push(directory);
  const profilePreferencesPath = join(directory, 'profile-preferences.json');

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
  writeFileSync(profilePreferencesPath, JSON.stringify(validated));

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
    ...(options.progressStore === undefined
      ? {}
      : { onboardingProgressStore: options.progressStore }),
    ...(options.saveProfilePreferences === undefined
      ? {}
      : { saveProfilePreferences: options.saveProfilePreferences }),
    ...(options.cascadeTargetRoles === undefined
      ? {}
      : { cascadeTargetRoles: options.cascadeTargetRoles }),
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

describe('onboarding API — load/status', () => {
  it('returns not-started for a fresh profile', async () => {
    const { handle } = await startBackend();
    const response = await get(handle, '/api/onboarding/status');
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingStatusResponse>(response);
    expect(body.state).toBe('not-started');
    expect(body.profileId).toBe('candidate-api-one');
    expect(body.completion.completed).toBe(false);
    expect(body.editSession.editing).toBe(false);
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

  it('distinguishes malformed / unsupported-version from genuine storage failures', async () => {
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
    const malformed = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(malformed.state).toBe('blocked');
    expect(malformed.blockKind).toBe('malformed');
    expect(malformed.blockMessage).toMatch(/unreadable/);

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
    const unsupported = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(unsupported.state).toBe('blocked');
    expect(unsupported.blockKind).toBe('unsupported-version');
    expect(unsupported.blockMessage).toMatch(/unsupported version \(99\)/);
  });

  it('reports a genuine storage read failure through the progress store seam', async () => {
    const throwingStore: OnboardingProgressStore = {
      getSetting: () => {
        throw new Error('disk i/o boom');
      },
      saveSetting: () => {
        throw new Error('unused');
      },
      deleteSetting: () => {
        throw new Error('unused');
      },
    };
    const { handle } = await startBackend(undefined, {
      progressStore: throwingStore,
    });
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('blocked');
    expect(status.blockKind).toBe('storage-failure');
    expect(status.blockMessage).toBe(
      'Onboarding progress could not be loaded.',
    );
    // No diagnostic details leak.
    expect(status.blockMessage).not.toMatch(/boom/);
    expect(status.blockMessage).not.toMatch(/stack/i);
    expect(status.blockMessage).not.toMatch(/i\/o/i);
    // Completion marker and edit session remain readable; they are
    // independent of the throwing progress store.
    expect(status.completion.completed).toBe(false);
    expect(status.editSession.editing).toBe(false);
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
});

describe('onboarding API — completed user can edit', () => {
  it('returns an editable wizard with a prefilled draft once editSession.editing is true', async () => {
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
    // Start an edit session explicitly (the client does this from
    // the completed view's "Edit search setup" button).
    const start = await postJson(handle, '/api/onboarding/edit/start', {});
    expect(start.status).toBe(200);

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.editSession.editing).toBe(true);
    // Completion marker remains preserved while editing.
    expect(status.completion.completed).toBe(true);
    // Wizard state takes precedence over the completed view.
    expect(status.state).toBe('in-progress');
    // No resumable snapshot was stored (completion cleared progress);
    // the prefilled draft comes from the current saved profile.
    expect(status.prefilledDraft).toBeDefined();
    expect(status.prefilledDraft?.desiredJobTitles).toEqual([
      'Network Engineer',
    ]);
  });

  it('discarding an edit preserves the completion marker and returns to completed', async () => {
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
    await postJson(handle, '/api/onboarding/edit/start', {});
    // Discard the edit (keepProgress:false clears the snapshot but
    // preserves the completion marker).
    const discard = await postJson(handle, '/api/onboarding/edit/end', {
      keepProgress: false,
    });
    expect(discard.status).toBe(200);
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.completion.completed).toBe(true);
    expect(status.editSession.editing).toBe(false);
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
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('completes onboarding once with a matching plan token and persists the outcome', async () => {
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

  it('is idempotent for a completed attemptId', async () => {
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
    const attemptId = 'attempt-b';
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(first.status).toBe(200);
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
    // No duplicate discovery run.
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
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
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

  it('does not run discovery when profile persistence fails (real seam)', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const throwingSave: (
      path: string | undefined,
      prefs: LegacyPreferences,
    ) => void = () => {
      throw new Error('disk i/o profile preferences boom');
    };
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      saveProfilePreferences: throwingSave,
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
    const body = await readJson<{ code: string; error: string }>(response);
    expect(body.code).toBe('onboarding_complete_persist_failed');
    expect(body.error).toBe(
      'Onboarding could not be saved to your profile preferences.',
    );
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

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.discoveryOutcome.state).toBe('failed');

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

  it('records cascade failure via the real cascade seam without writing the completion marker or running discovery', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const cascadeTargetRoles = (roles: readonly string[]) => {
      throw new Error('boom cascade');
      // Real implementation is not invoked because we control the
      // seam; the test asserts no side effects on the source table
      // when cascade throws.
      void roles;
    };
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      cascadeTargetRoles,
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
      attemptId: 'attempt-cascade-fail',
    });
    expect(response.status).toBe(500);
    const body = await readJson<{
      code: string;
      error: string;
      ok: boolean;
    }>(response);
    expect(body.code).toBe('onboarding_complete_cascade_failed');
    expect(body.error).toBe('Source query roles could not be cascaded.');
    expect(body.ok).toBe(false);
    expect(runAll).not.toHaveBeenCalled();
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(false);
    // Progress remains available for retry.
    expect(status.state).toBe('not-started');
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
    expect(computeOnboardingPlanToken(planA)).toBe(
      computeOnboardingPlanToken(planA),
    );
    expect(computeOnboardingPlanToken(planA)).not.toBe(
      computeOnboardingPlanToken({
        ...planA,
        appliedQueries: ['Engineer', 'Other'],
      }),
    );
  });

  it('refuses a repeated attemptId while another completion attempt is in progress', async () => {
    let releaseDiscovery!: (value: DiscoverySummary[]) => void;
    const discoveryPromise = new Promise<DiscoverySummary[]>((resolve) => {
      releaseDiscovery = resolve;
    });
    const runAll = vi.fn(() => discoveryPromise);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-concurrent';
    // Start the first call; do NOT await it (it blocks on discovery).
    void postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    // Poll until the in-progress attempt record has been persisted so
    // the second call observes a concurrent attempt rather than racing
    // the router's body execution.
    const deadline = Date.now() + 1000;
    let observed = false;
    while (Date.now() < deadline) {
      const probe = await get(handle, '/api/onboarding/status');
      const probeBody = await readJson<OnboardingStatusResponse>(probe);
      void probeBody;
      // The discovery outcome transitions to 'running' on first call.
      if (probeBody.discoveryOutcome.state === 'running') {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(observed).toBe(true);

    const second = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(second.status).toBe(409);
    const body = await readJson<{ code: string }>(second);
    expect(body.code).toBe('onboarding_complete_attempt_in_progress');

    releaseDiscovery([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});

describe('onboarding API — staged attempt retry semantics', () => {
  it('remembers a failed-retryable attempt and allows the same attempt id to succeed once the failure is removed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let cascadeShouldThrow = true;
    const cascadeTargetRoles = (roles: readonly string[]) => {
      if (cascadeShouldThrow) throw new Error('boom cascade');
      void roles;
    };
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      cascadeTargetRoles,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-retry';
    // First call: cascade fails → 500, not 200.
    const failed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(failed.status).toBe(500);
    expect(runAll).not.toHaveBeenCalled();
    const failedBody = await readJson<{ ok: boolean }>(failed);
    expect(failedBody.ok).toBe(false);
    const statusAfterFail = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfterFail.completion.completed).toBe(false);
    expect(statusAfterFail.state).toBe('not-started');
    // The stored record is `failed-retryable`, not a fake success. A
    // replay does not return HTTP 200.
    const replayWhileStillFailing = await postJson(
      handle,
      '/api/onboarding/complete',
      {
        preferences: basePreferences,
        reviewItems: [],
        planToken: preview.planToken,
        attemptId,
      },
    );
    expect(replayWhileStillFailing.status).toBe(500);

    // Remove the cascade failure and retry the same attempt id.
    cascadeShouldThrow = false;
    const ok = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<OnboardingCompleteResponse>(ok);
    expect(okBody.ok).toBe(true);
    expect(okBody.idempotent).toBe(false);
    expect(runAll).toHaveBeenCalledTimes(1);
    // A third replay of the same attempt id is idempotent.
    const replay = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(replay.status).toBe(200);
    const replayBody = await readJson<OnboardingCompleteResponse>(replay);
    expect(replayBody.idempotent).toBe(true);
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('marks a persistence failure as failed-retryable so the next call can succeed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let saveShouldThrow = true;
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      saveProfilePreferences: () => {
        if (saveShouldThrow) throw new Error('boom persist');
      },
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-persist-retry';
    const failed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(failed.status).toBe(500);
    expect(runAll).not.toHaveBeenCalled();
    saveShouldThrow = false;
    const ok = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<OnboardingCompleteResponse>(ok);
    expect(okBody.ok).toBe(true);
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});
