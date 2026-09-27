import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';

import type { JobDatabase } from '../db/database.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';
import { unavailableCredentialResolver } from '../discovery/credentialResolver.js';
import {
  loadOnboardingProgress,
  resetOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingProgressLoadResult,
  type OnboardingProgressStore,
} from '../repositories/onboarding-repository.js';
import { createDatabaseOnboardingProgressStore } from '../repositories/onboarding-repository.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import {
  DEFAULT_SEARCH_PROFILE,
  searchProfileSchema,
  type SearchProfile,
} from '../config/search-profile.js';
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
import type { SourceRepository as SourceRepositoryType } from '../repositories/source-repository.js';
import type { LegacyPreferences } from '../preferences/profilePreferencesAdapters.js';

export interface OnboardingRouteOptions {
  database: JobDatabase;
  sourceRepository: SourceRepositoryType;
  coordinator?: Pick<DiscoveryCoordinator, 'runAll'>;
  credentialResolver?: CredentialResolver;
  candidateProfilePath?: string;
  profilePreferencesPath?: string;
  scoringConfigPath?: string;
  /**
   * Test seam: override the onboarding progress store. Production
   * uses `createDatabaseOnboardingProgressStore(database)`.
   */
  progressStore?: OnboardingProgressStore;
  /**
   * Test seam: override profile-preference persistence. Production
   * uses `saveUnifiedProfilePreferences`.
   */
  saveProfilePreferences?: (
    path: string | undefined,
    prefs: LegacyPreferences,
  ) => void;
  /**
   * Test seam: override source query role cascading. Production uses
   * `sourceRepository.cascadeTargetRoles`.
   */
  cascadeTargetRoles?: (roles: readonly string[]) => void;
  /**
   * Test seam: override resumable-progress deletion. Production uses
   * `resetOnboardingProgress(store, profileId)`. Throwing from this
   * function must roll back the surrounding database transaction so
   * finalization remains atomic.
   */
  deleteOnboardingProgress?: (profileId: string) => void;
  /**
   * Test seam: override the provider descriptor list used by the
   * plan builder. Production builds descriptors from
   * `providerRegistry.list()` after resolving credentials through
   * `credentialResolver.status`. Tests use this to inject a
   * credential-required provider without standing up a full
   * JobProvider implementation.
   */
  providerDescriptors?: readonly Parameters<
    typeof buildOnboardingSearchPlan
  >[0]['providerDescriptors'][number][];
  /** Test seam: simulate bounded transient local-service readiness failures. */
  statusReadinessFailures?: number;
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
  /** True when a saved edit should resume on the next /onboarding visit. */
  readonly resumable: boolean;
  readonly startedAt: string | null;
}

export interface OnboardingStatusResponse {
  readonly state: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  readonly profileId: string;
  readonly onboardingStep?: OnboardingProgressSnapshot['onboardingStep'];
  readonly question?: OnboardingQuestion | null;
  readonly resumeKind?: 'stored' | 'fresh' | 'editing-existing';
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

type AttemptState = 'in-progress' | 'failed-retryable' | 'completed';

type AttemptLastStage =
  | 'started'
  | 'preview-rebuilt'
  | 'profile-persisted'
  | 'cascaded'
  | 'finalized'
  | 'discovery';

interface AttemptRecord {
  readonly state: AttemptState;
  readonly lastCompletedStage: AttemptLastStage;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  /**
   * Immutable terminal response for a `completed` attempt. Used by
   * idempotent replays so the result does not depend on the mutable
   * global `onboardingDiscoveryOutcome:<profileId>` row (which a
   * later search-only retry can overwrite).
   */
  readonly response: OnboardingCompleteResponse | null;
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

const ZERO_OUTCOME: OnboardingDiscoveryOutcome = {
  state: 'not-started',
  message: null,
  summariesCount: 0,
  completedAt: null,
  attemptId: null,
};

const ZERO_EDIT_SESSION: OnboardingEditSession = {
  editing: false,
  resumable: false,
  startedAt: null,
};

function isDiscoveryOutcomeState(
  value: unknown,
): value is OnboardingDiscoveryOutcomeState {
  return (
    value === 'not-started' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'unavailable'
  );
}

function isAttemptState(value: unknown): value is AttemptState {
  return (
    value === 'in-progress' ||
    value === 'failed-retryable' ||
    value === 'completed'
  );
}

function isAttemptLastStage(value: unknown): value is AttemptLastStage {
  return (
    value === 'started' ||
    value === 'preview-rebuilt' ||
    value === 'profile-persisted' ||
    value === 'cascaded' ||
    value === 'finalized' ||
    value === 'discovery'
  );
}

function safeBlockMessage(error: Error): string {
  const message = error.message;
  if (message.toLowerCase().includes('json')) {
    return 'Stored onboarding progress is unreadable.';
  }
  if (message.toLowerCase().includes('schema')) {
    return 'Stored onboarding progress does not match the current schema.';
  }
  return 'Onboarding progress could not be loaded.';
}

function safeSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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

function safeFinalizeError(): string {
  return 'Onboarding completion could not be finalized.';
}

function safeDiscoveryMessage(): string {
  // Coordinator/provider exceptions can contain credentials, secret
  // URLs, paths, and raw diagnostics. The onboarding outcome is a
  // durable public projection, so use fixed safe copy here.
  return 'Discovery could not complete. Review Sources and retry.';
}

function safeEditDiscardError(): string {
  return 'Onboarding edit could not be discarded; progress remains available for resume.';
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
    const parsed = JSON.parse(row.setting_value_json) as {
      state?: unknown;
      message?: unknown;
      summariesCount?: unknown;
      completedAt?: unknown;
      attemptId?: unknown;
    };
    return {
      state: isDiscoveryOutcomeState(parsed.state)
        ? parsed.state
        : 'not-started',
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
      resumable?: unknown;
      startedAt?: unknown;
    };
    return {
      editing: parsed.editing === true,
      resumable: parsed.resumable === true || parsed.editing === true,
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
  if (!session.editing && !session.resumable) {
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

function readAttemptRecord(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
): AttemptRecord | null {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingAttemptKey(profileId, attemptId));
  if (row === undefined) return null;
  try {
    const parsed = JSON.parse(row.setting_value_json) as {
      state?: unknown;
      lastCompletedStage?: unknown;
      errorMessage?: unknown;
      createdAt?: unknown;
      response?: unknown;
    };
    if (
      isAttemptState(parsed.state) &&
      isAttemptLastStage(parsed.lastCompletedStage) &&
      typeof parsed.createdAt === 'string'
    ) {
      const parsedResponse = parseStoredResponse(parsed.response);
      return {
        state: parsed.state,
        lastCompletedStage: parsed.lastCompletedStage,
        errorMessage:
          typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
        createdAt: parsed.createdAt,
        response: parsedResponse,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

function parseStoredResponse(
  value: unknown,
): OnboardingCompleteResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['ok'] !== 'boolean' ||
    typeof candidate['idempotent'] !== 'boolean' ||
    typeof candidate['attemptId'] !== 'string' ||
    candidate['attemptId'].length > 128 ||
    typeof candidate['discoveryOutcome'] !== 'object' ||
    candidate['discoveryOutcome'] === null
  ) {
    return null;
  }
  const outcome = candidate['discoveryOutcome'] as {
    state?: unknown;
    message?: unknown;
    summariesCount?: unknown;
    completedAt?: unknown;
    attemptId?: unknown;
  };
  if (!isDiscoveryOutcomeState(outcome.state)) return null;
  if (typeof outcome.message === 'string' && outcome.message.length > 240) {
    return null;
  }
  if (
    typeof outcome.summariesCount === 'number' &&
    (!Number.isInteger(outcome.summariesCount) || outcome.summariesCount < 0)
  ) {
    return null;
  }
  return {
    ok: candidate['ok'],
    idempotent: candidate['idempotent'],
    attemptId: candidate['attemptId'],
    discoveryOutcome: {
      state: outcome.state,
      message: typeof outcome.message === 'string' ? outcome.message : null,
      summariesCount:
        typeof outcome.summariesCount === 'number' ? outcome.summariesCount : 0,
      completedAt:
        typeof outcome.completedAt === 'string' ? outcome.completedAt : null,
      attemptId:
        typeof outcome.attemptId === 'string' ? outcome.attemptId : null,
    },
    ...(typeof candidate['cascadeError'] === 'string' &&
    candidate['cascadeError'].length <= 240
      ? { cascadeError: candidate['cascadeError'] }
      : {}),
    ...(typeof candidate['saveError'] === 'string' &&
    candidate['saveError'].length <= 240
      ? { saveError: candidate['saveError'] }
      : {}),
  };
}

function writeAttemptRecord(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
  record: AttemptRecord,
): void {
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingAttemptKey(profileId, attemptId), JSON.stringify(record));
}

function storeTerminalAttempt(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
  terminalResponse: OnboardingCompleteResponse,
): void {
  database.transaction(() => {
    writeDiscoveryOutcome(
      database,
      profileId,
      terminalResponse.discoveryOutcome,
    );
    writeAttemptRecord(database, profileId, attemptId, {
      state: 'completed',
      lastCompletedStage: 'discovery',
      errorMessage: null,
      createdAt: new Date().toISOString(),
      response: terminalResponse,
    });
  })();
}

function clearAttemptRecord(
  database: JobDatabase,
  profileId: string,
  attemptId: string,
): void {
  database
    .prepare('DELETE FROM app_settings WHERE setting_key = ?')
    .run(onboardingAttemptKey(profileId, attemptId));
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
  // 1. Invalid progress always blocks, even with an active edit
  //    session. The blocked screen offers recovery without losing the
  //    completion marker or the edit-session marker.
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
  if (load.kind === 'storage-failure') {
    return {
      ...base,
      state: 'blocked',
      blockKind: 'storage-failure',
      blockMessage: safeBlockMessage(load.error),
    };
  }
  // 2. Active editing takes precedence over the completed view, but
  //    only when progress is valid or genuinely missing. The wizard
  //    must never replace invalid progress with a profile-derived draft.
  if (editSession.editing || editSession.resumable) {
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
    // Invalid kinds already returned above and valid returned above;
    // in an active edit the only remaining load kind is genuinely
    // missing, so use the profile-derived draft.
    return {
      ...base,
      state: 'in-progress',
      onboardingStep: 'preferences',
      question: null,
      resumeKind: 'editing-existing',
      ...(prefilledDraft === null ? {} : { prefilledDraft }),
      ...(planToken === null ? {} : { planToken }),
    };
  }
  // 3. Completed state (with the marker as the authoritative signal).
  if (completion.completed) {
    return {
      ...base,
      state: 'completed',
    };
  }
  // 4. Ordinary valid progress.
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
  // 5. Missing progress (no edit session, not completed) → fresh
  //    first-run state with optional profile-derived prefill.
  return {
    ...base,
    state: 'not-started',
    question: null,
    ...(prefilledDraft === null ? {} : { prefilledDraft }),
    ...(planToken === null ? {} : { planToken }),
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
  attemptId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
});

const startEditRequestSchema = z.strictObject({}).optional();

const endEditRequestSchema = z.strictObject({
  keepProgress: z.boolean().optional(),
});

const resetRequestSchema = z
  .strictObject({
    resetCompletion: z.boolean().optional(),
  })
  .optional();

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
  let remainingStatusReadinessFailures = Math.max(
    0,
    Math.floor(options.statusReadinessFailures ?? 0),
  );
  const {
    database,
    sourceRepository,
    coordinator,
    candidateProfilePath,
    profilePreferencesPath,
    scoringConfigPath,
  } = options;
  const credentialResolver =
    options.credentialResolver ?? unavailableCredentialResolver;
  const store: OnboardingProgressStore =
    options.progressStore ?? createDatabaseOnboardingProgressStore(database);
  const saveProfilePreferencesFn =
    options.saveProfilePreferences ?? saveUnifiedProfilePreferences;
  const cascadeTargetRolesFn =
    options.cascadeTargetRoles ??
    ((roles: readonly string[]) => {
      if (roles.length > 0) sourceRepository.cascadeTargetRoles([...roles]);
    });
  const deleteOnboardingProgressFn =
    options.deleteOnboardingProgress ??
    ((profileId: string) => {
      resetOnboardingProgress(store, profileId);
    });

  function loadLegacySearchProfile(): SearchProfile {
    const row = database
      .prepare<
        [string],
        { setting_value_json: string }
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get('searchProfile');
    if (row === undefined) return DEFAULT_SEARCH_PROFILE;
    try {
      return searchProfileSchema.parse(
        JSON.parse(row.setting_value_json) as unknown,
      );
    } catch {
      return DEFAULT_SEARCH_PROFILE;
    }
  }

  function loadLegacyTargetRoles(): string[] {
    const row = database
      .prepare<
        [string],
        { setting_value_json: string }
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get('targetRoles');
    if (row !== undefined) {
      try {
        const parsed: unknown = JSON.parse(row.setting_value_json);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((role): role is string => typeof role === 'string')
        ) {
          return parsed;
        }
      } catch {
        // Use the same neutral defaults as the existing profile adapter.
      }
    }
    return [
      'Systems Administrator',
      'Network Administrator',
      'SOC Analyst',
      'Technical Support Engineer',
    ];
  }

  function loadPreferencesForFirstCompletion(): LegacyPreferences {
    return {
      candidateProfile: loadCandidateProfile(
        candidateProfilePath,
        profilePreferencesPath,
      ),
      searchProfile: loadLegacySearchProfile(),
      sourceQueryRoles: loadLegacyTargetRoles(),
      scoringConfig: loadScoringConfig(
        scoringConfigPath,
        profilePreferencesPath,
      ),
    };
  }
  const providerDescriptorsOverride = options.providerDescriptors;
  // A completion attempt is profile-scoped, even though its durable
  // idempotency record is keyed by attempt id. This prevents two clients,
  // reloads, or independently generated attempt ids from persisting and
  // starting discovery concurrently for the same active profile.
  const activeCompletionProfiles = new Set<string>();

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

  /**
   * The single authoritative async plan path. Every code path that
   * builds a plan — status prefill, preview, draft-from-profile, and
   * completion — calls this. Credential status is resolved on every
   * call through the configured `credentialResolver` so a credential
   * added while the app is open is reflected by the next request.
   */
  async function buildPlan(
    preferences: OnboardingValidatedPreferences,
    confirmedTitles: readonly string[],
  ): Promise<{ plan: OnboardingSearchPlan; planToken: string }> {
    const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
    const searchProfile = unified?.searchProfile ?? DEFAULT_SEARCH_PROFILE;
    const sources = sourceRepository.list();
    type Descriptor = Parameters<
      typeof buildOnboardingSearchPlan
    >[0]['providerDescriptors'][number];
    let descriptors: Descriptor[];
    if (providerDescriptorsOverride !== undefined) {
      descriptors = [...providerDescriptorsOverride];
    } else {
      descriptors = [];
      await providerRegistry.loadProviders();
      for (const provider of providerRegistry.list()) {
        descriptors.push({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          capabilities: provider.capabilities,
          // Replaced by a live status read below for credential-bearing
          // providers; this placeholder is never passed to the plan.
          credentialStatus: { configured: false, available: false },
          supportState:
            provider.capabilities.interactiveBrowser === true
              ? ('supported-with-configuration' as const)
              : ('supported' as const),
        });
      }
    }
    const descriptorsWithCurrentCredentials: Descriptor[] = [];
    for (const descriptor of descriptors) {
      if (!descriptor.capabilities.requiresCredentials) {
        descriptorsWithCurrentCredentials.push({
          ...descriptor,
          credentialStatus: { configured: true, available: true },
        });
        continue;
      }
      let credentialStatus = { configured: false, available: false };
      try {
        credentialStatus = await credentialResolver.status(descriptor.id);
      } catch {
        // A missing or failing resolver is conservative: this source
        // cannot be considered ready.
      }
      descriptorsWithCurrentCredentials.push({
        ...descriptor,
        credentialStatus,
      });
    }
    const plan = buildOnboardingSearchPlan({
      preferences,
      confirmedTitles,
      searchProfile: { maxQueriesPerRun: searchProfile.maxQueriesPerRun },
      sources,
      providerDescriptors: descriptorsWithCurrentCredentials,
    });
    const planToken = computeOnboardingPlanToken(plan);
    return { plan, planToken };
  }

  async function loadPrefilledDraft(profileId: string): Promise<{
    draft: OnboardingPreferencesDraft | null;
    planToken: string | null;
  }> {
    try {
      const profile = loadCandidateProfile(
        candidateProfilePath,
        profilePreferencesPath,
      );
      if (profile.id !== profileId) {
        return { draft: null, planToken: null };
      }
      const validated = pickPreferencesFromProfile(profile);
      const draft = buildPrefilledDraft(profile);
      const { plan, planToken } = await buildPlan(
        validated,
        validated.desiredJobTitles,
      );
      void plan;
      return { draft, planToken };
    } catch {
      return { draft: null, planToken: null };
    }
  }

  function buildPrefilledDraft(
    profile: ReturnType<typeof loadCandidateProfile>,
  ): OnboardingPreferencesDraft {
    const validated = pickPreferencesFromProfile(profile);
    return toPreferencesDraft(validated);
  }

  router.get(
    '/status',
    asyncRoute(async (_request, response) => {
      if (remainingStatusReadinessFailures > 0) {
        remainingStatusReadinessFailures -= 1;
        response.status(503).json({
          error: 'Onboarding status service is temporarily unavailable.',
          code: 'onboarding_status_not_ready',
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
      // loadOnboardingProgress already converts getSetting() exceptions
      // into a storage-failure load result, so the buildStatus switch
      // handles every blocked kind without an extra try/catch.
      const load = loadOnboardingProgress(store, profileId);
      let prefilledDraft: OnboardingPreferencesDraft | null = null;
      let planToken: string | null = null;
      // Only generate the plan token + prefilled draft when the
      // status will actually surface them (missing progress, including
      // an active edit session with no snapshot). Invalid progress is
      // never replaced with a profile-derived draft.
      if (load.kind === 'missing') {
        const result = await loadPrefilledDraft(profileId);
        prefilledDraft = result.draft;
        planToken = result.planToken;
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
        const { plan, planToken } = await buildPlan(
          parsed.data.preferences,
          cleanedTitles,
        );
        response.json({
          plan,
          planToken,
          confirmationAllowed: plan.confirmationAllowed,
        });
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
        const draft = buildPrefilledDraft(profile);
        const { plan, planToken } = await buildPlan(
          pickPreferencesFromProfile(profile),
          draft.desiredJobTitles,
        );
        void plan;
        response.json({
          draft,
          planToken,
          confirmationAllowed: plan.confirmationAllowed,
        });
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
      const parsed = resetRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding reset payload is invalid.',
          code: 'onboarding_reset_validation_failed',
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
      try {
        const resetCompletion = parsed.data?.resetCompletion === true;
        database.transaction(() => {
          deleteOnboardingProgressFn(profileId);
          writeEditSession(database, profileId, ZERO_EDIT_SESSION);
          if (resetCompletion) {
            clearCompletionMarker(database, profileId);
            writeDiscoveryOutcome(database, profileId, ZERO_OUTCOME);
          }
        })();
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
      const parsed = startEditRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding edit-start payload is invalid.',
          code: 'onboarding_edit_start_validation_failed',
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
      writeEditSession(database, profileId, {
        editing: true,
        resumable: true,
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
        // Discard path: if the resumable-progress delete fails, do
        // NOT erase the edit session — leave it active so the user
        // can retry. Return a bounded failure.
        try {
          deleteOnboardingProgressFn(profileId);
        } catch (error) {
          response.status(500).json({
            error: safeEditDiscardError(),
            code: 'onboarding_edit_discard_failed',
          });
          void error;
          return;
        }
        writeEditSession(database, profileId, ZERO_EDIT_SESSION);
      } else {
        // Save-and-leave: the editor is inactive, but the saved edit
        // remains resumable on the next /onboarding visit.
        const current = readEditSession(database, profileId);
        writeEditSession(database, profileId, {
          editing: false,
          resumable: true,
          startedAt: current.startedAt,
        });
      }
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

      // Idempotency: completed attempts return the immutable stored
      // response (NOT the mutable global discovery-outcome row).
      const stored = readAttemptRecord(database, profileId, attemptId);
      if (stored?.state === 'in-progress') {
        response.status(409).json({
          error:
            'A completion attempt with this id is already running. Retry once it finishes.',
          code: 'onboarding_complete_attempt_in_progress',
        });
        return;
      }
      if (stored?.state === 'completed') {
        const terminal = stored.response;
        if (terminal !== null) {
          // Return the immutable terminal result exactly as first recorded.
          // The request is idempotent because no side effect is repeated;
          // the stored response itself is not reconstructed or rewritten.
          response.json(terminal);
          return;
        }
        // Defensive: a completed record without a valid terminal response
        // is corrupt; never turn it into a pseudo-success.
        response.status(500).json({
          error: 'The saved onboarding completion result is unavailable.',
          code: 'onboarding_complete_attempt_corrupt',
        });
        return;
      }
      if (
        stored?.state === 'failed-retryable' &&
        stored.lastCompletedStage === 'discovery' &&
        stored.response !== null
      ) {
        // Discovery already ran; only its durable terminal projection
        // failed to persist. Retry persistence, never discovery/profile
        // writes, then return the original terminal response.
        try {
          storeTerminalAttempt(database, profileId, attemptId, stored.response);
          response.json(stored.response);
        } catch {
          response.status(500).json({
            error:
              'The completed search result could not be saved. Retry again.',
            code: 'onboarding_complete_outcome_finalize_failed',
          });
        }
        return;
      }
      if (stored?.state === 'failed-retryable') {
        clearAttemptRecord(database, profileId, attemptId);
      }

      if (activeCompletionProfiles.has(profileId)) {
        response.status(409).json({
          error: 'Another onboarding completion attempt is already running.',
          code: 'onboarding_complete_profile_in_progress',
        });
        return;
      }
      const completion = readCompletionMarker(database, profileId);
      const editSession = readEditSession(database, profileId);
      if (
        completion.completed &&
        !editSession.editing &&
        !editSession.resumable
      ) {
        response.status(409).json({
          error:
            'Onboarding is already complete. Start an edit or retry the saved search instead.',
          code: 'onboarding_complete_already_completed',
        });
        return;
      }
      activeCompletionProfiles.add(profileId);
      let completionProfileReleased = false;
      const releaseCompletionProfile = (): void => {
        if (completionProfileReleased) return;
        completionProfileReleased = true;
        activeCompletionProfiles.delete(profileId);
      };
      response.once('finish', releaseCompletionProfile);
      response.once('close', releaseCompletionProfile);

      writeAttemptRecord(database, profileId, attemptId, {
        state: 'in-progress',
        lastCompletedStage: 'started',
        errorMessage: null,
        createdAt: new Date().toISOString(),
        response: null,
      });

      // Step 1 — rebuild and compare plan token.
      let plan: OnboardingSearchPlan;
      let computedToken: string;
      try {
        const rebuilt = await buildPlan(
          preferences,
          preferences.desiredJobTitles,
        );
        plan = rebuilt.plan;
        computedToken = rebuilt.planToken;
      } catch (error) {
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'started',
          errorMessage: safeCompletionError(error),
          createdAt: new Date().toISOString(),
          response: null,
        });
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_complete_plan_failed',
        });
        return;
      }
      if (computedToken !== planToken) {
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'preview-rebuilt',
          errorMessage:
            'The search plan changed since you reviewed it. Please re-review and confirm.',
          createdAt: new Date().toISOString(),
          response: null,
        });
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
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'preview-rebuilt',
          errorMessage:
            'The search plan cannot be confirmed. Add at least one ready source and one query.',
          createdAt: new Date().toISOString(),
          response: null,
        });
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
        const savedUnified = loadUnifiedLegacyPreferences(
          profilePreferencesPath,
        );
        if (savedUnified === null && profilePreferencesPath === undefined) {
          throw new Error(
            'The unified profile-preferences path is unavailable.',
          );
        }
        const unified = savedUnified ?? loadPreferencesForFirstCompletion();
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
        saveProfilePreferencesFn(profilePreferencesPath, {
          ...unified,
          candidateProfile: nextProfile,
          sourceQueryRoles: [...plan.appliedQueries],
        });
      } catch (error) {
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'preview-rebuilt',
          errorMessage: safeCompletionError(error),
          createdAt: new Date().toISOString(),
          response: null,
        });
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_complete_persist_failed',
        });
        return;
      }

      // Step 3 — cascade executable queries into source rows.
      try {
        cascadeTargetRolesFn(plan.appliedQueries);
      } catch {
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'profile-persisted',
          errorMessage: safeCascadeError(),
          createdAt: new Date().toISOString(),
          response: null,
        });
        response.status(500).json({
          ok: false,
          error: safeCascadeError(),
          code: 'onboarding_complete_cascade_failed',
        });
        return;
      }

      // Step 4 — finalize atomically. If the resumable-progress delete
      // throws, the database.transaction() rolls back the completion
      // marker and the edit-session clear. The attempt is marked
      // failed-retryable and no discovery is started.
      let terminalOutcome: OnboardingDiscoveryOutcome;
      try {
        database.transaction(() => {
          writeCompletionMarker(database, profileId);
          deleteOnboardingProgressFn(profileId);
          writeEditSession(database, profileId, ZERO_EDIT_SESSION);
        })();
      } catch (error) {
        // Finalization failed; the database.transaction() has rolled
        // back, so the completion marker is absent and the edit
        // session is still active. The attempt is retryable. No
        // second best-effort mutation is performed here.
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'cascaded',
          errorMessage: safeFinalizeError(),
          createdAt: new Date().toISOString(),
          response: null,
        });
        response.status(500).json({
          error: safeFinalizeError(),
          code: 'onboarding_complete_finalize_failed',
        });
        void error;
        return;
      }

      // Step 5 — invoke discovery exactly once. The attempt remains
      // `in-progress` until discovery finishes so a concurrent call
      // cannot duplicate it. Discovery success AND failure both
      // record a terminal `completed` attempt whose stored response
      // is replayed by any duplicate /complete request.
      if (coordinator === undefined) {
        terminalOutcome = {
          state: 'unavailable',
          message: 'Discovery coordinator is unavailable.',
          summariesCount: 0,
          completedAt: new Date().toISOString(),
          attemptId,
        };
      } else {
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
          const completedAtDiscovery = new Date().toISOString();
          terminalOutcome = {
            state: 'succeeded',
            message: null,
            summariesCount: Array.isArray(summaries)
              ? (summaries as readonly DiscoverySummary[]).length
              : 0,
            completedAt: completedAtDiscovery,
            attemptId,
          };
        } catch {
          const completedAtDiscovery = new Date().toISOString();
          terminalOutcome = {
            state: 'failed',
            message: safeDiscoveryMessage(),
            summariesCount: 0,
            completedAt: completedAtDiscovery,
            attemptId,
          };
        }
      }
      const terminalResponse: OnboardingCompleteResponse = {
        ok: true,
        idempotent: false,
        attemptId,
        discoveryOutcome: terminalOutcome,
      };
      try {
        storeTerminalAttempt(database, profileId, attemptId, terminalResponse);
      } catch {
        // Discovery already ran; retain its terminal response in a
        // retryable attempt so a repeated request can persist the
        // outcome without invoking discovery again.
        writeAttemptRecord(database, profileId, attemptId, {
          state: 'failed-retryable',
          lastCompletedStage: 'discovery',
          errorMessage: 'The completed search result could not be saved.',
          createdAt: new Date().toISOString(),
          response: terminalResponse,
        });
        response.status(500).json({
          error: 'The completed search result could not be saved. Retry again.',
          code: 'onboarding_complete_outcome_finalize_failed',
        });
        return;
      }
      response.json(terminalResponse);
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
      } catch {
        const completedAt = new Date().toISOString();
        const outcome: OnboardingDiscoveryOutcome = {
          state: 'failed',
          message: safeDiscoveryMessage(),
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
