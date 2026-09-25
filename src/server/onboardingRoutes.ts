import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';

import type { JobDatabase } from '../db/database.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';
import { unavailableCredentialResolver } from '../discovery/credentialResolver.js';
import { translateError } from '../discovery/discoveryCoordinator.js';
import {
  loadOnboardingProgress,
  resetOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingProgressLoadResult,
  type OnboardingProgressStore,
} from '../repositories/onboarding-repository.js';
import { createDatabaseOnboardingProgressStore } from '../repositories/onboarding-repository.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import {
  loadUnifiedLegacyPreferences,
  saveUnifiedProfilePreferences,
} from '../preferences/profilePreferencesRuntime.js';
import {
  applyConfirmedReviewItems,
  resumeOnboardingProgress,
} from '../onboarding/onboarding-service.js';
import { buildOnboardingSearchPlan } from '../onboarding/search-plan-service.js';
import {
  onboardingProgressSnapshotSchema,
  onboardingValidatedPreferencesSchema,
  onboardingReviewItemSchema,
  toPreferencesDraft,
  pickPreferencesFromProfile,
} from '../schemas/onboarding.js';
import type { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import type { DiscoverySummary } from '../models/discovery.js';
import type {
  OnboardingPreferencesDraft,
  OnboardingProgressSnapshot,
  OnboardingQuestion,
  OnboardingReviewItem,
  OnboardingSearchPlan,
  OnboardingValidatedPreferences,
} from '../models/onboarding.js';
import { DEFAULT_SEARCH_PROFILE } from '../config/search-profile.js';
import type { SourceRepository as SourceRepositoryType } from '../repositories/source-repository.js';

export interface OnboardingRouteOptions {
  database: JobDatabase;
  sourceRepository: SourceRepositoryType;
  coordinator?: DiscoveryCoordinator;
  credentialResolver?: CredentialResolver;
  candidateProfilePath?: string;
  profilePreferencesPath?: string;
}

export type OnboardingDiscoveryOutcomeState =
  | 'not-started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unavailable';

export interface OnboardingDiscoveryOutcome {
  readonly state: OnboardingDiscoveryOutcomeState;
  readonly message: string | null;
  readonly summariesCount: number;
  readonly completedAt: string | null;
  readonly attemptId: string | null;
}

export interface OnboardingEditSession {
  readonly editing: boolean;
  readonly startedAt: string | null;
}

export interface OnboardingStatusResponse {
  readonly state: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  readonly profileId: string;
  readonly onboardingStep?: OnboardingProgressSnapshot['onboardingStep'];
  readonly question?: OnboardingQuestion | null;
  readonly resumeKind?: 'stored' | 'fresh';
  readonly snapshot?: OnboardingProgressSnapshot;
  readonly planToken?: string;
  readonly prefilledDraft?: OnboardingPreferencesDraft;
  readonly discoveryOutcome: OnboardingDiscoveryOutcome;
  readonly editSession: OnboardingEditSession;
  readonly completion: {
    readonly completed: boolean;
    readonly completedAt: string | null;
  };
  readonly blockKind?: 'malformed' | 'unsupported-version' | 'storage-failure';
  readonly blockMessage?: string;
}

export interface OnboardingPreviewResponse {
  readonly plan: OnboardingSearchPlan;
  readonly planToken: string;
  readonly confirmationAllowed: boolean;
}

export interface OnboardingDraftFromProfileResponse {
  readonly draft: OnboardingPreferencesDraft;
  readonly planToken: string;
  readonly confirmationAllowed: boolean;
}

export interface OnboardingCompleteResponse {
  readonly ok: boolean;
  readonly idempotent: boolean;
  readonly attemptId: string;
  readonly discoveryOutcome: OnboardingDiscoveryOutcome;
  readonly cascadeError?: string;
  readonly saveError?: string;
}

function onboardingCompletionKey(profileId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  return `onboardingCompletion:${profileId}`;
}

function onboardingDiscoveryOutcomeKey(profileId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  return `onboardingDiscoveryOutcome:${profileId}`;
}

function onboardingEditSessionKey(profileId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  return `onboardingEditSession:${profileId}`;
}

function onboardingAttemptKey(profileId: string, attemptId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  if (attemptId.trim() === '') throw new Error('An attempt id is required.');
  return `onboardingAttempt:${profileId}:${attemptId}`;
}

interface DiscoveryOutcomeRow {
  readonly state: OnboardingDiscoveryOutcomeState;
  readonly message: string | null;
  readonly summariesCount: number;
  readonly completedAt: string | null;
  readonly attemptId: string | null;
}

const ZERO_OUTCOME: OnboardingDiscoveryOutcome = {
  state: 'not-started',
  message: null,
  summariesCount: 0,
  completedAt: null,
  attemptId: null,
};

const ZERO_EDIT_SESSION: OnboardingEditSession = {
  editing: false,
  startedAt: null,
};

function safeBlockMessage(error: Error): string {
  const message = error.message;
  if (message.toLowerCase().includes('json')) {
    return 'Stored onboarding progress is unreadable.';
  }
  if (message.toLowerCase().includes('schema')) {
    return 'Stored onboarding progress does not match the current schema.';
  }
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('econn')
  ) {
    return 'Onboarding progress could not be read from storage.';
  }
  return 'Onboarding progress could not be loaded.';
}

function safeSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('econn')
  ) {
    return 'Onboarding progress could not be saved to storage.';
  }
  if (message.toLowerCase().includes('explicitly reset')) {
    return 'Existing onboarding progress must be reset before it can be replaced.';
  }
  return 'Onboarding progress could not be saved.';
}

function safeCompletionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes('profile') ||
    message.toLowerCase().includes('preferences')
  ) {
    return 'Onboarding could not be saved to your profile preferences.';
  }
  return 'Onboarding could not be completed.';
}

function safeCascadeError(): string {
  return 'Source query roles could not be cascaded.';
}

function safeFinalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('econn')
  ) {
    return 'Onboarding completion marker could not be written.';
  }
  return 'Onboarding completion could not be finalized.';
}

function readCompletionMarker(
  database: JobDatabase,
  profileId: string,
): { completed: boolean; completedAt: string | null } {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingCompletionKey(profileId));
  if (row === undefined) return { completed: false, completedAt: null };
  try {
    const parsed = JSON.parse(row.setting_value_json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'completedAt' in parsed &&
      typeof (parsed as { completedAt: unknown }).completedAt === 'string'
    ) {
      return {
        completed: true,
        completedAt: (parsed as { completedAt: string }).completedAt,
      };
    }
  } catch {
    // fall through
  }
  return { completed: false, completedAt: null };
}

function readDiscoveryOutcome(
  database: JobDatabase,
  profileId: string,
): OnboardingDiscoveryOutcome {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingDiscoveryOutcomeKey(profileId));
  if (row === undefined) return ZERO_OUTCOME;
  try {
    const parsed = JSON.parse(row.setting_value_json) as DiscoveryOutcomeRow;
    return {
      state: parsed.state,
      message: typeof parsed.message === 'string' ? parsed.message : null,
      summariesCount:
        typeof parsed.summariesCount === 'number' ? parsed.summariesCount : 0,
      completedAt:
        typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      attemptId: typeof parsed.attemptId === 'string' ? parsed.attemptId : null,
    };
  } catch {
    return ZERO_OUTCOME;
  }
}

function writeDiscoveryOutcome(
  database: JobDatabase,
  profileId: string,
  outcome: OnboardingDiscoveryOutcome,
): void {
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingDiscoveryOutcomeKey(profileId), JSON.stringify(outcome));
}

function readEditSession(
  database: JobDatabase,
  profileId: string,
): OnboardingEditSession {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingEditSessionKey(profileId));
  if (row === undefined) return ZERO_EDIT_SESSION;
  try {
    const parsed = JSON.parse(row.setting_value_json) as {
      editing?: unknown;
      startedAt?: unknown;
    };
    return {
      editing: parsed.editing === true,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
    };
  } catch {
    return ZERO_EDIT_SESSION;
  }
}

function writeEditSession(
  database: JobDatabase,
  profileId: string,
  session: OnboardingEditSession,
): void {
  if (!session.editing) {
    database
      .prepare('DELETE FROM app_settings WHERE setting_key = ?')
      .run(onboardingEditSessionKey(profileId));
    return;
  }
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingEditSessionKey(profileId), JSON.stringify(session));
}

function writeCompletionMarker(
  database: JobDatabase,
  profileId: string,
): string {
  const completedAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingCompletionKey(profileId), JSON.stringify({ completedAt }));
  return completedAt;
}

function clearCompletionMarker(database: JobDatabase, profileId: string): void {
  database
    .prepare('DELETE FROM app_settings WHERE setting_key = ?')
    .run(onboardingCompletionKey(profileId));
}

function writeAttempt(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
  payload: unknown,
): void {
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingAttemptKey(profileId, attemptId), JSON.stringify(payload));
}

function readAttempt(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
): Record<string, unknown> | null {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingAttemptKey(profileId, attemptId));
  if (row === undefined) return null;
  try {
    return JSON.parse(row.setting_value_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function computeOnboardingPlanToken(plan: OnboardingSearchPlan): string {
  const canonical = canonicalize({
    appliedQueries: plan.appliedQueries,
    omittedTitles: plan.omittedTitles,
    preferredLocations: plan.preferredLocations,
    remotePreference: plan.remotePreference,
    primaryRadiusMiles: plan.primaryRadiusMiles,
    secondaryRadiusMiles: plan.secondaryRadiusMiles,
    sources: plan.sources.map((source) => ({
      id: source.id,
      displayName: source.displayName,
      employer: source.employer,
      providerId: source.providerId,
      state: source.state,
      reason: source.reason,
    })),
    totalSourceCount: plan.totalSourceCount,
    readySourceCount: plan.readySourceCount,
    needsAttentionSourceCount: plan.needsAttentionSourceCount,
    excludedSourceCount: plan.excludedSourceCount,
    confirmationAllowed: plan.confirmationAllowed,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function buildStatus(
  database: JobDatabase,
  profileId: string,
  load: OnboardingProgressLoadResult,
  prefilledDraft: OnboardingPreferencesDraft | null,
  planToken: string | null,
): OnboardingStatusResponse {
  const completion = readCompletionMarker(database, profileId);
  const discoveryOutcome = readDiscoveryOutcome(database, profileId);
  const editSession = readEditSession(database, profileId);
  const base = {
    profileId,
    completion,
    discoveryOutcome,
    editSession,
  };
  if (completion.completed) {
    return {
      ...base,
      state: 'completed',
    };
  }
  if (load.kind === 'valid') {
    const resumed = resumeOnboardingProgress(load, load.snapshot.answers);
    const question = resumed.kind === 'ready' ? resumed.question : null;
    return {
      ...base,
      state: 'in-progress',
      onboardingStep: load.snapshot.onboardingStep,
      question,
      resumeKind: 'stored',
      snapshot: load.snapshot,
      ...(planToken === null ? {} : { planToken }),
    };
  }
  if (load.kind === 'missing') {
    return {
      ...base,
      state: 'not-started',
      question: null,
      ...(prefilledDraft === null ? {} : { prefilledDraft }),
      ...(planToken === null ? {} : { planToken }),
    };
  }
  if (load.kind === 'malformed') {
    return {
      ...base,
      state: 'blocked',
      blockKind: 'malformed',
      blockMessage: safeBlockMessage(load.error),
    };
  }
  if (load.kind === 'unsupported-version') {
    return {
      ...base,
      state: 'blocked',
      blockKind: 'unsupported-version',
      blockMessage: `Stored onboarding progress uses an unsupported version (${String(load.version)}).`,
    };
  }
  return {
    ...base,
    state: 'blocked',
    blockKind: 'storage-failure',
    blockMessage: safeBlockMessage(load.error),
  };
}

const previewRequestSchema = z.strictObject({
  preferences: onboardingValidatedPreferencesSchema,
  confirmedTitles: z.array(z.string()),
});

const completeRequestSchema = z.strictObject({
  preferences: onboardingValidatedPreferencesSchema,
  reviewItems: z.array(onboardingReviewItemSchema),
  planToken: z.string().min(1),
  attemptId: z.string().min(1),
});

const startEditRequestSchema = z.strictObject({}).optional();

const endEditRequestSchema = z.strictObject({
  keepProgress: z.boolean().optional(),
});

const asyncRoute =
  (handler: (request: Request, response: Response) => void | Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const result = handler(request, response);
    if (result instanceof Promise) {
      result.catch(next);
    }
  };

export function createOnboardingRouter(
  options: OnboardingRouteOptions,
): Router {
  const router = express.Router();
  const {
    database,
    sourceRepository,
    coordinator,
    candidateProfilePath,
    profilePreferencesPath,
  } = options;
  const credentialResolver =
    options.credentialResolver ?? unavailableCredentialResolver;
  const store: OnboardingProgressStore =
    createDatabaseOnboardingProgressStore(database);

  function currentProfileId(): string {
    const profile = loadCandidateProfile(
      candidateProfilePath,
      profilePreferencesPath,
    );
    if (profile.id.trim() === '') {
      throw new Error('Active candidate profile has no id.');
    }
    return profile.id;
  }

  async function loadProviderDescriptors() {
    await providerRegistry.loadProviders();
    type ProviderDescriptorArg = Parameters<
      typeof buildOnboardingSearchPlan
    >[0]['providerDescriptors'][number];
    const out: ProviderDescriptorArg[] = [];
    for (const provider of providerRegistry.list()) {
      const credentialStatus = provider.capabilities.requiresCredentials
        ? await credentialResolver.status(provider.id)
        : { configured: true, available: true };
      out.push({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        capabilities: provider.capabilities,
        credentialStatus,
        supportState:
          provider.capabilities.interactiveBrowser === true
            ? 'supported-with-configuration'
            : 'supported',
      });
    }
    return out;
  }

  async function buildPlan(
    preferences: OnboardingValidatedPreferences,
    confirmedTitles: readonly string[],
  ): Promise<OnboardingSearchPlan> {
    const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
    const searchProfile = unified?.searchProfile ?? DEFAULT_SEARCH_PROFILE;
    const sources = sourceRepository.list();
    const providerDescriptors = await loadProviderDescriptors();
    return buildOnboardingSearchPlan({
      preferences,
      confirmedTitles,
      searchProfile: { maxQueriesPerRun: searchProfile.maxQueriesPerRun },
      sources,
      providerDescriptors,
    });
  }

  async function planFromPreferences(
    preferences: OnboardingValidatedPreferences,
    confirmedTitles: readonly string[],
  ): Promise<{ plan: OnboardingSearchPlan; planToken: string }> {
    const plan = await buildPlan(preferences, confirmedTitles);
    const planToken = computeOnboardingPlanToken(plan);
    return { plan, planToken };
  }

  router.get(
    '/status',
    asyncRoute(async (_request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const load = loadOnboardingProgress(store, profileId);
      let prefilledDraft: OnboardingPreferencesDraft | null = null;
      let planToken: string | null = null;
      if (load.kind === 'missing') {
        try {
          const profile = loadCandidateProfile(
            candidateProfilePath,
            profilePreferencesPath,
          );
          const validated = pickPreferencesFromProfile(profile);
          prefilledDraft = toPreferencesDraft(validated);
          const { plan, planToken: token } = await planFromPreferences(
            validated,
            validated.desiredJobTitles,
          );
          planToken = token;
          // plan is unused here; the client only needs the token + draft
          void plan;
        } catch {
          prefilledDraft = null;
          planToken = null;
        }
      }
      response.json(
        buildStatus(database, profileId, load, prefilledDraft, planToken),
      );
    }),
  );

  router.post(
    '/preview',
    asyncRoute(async (request, response) => {
      try {
        currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const parsed = previewRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding preview payload is invalid.',
          code: 'onboarding_preview_validation_failed',
        });
        return;
      }
      try {
        const cleanedTitles = parsed.data.confirmedTitles
          .map((title) => title.trim())
          .filter((title) => title !== '');
        const { plan, planToken } = await planFromPreferences(
          parsed.data.preferences,
          cleanedTitles,
        );
        const body: OnboardingPreviewResponse = {
          plan,
          planToken,
          confirmationAllowed: plan.confirmationAllowed,
        };
        response.json(body);
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_preview_failed',
        });
      }
    }),
  );

  router.post(
    '/draft-from-profile',
    asyncRoute(async (_request, response) => {
      try {
        currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      try {
        const profile = loadCandidateProfile(
          candidateProfilePath,
          profilePreferencesPath,
        );
        const validated = pickPreferencesFromProfile(profile);
        const draft = toPreferencesDraft(validated);
        const { plan, planToken } = await planFromPreferences(
          validated,
          validated.desiredJobTitles,
        );
        const body: OnboardingDraftFromProfileResponse = {
          draft,
          planToken,
          confirmationAllowed: plan.confirmationAllowed,
        };
        response.json(body);
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_draft_failed',
        });
      }
    }),
  );

  router.post(
    '/save',
    asyncRoute((request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const parsed = z
        .strictObject({
          snapshot: onboardingProgressSnapshotSchema,
        })
        .safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding progress payload is invalid.',
          code: 'onboarding_save_validation_failed',
        });
        return;
      }
      try {
        saveOnboardingProgress(
          store,
          profileId,
          parsed.data.snapshot as OnboardingProgressSnapshot,
        );
        response.json({ ok: true });
      } catch (error) {
        response.status(409).json({
          error: safeSaveError(error),
          code: 'onboarding_save_failed',
        });
      }
    }),
  );

  router.post(
    '/reset',
    asyncRoute((request, response) => {
      z.strictObject({}).parse(request.body ?? {});
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      try {
        resetOnboardingProgress(store, profileId);
        clearCompletionMarker(database, profileId);
        writeDiscoveryOutcome(database, profileId, ZERO_OUTCOME);
        writeEditSession(database, profileId, ZERO_EDIT_SESSION);
        response.json({ ok: true });
      } catch (error) {
        response.status(500).json({
          error: safeSaveError(error),
          code: 'onboarding_reset_failed',
        });
      }
    }),
  );

  router.post(
    '/edit/start',
    asyncRoute((request, response) => {
      startEditRequestSchema.parse(request.body ?? {});
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      writeEditSession(database, profileId, {
        editing: true,
        startedAt: new Date().toISOString(),
      });
      response.json({ ok: true });
    }),
  );

  router.post(
    '/edit/end',
    asyncRoute((request, response) => {
      const parsed = endEditRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding edit-end payload is invalid.',
          code: 'onboarding_edit_end_validation_failed',
        });
        return;
      }
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const keepProgress = parsed.data.keepProgress ?? true;
      if (!keepProgress) {
        try {
          resetOnboardingProgress(store, profileId);
        } catch {
          // best effort
        }
      }
      writeEditSession(database, profileId, ZERO_EDIT_SESSION);
      response.json({ ok: true });
    }),
  );

  router.post(
    '/complete',
    asyncRoute(async (request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch {
        response.status(500).json({
          error: 'Onboarding profile is unavailable.',
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const parsed = completeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding completion payload is invalid.',
          code: 'onboarding_complete_validation_failed',
        });
        return;
      }
      const { preferences, reviewItems, planToken, attemptId } = parsed.data;

      // Idempotency: a repeated attemptId must return the stored outcome.
      const stored = readAttempt(database, profileId, attemptId);
      if (stored !== null && typeof stored === 'object') {
        const storedRecord = stored as Partial<OnboardingCompleteResponse>;
        response.status(200).json({
          ok: storedRecord.ok ?? false,
          idempotent: true,
          attemptId,
          discoveryOutcome: storedRecord.discoveryOutcome ?? ZERO_OUTCOME,
          ...(storedRecord.cascadeError === undefined
            ? {}
            : { cascadeError: storedRecord.cascadeError }),
          ...(storedRecord.saveError === undefined
            ? {}
            : { saveError: storedRecord.saveError }),
        });
        return;
      }

      // Step 1 — rebuild and compare plan token. Mismatches return a
      // refreshed plan so the client can re-review.
      let plan: OnboardingSearchPlan;
      let computedToken: string;
      try {
        const cleanedTitles = preferences.desiredJobTitles;
        const rebuilt = await planFromPreferences(preferences, cleanedTitles);
        plan = rebuilt.plan;
        computedToken = rebuilt.planToken;
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_complete_plan_failed',
        });
        return;
      }
      if (computedToken !== planToken) {
        response.status(409).json({
          error:
            'The search plan changed since you reviewed it. Please re-review and confirm.',
          code: 'onboarding_complete_stale_plan',
          plan,
          planToken: computedToken,
          confirmationAllowed: plan.confirmationAllowed,
        });
        return;
      }
      if (!plan.confirmationAllowed) {
        response.status(409).json({
          error:
            'The search plan cannot be confirmed. Add at least one ready source and one query.',
          code: 'onboarding_complete_not_confirmable',
          plan,
          planToken: computedToken,
          confirmationAllowed: false,
        });
        return;
      }

      // Step 2 — persist profile preferences and sourceQueryRoles.
      try {
        const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
        if (unified === null) {
          response.status(409).json({
            error: 'Unified profile preferences are not available.',
            code: 'onboarding_complete_no_unified',
          });
          return;
        }
        const existing = loadCandidateProfile(
          candidateProfilePath,
          profilePreferencesPath,
        );
        const { desiredSalary, ...rest } = preferences;
        const merged: typeof existing = {
          ...existing,
          ...rest,
          ...(desiredSalary !== null ? { desiredSalary } : {}),
        };
        const nextProfile = applyConfirmedReviewItems(
          merged,
          reviewItems as readonly OnboardingReviewItem[],
        );
        saveUnifiedProfilePreferences(profilePreferencesPath, {
          ...unified,
          candidateProfile: nextProfile,
          sourceQueryRoles: [...plan.appliedQueries],
        });
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_complete_persist_failed',
        });
        return;
      }

      // Step 3 — cascade executable queries into source rows.
      try {
        if (plan.appliedQueries.length > 0) {
          sourceRepository.cascadeTargetRoles([...plan.appliedQueries]);
        }
      } catch {
        writeAttempt(database, profileId, attemptId, {
          ok: false,
          idempotent: false,
          attemptId,
          cascadeError: safeCascadeError(),
        });
        response.status(500).json({
          error: safeCascadeError(),
          code: 'onboarding_complete_cascade_failed',
        });
        return;
      }

      // Step 4 — finalize: completion marker + clear progress + edit
      // session. A failure here means we have saved profile + source
      // changes but did not finalize, so the attempt remains retryable.
      try {
        writeCompletionMarker(database, profileId);
        try {
          resetOnboardingProgress(store, profileId);
        } catch {
          // best effort; the completion marker is authoritative.
        }
        writeEditSession(database, profileId, ZERO_EDIT_SESSION);
      } catch (error) {
        writeAttempt(database, profileId, attemptId, {
          ok: false,
          idempotent: false,
          attemptId,
          cascadeError: safeFinalizeError(error),
        });
        response.status(500).json({
          error: safeFinalizeError(error),
          code: 'onboarding_complete_finalize_failed',
        });
        return;
      }

      // Step 5 — invoke discovery exactly once. The result is persisted
      // as a durable outcome.
      if (coordinator === undefined) {
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'unavailable',
          message: 'Discovery coordinator is unavailable.',
          summariesCount: 0,
          completedAt: new Date().toISOString(),
          attemptId,
        };
        writeDiscoveryOutcome(database, profileId, outcome);
        writeAttempt(database, profileId, attemptId, {
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
        response.json({
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
        return;
      }
      const runningOutcome: OnboardingDiscoveryOutcome = {
        state: 'running',
        message: null,
        summariesCount: 0,
        completedAt: null,
        attemptId,
      };
      writeDiscoveryOutcome(database, profileId, runningOutcome);
      try {
        const summaries = await coordinator.runAll();
        const completedAt = new Date().toISOString();
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'succeeded',
          message: null,
          summariesCount: Array.isArray(summaries)
            ? (summaries as readonly DiscoverySummary[]).length
            : 0,
          completedAt,
          attemptId,
        };
        writeDiscoveryOutcome(database, profileId, outcome);
        writeAttempt(database, profileId, attemptId, {
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
        response.json({
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
      } catch (error) {
        const completedAt = new Date().toISOString();
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'failed',
          message: translateError(error),
          summariesCount: 0,
          completedAt,
          attemptId,
        };
        writeDiscoveryOutcome(database, profileId, outcome);
        writeAttempt(database, profileId, attemptId, {
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
        response.json({
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
      }
    }),
  );

  router.post(
    '/discovery/retry',
    asyncRoute(async (_request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const completion = readCompletionMarker(database, profileId);
      if (!completion.completed) {
        response.status(409).json({
          error: 'Onboarding has not been completed yet.',
          code: 'onboarding_retry_not_completed',
        });
        return;
      }
      if (coordinator === undefined) {
        response.status(409).json({
          error: 'Discovery coordinator is unavailable.',
          code: 'onboarding_retry_no_coordinator',
        });
        return;
      }
      const current = readDiscoveryOutcome(database, profileId);
      if (current.state === 'running') {
        response.status(409).json({
          error: 'Discovery is already running.',
          code: 'onboarding_retry_already_running',
        });
        return;
      }
      const attemptId = `retry-${String(Date.now())}`;
      const running: OnboardingDiscoveryOutcome = {
        state: 'running',
        message: null,
        summariesCount: 0,
        completedAt: null,
        attemptId,
      };
      writeDiscoveryOutcome(database, profileId, running);
      try {
        const summaries = await coordinator.runAll();
        const completedAt = new Date().toISOString();
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'succeeded',
          message: null,
          summariesCount: Array.isArray(summaries)
            ? (summaries as readonly DiscoverySummary[]).length
            : 0,
          completedAt,
          attemptId,
        };
        writeDiscoveryOutcome(database, profileId, outcome);
        response.json({
          ok: true,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
      } catch (error) {
        const completedAt = new Date().toISOString();
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'failed',
          message: translateError(error),
          summariesCount: 0,
          completedAt,
          attemptId,
        };
        writeDiscoveryOutcome(database, profileId, outcome);
        response.json({
          ok: false,
          idempotent: false,
          attemptId,
          discoveryOutcome: outcome,
        });
      }
    }),
  );

  return router;
}
