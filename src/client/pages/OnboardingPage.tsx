import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import {
  api,
  type OnboardingDiscoveryOutcome,
  type OnboardingStatusResponse,
} from '../api.js';
import { PreferencesStep } from '../components/onboarding/PreferencesStep.js';
import { ReviewStep } from '../components/onboarding/ReviewStep.js';
import { SearchPlanStep } from '../components/onboarding/SearchPlanStep.js';
import { LoadingState } from '../components/States.js';
import {
  createEmptyPreferencesDraft,
  firstUnresolvedQuestion,
  getNextOnboardingQuestion,
  getPreviousOnboardingQuestion,
  validateQuestion,
} from '../../schemas/onboarding.js';
import type {
  OnboardingPreferencesDraft,
  OnboardingProgressSnapshot,
  OnboardingQuestion,
  OnboardingReviewItem,
  OnboardingSearchPlan,
  OnboardingValidatedPreferences,
} from '../../models/onboarding.js';

type WizardStep = 'preferences' | 'review' | 'search-plan';

interface NormalizedPlan {
  readonly plan: OnboardingSearchPlan;
  readonly planToken: string;
  readonly confirmationAllowed: boolean;
}

interface CompletionResult {
  readonly ok: boolean;
  readonly idempotent: boolean;
  readonly attemptId: string;
  readonly discoveryOutcome: OnboardingDiscoveryOutcome;
  readonly cascadeError?: string;
  readonly saveError?: string;
}

type SaveOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

function safeSaveMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('econn') ||
    message.toLowerCase().includes('fetch') ||
    message.toLowerCase().includes('readonly')
  ) {
    return 'Onboarding progress could not be saved.';
  }
  if (message.toLowerCase().includes('explicitly reset')) {
    return 'Existing onboarding progress must be reset before it can be replaced.';
  }
  if (message === '') return 'Onboarding progress could not be saved.';
  if (
    message.startsWith('Onboarding progress could not be saved') ||
    message.startsWith('Existing onboarding progress must be reset') ||
    message.startsWith('Onboarding could not be saved') ||
    message.startsWith('Source query roles could not be cascaded') ||
    message.startsWith('Onboarding completion could not be finalized')
  ) {
    return message;
  }
  return 'Onboarding progress could not be saved.';
}

function safeCompletionMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (message === '') return 'Onboarding could not be completed.';
  if (
    message.startsWith('Onboarding could not be saved') ||
    message.startsWith('Onboarding could not be completed') ||
    message.startsWith('The search plan changed since you reviewed it') ||
    message.startsWith('The search plan cannot be confirmed')
  ) {
    return message;
  }
  return 'Onboarding could not be completed.';
}

function isV2Snapshot(value: unknown): value is OnboardingProgressSnapshot & {
  readonly reviewItems: readonly OnboardingReviewItem[];
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { version?: unknown; reviewItems?: unknown };
  return candidate.version === 2 && Array.isArray(candidate.reviewItems);
}

function isOnboardingSearchPlan(value: unknown): value is OnboardingSearchPlan {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OnboardingSearchPlan>;
  return (
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.appliedQueries) &&
    Array.isArray(candidate.omittedTitles) &&
    Array.isArray(candidate.sources) &&
    typeof candidate.confirmationAllowed === 'boolean'
  );
}

export function OnboardingPage() {
  const [status, setStatus] = useState<OnboardingStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryOutcome, setRetryOutcome] = useState<{
    readonly ok: boolean;
    readonly message: string | null;
  } | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await api.onboardingStatus();
      setStatus(next);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Onboarding status could not be loaded.',
      );
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (loadError !== null) {
    return (
      <BlockedView
        title="Onboarding is unavailable"
        message={loadError}
        primaryLabel="Retry"
        onPrimary={() => void loadStatus()}
        secondaryLabel="Open Sources"
        secondaryHref="/sources"
        storageFailure
      />
    );
  }
  if (status === null) {
    return (
      <section className="onboarding-card">
        <LoadingState label="Loading onboarding" />
      </section>
    );
  }
  if (status.completion.completed) {
    return (
      <CompletedView
        status={status}
        outcome={retryOutcome}
        busy={retryBusy}
        onRetry={async () => {
          setRetryBusy(true);
          try {
            const result = await api.retryOnboardingDiscovery();
            setRetryOutcome({
              ok: result.ok,
              message: result.ok
                ? null
                : (result.discoveryOutcome.message ??
                  'Discovery retry failed.'),
            });
            await loadStatus();
          } finally {
            setRetryBusy(false);
          }
        }}
      />
    );
  }
  if (status.state === 'blocked' && status.blockKind !== undefined) {
    const isStorageFailure = status.blockKind === 'storage-failure';
    return (
      <BlockedView
        title={blockTitle(status.blockKind)}
        message={
          status.blockMessage ?? 'Onboarding progress could not be loaded.'
        }
        primaryLabel={isStorageFailure ? 'Retry' : 'Reset onboarding'}
        onPrimary={async () => {
          if (isStorageFailure) {
            await loadStatus();
            return;
          }
          await api.resetOnboardingProgress();
          await loadStatus();
        }}
        secondaryLabel="Open Sources"
        secondaryHref="/sources"
        storageFailure={isStorageFailure}
      />
    );
  }

  return <Wizard status={status} onRefreshStatus={loadStatus} />;
}

function blockTitle(
  kind: 'malformed' | 'unsupported-version' | 'storage-failure',
): string {
  switch (kind) {
    case 'malformed':
      return 'Onboarding progress is unreadable';
    case 'unsupported-version':
      return 'Onboarding progress uses an unsupported version';
    case 'storage-failure':
      return 'Onboarding progress could not be loaded';
  }
}

function BlockedView({
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  secondaryHref,
  storageFailure,
}: {
  readonly title: string;
  readonly message: string;
  readonly primaryLabel: string;
  readonly onPrimary: () => void | Promise<void>;
  readonly secondaryLabel: string;
  readonly secondaryHref: string;
  readonly storageFailure: boolean;
}) {
  const footnote = storageFailure
    ? 'Retry loading to try again. Leaving returns to the application without changing anything.'
    : 'Resetting clears the stored progress so you can start fresh. It does not change your candidate profile, sources, jobs, applications, or scoring data.';
  return (
    <section
      className="onboarding-card onboarding-blocked"
      aria-labelledby="blocked-title"
    >
      <h2 id="blocked-title" className="onboarding-question-title">
        {title}
      </h2>
      <p className="onboarding-question-copy" role="status">
        {message}
      </p>
      <p className="onboarding-footnote">{footnote}</p>
      <div className="onboarding-actions">
        <div className="onboarding-actions-left">
          <button
            type="button"
            className="button primary"
            onClick={() => void onPrimary()}
          >
            {primaryLabel}
          </button>
          <Link className="button secondary" to={secondaryHref}>
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

function CompletedView({
  status,
  outcome,
  busy,
  onRetry,
}: {
  readonly status: OnboardingStatusResponse;
  readonly outcome: {
    readonly ok: boolean;
    readonly message: string | null;
  } | null;
  readonly busy: boolean;
  readonly onRetry: () => Promise<void>;
}) {
  const discovery = status.discoveryOutcome;
  const heading = (() => {
    switch (discovery.state) {
      case 'succeeded':
        return 'Search completed';
      case 'failed':
        return 'Preferences saved, search failed';
      case 'unavailable':
        return 'Preferences saved, discovery unavailable';
      case 'running':
        return 'Search in progress';
      case 'not-started':
        return 'Preferences saved, search has not run';
    }
  })();
  const body = (() => {
    switch (discovery.state) {
      case 'succeeded':
        return `Discovery completed for ${String(discovery.summariesCount)} source run${discovery.summariesCount === 1 ? '' : 's'}.`;
      case 'failed':
        return (
          discovery.message ?? 'The most recent discovery run did not finish.'
        );
      case 'unavailable':
        return 'The discovery coordinator is unavailable. Retry search once it is back online.';
      case 'running':
        return 'Discovery is running. A second start is blocked until it finishes.';
      case 'not-started':
        return 'Onboarding finished but discovery has not run yet.';
    }
  })();
  const allowRetry =
    discovery.state === 'failed' ||
    discovery.state === 'unavailable' ||
    discovery.state === 'not-started';
  return (
    <section className="onboarding-card onboarding-completed">
      <h2 className="onboarding-question-title">{heading}</h2>
      <p className="onboarding-question-copy">{body}</p>
      {status.completion.completedAt !== null ? (
        <p className="onboarding-footnote" role="status">
          Completed at {status.completion.completedAt}
        </p>
      ) : undefined}
      {outcome !== null && !outcome.ok && outcome.message !== null ? (
        <p className="onboarding-save-error" role="alert">
          {outcome.message}
        </p>
      ) : undefined}
      <div className="onboarding-actions">
        <div className="onboarding-actions-left">
          {allowRetry ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void onRetry()}
            >
              {busy ? 'Retrying…' : 'Retry search'}
            </button>
          ) : undefined}
          <Link className="button secondary" to="/jobs">
            Open Jobs
          </Link>
          <Link className="button secondary" to="/sources">
            Open Sources
          </Link>
        </div>
      </div>
    </section>
  );
}

interface WizardProps {
  readonly status: OnboardingStatusResponse;
  readonly onRefreshStatus: () => Promise<void>;
}

function Wizard({ status, onRefreshStatus }: WizardProps) {
  const initialDraft = useMemo<OnboardingPreferencesDraft>(() => {
    if (isV2Snapshot(status.snapshot)) return status.snapshot.answers;
    if (status.prefilledDraft !== undefined) {
      return status.prefilledDraft as unknown as OnboardingPreferencesDraft;
    }
    return createEmptyPreferencesDraft();
  }, [status]);

  const initialReviewItems = useMemo<readonly OnboardingReviewItem[]>(() => {
    if (isV2Snapshot(status.snapshot)) return status.snapshot.reviewItems;
    return [];
  }, [status]);

  const initialStep: WizardStep =
    isV2Snapshot(status.snapshot) &&
    status.snapshot.onboardingStep === 'search-plan'
      ? 'search-plan'
      : isV2Snapshot(status.snapshot) &&
          status.snapshot.onboardingStep === 'review'
        ? 'review'
        : 'preferences';
  const [draft, setDraft] = useState<OnboardingPreferencesDraft>(initialDraft);
  const [reviewItems, setReviewItems] =
    useState<readonly OnboardingReviewItem[]>(initialReviewItems);
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [question, setQuestion] = useState<OnboardingQuestion>(
    status.question ?? firstUnresolvedQuestion(initialDraft) ?? 'desired-work',
  );
  const [preferencesErrors, setPreferencesErrors] = useState<
    ReturnType<typeof validateQuestion>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [normalizedPlan, setNormalizedPlan] = useState<NormalizedPlan | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [completionResult, setCompletionResult] =
    useState<CompletionResult | null>(null);
  const inFlightRef = useRef(false);

  const snapshot = useMemo<OnboardingProgressSnapshot>(
    () => ({
      version: 2,
      onboardingStep: step,
      currentQuestion: question,
      answers: draft,
      reviewItems,
    }),
    [draft, question, reviewItems, step],
  );

  const validatedPreferences = useMemo<OnboardingValidatedPreferences | null>(
    () => buildValidatedPreferences(draft),
    [draft],
  );

  const saveDestination = useCallback(
    async (
      destination: OnboardingProgressSnapshot,
    ): Promise<SaveOutcome<true>> => {
      setSaving(true);
      setSaveError(null);
      try {
        await api.saveOnboardingProgress(destination);
        return { ok: true, value: true };
      } catch (error) {
        setSaveError(safeSaveMessage(error));
        return { ok: false, error: safeSaveMessage(error) };
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const refreshPreview = useCallback(async () => {
    if (validatedPreferences === null) {
      setNormalizedPlan(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const preview = await api.onboardingPreview({
        preferences: validatedPreferences,
        confirmedTitles: validatedPreferences.desiredJobTitles,
      });
      setNormalizedPlan({
        plan: preview.plan as OnboardingSearchPlan,
        planToken: preview.planToken,
        confirmationAllowed: preview.confirmationAllowed,
      });
    } catch (error) {
      setNormalizedPlan(null);
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'The search plan could not be previewed.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [validatedPreferences]);

  useEffect(() => {
    if (step !== 'search-plan') return;
    void refreshPreview();
  }, [step, refreshPreview]);

  const handleContinue = useCallback(() => {
    void (async () => {
      const errors = validateQuestion(draft, question);
      if (Object.keys(errors).length > 0) {
        setPreferencesErrors(errors);
        return;
      }
      const next = getNextOnboardingQuestion(question);
      const destination: OnboardingProgressSnapshot = {
        ...snapshot,
        currentQuestion: next,
        onboardingStep: next === null ? 'review' : 'preferences',
      };
      const saved = await saveDestination(destination);
      if (!saved.ok) return;
      if (next === null) {
        setStep('review');
        setPreferencesErrors({});
        return;
      }
      setQuestion(next);
      setPreferencesErrors({});
    })();
  }, [draft, question, snapshot, saveDestination]);

  const handleBack = useCallback(() => {
    void (async () => {
      const previous = getPreviousOnboardingQuestion(question);
      if (previous === null) return;
      const destination: OnboardingProgressSnapshot = {
        ...snapshot,
        currentQuestion: previous,
        onboardingStep: 'preferences',
      };
      const saved = await saveDestination(destination);
      if (!saved.ok) return;
      setQuestion(previous);
    })();
  }, [question, snapshot, saveDestination]);

  const handleReviewBack = useCallback(() => {
    void (async () => {
      const destination: OnboardingProgressSnapshot = {
        ...snapshot,
        onboardingStep: 'preferences',
      };
      const saved = await saveDestination(destination);
      if (!saved.ok) return;
      setStep('preferences');
    })();
  }, [snapshot, saveDestination]);

  const handleReviewContinue = useCallback(() => {
    void (async () => {
      const destination: OnboardingProgressSnapshot = {
        ...snapshot,
        onboardingStep: 'search-plan',
      };
      const saved = await saveDestination(destination);
      if (!saved.ok) return;
      setStep('search-plan');
    })();
  }, [snapshot, saveDestination]);

  const handlePlanBack = useCallback(() => {
    void (async () => {
      const destination: OnboardingProgressSnapshot = {
        ...snapshot,
        onboardingStep: 'review',
      };
      const saved = await saveDestination(destination);
      if (!saved.ok) return;
      setStep('review');
    })();
  }, [snapshot, saveDestination]);

  const handleConfirm = useCallback(async () => {
    if (inFlightRef.current) return;
    if (validatedPreferences === null) return;
    if (normalizedPlan?.confirmationAllowed !== true) {
      setConfirmError(
        'The search plan cannot be confirmed. Add at least one ready source and one query.',
      );
      return;
    }
    inFlightRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    setCompletionResult(null);
    const attemptId = `attempt-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
    try {
      const result = await api.completeOnboarding({
        preferences: validatedPreferences,
        reviewItems,
        planToken: normalizedPlan.planToken,
        attemptId,
      });
      setCompletionResult(result);
      if (result.ok) {
        await onRefreshStatus();
      } else if (result.saveError !== undefined) {
        setConfirmError(result.saveError);
      } else if (result.cascadeError !== undefined) {
        setConfirmError(result.cascadeError);
      }
    } catch (error) {
      setConfirmError(safeCompletionMessage(error));
    } finally {
      setConfirming(false);
      inFlightRef.current = false;
    }
  }, [normalizedPlan, onRefreshStatus, reviewItems, validatedPreferences]);

  const handleCancel = useCallback(() => {
    void (async () => {
      await saveDestination(snapshot);
      // Preserve progress for resume; do NOT call destructive reset.
      await api.endOnboardingEdit(true);
      await onRefreshStatus();
    })();
  }, [saveDestination, snapshot, onRefreshStatus]);

  const handleReset = useCallback(() => {
    void (async () => {
      await saveDestination(snapshot);
      await api.resetOnboardingProgress();
      await onRefreshStatus();
    })();
  }, [saveDestination, snapshot, onRefreshStatus]);

  const plan = normalizedPlan?.plan;

  return (
    <div className="onboarding-wizard">
      <nav className="onboarding-step-nav" aria-label="Onboarding steps">
        <ol>
          <li aria-current={step === 'preferences' ? 'step' : undefined}>
            Preferences
          </li>
          <li aria-current={step === 'review' ? 'step' : undefined}>Review</li>
          <li aria-current={step === 'search-plan' ? 'step' : undefined}>
            Search plan
          </li>
        </ol>
      </nav>

      {step === 'preferences' ? (
        <PreferencesStep
          value={draft}
          errors={preferencesErrors}
          currentQuestion={question}
          saving={saving}
          saveError={saveError}
          onChange={(next) => {
            setDraft(next);
            setPreferencesErrors({});
          }}
          onBack={() => {
            handleBack();
          }}
          onContinue={() => {
            handleContinue();
          }}
        />
      ) : undefined}

      {step === 'review' ? (
        <ReviewStep
          items={reviewItems}
          saving={saving}
          saveError={saveError}
          onChange={(next) => setReviewItems(next)}
          onBack={() => {
            handleReviewBack();
          }}
          onContinue={() => {
            handleReviewContinue();
          }}
        />
      ) : undefined}

      {step === 'search-plan' ? (
        isOnboardingSearchPlan(plan) ? (
          <SearchPlanStep
            plan={plan}
            saving={confirming}
            saveError={confirmError}
            onBack={() => {
              handlePlanBack();
            }}
            onConfirm={() => {
              void handleConfirm();
            }}
          />
        ) : (
          <section className="onboarding-card">
            <h2 className="onboarding-question-title">Search plan preview</h2>
            <p className="onboarding-question-copy" role="status">
              {previewLoading
                ? 'Building the search plan preview…'
                : (previewError ??
                  'The search plan could not be previewed. Retry or go Back to change preferences.')}
            </p>
            <div className="onboarding-actions">
              <div className="onboarding-actions-left">
                <button
                  type="button"
                  className="button"
                  disabled={previewLoading}
                  onClick={() => void refreshPreview()}
                >
                  Retry preview
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    handlePlanBack();
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          </section>
        )
      ) : undefined}

      {completionResult !== null &&
      completionResult.ok &&
      completionResult.discoveryOutcome.state === 'failed' ? (
        <p className="onboarding-save-error" role="alert">
          {completionResult.discoveryOutcome.message ??
            'The search could not be started. Use Retry search from the completed screen.'}
        </p>
      ) : undefined}

      <div className="onboarding-actions onboarding-wizard-footer">
        <div className="onboarding-actions-left">
          <button
            type="button"
            className="button secondary"
            disabled={saving || confirming}
            onClick={() => {
              handleCancel();
            }}
          >
            Save and leave
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={saving || confirming}
            onClick={() => {
              handleReset();
            }}
          >
            Reset onboarding
          </button>
        </div>
      </div>
    </div>
  );
}

function buildValidatedPreferences(
  draft: OnboardingPreferencesDraft,
): OnboardingValidatedPreferences | null {
  try {
    const cleanedTitles = draft.desiredJobTitles
      .map((title) => title.trim())
      .filter((title) => title !== '');
    const cleanedLocations = draft.preferredLocations
      .map((location) => ({
        city: location.city.trim(),
        state: location.state.trim(),
      }))
      .filter((location) => location.city !== '' && location.state !== '');
    const primaryRadius = Number(draft.searchRadiusMiles);
    const secondaryRadius = Number(draft.secondarySearchRadiusMiles);
    if (
      !Number.isFinite(primaryRadius) ||
      primaryRadius <= 0 ||
      !Number.isInteger(primaryRadius)
    ) {
      return null;
    }
    if (
      !Number.isFinite(secondaryRadius) ||
      secondaryRadius <= 0 ||
      !Number.isInteger(secondaryRadius)
    ) {
      return null;
    }
    if (secondaryRadius < primaryRadius) return null;
    if (draft.remotePreference === null) return null;
    const desiredSalary =
      draft.answers.desiredSalary === 'answered' && draft.desiredSalary !== null
        ? {
            minimum: Number.parseFloat(draft.desiredSalary.minimum) || 0,
            target: Number.parseFloat(draft.desiredSalary.target) || 0,
            currency: draft.desiredSalary.currency.trim(),
          }
        : null;
    if (cleanedTitles.length === 0) return null;
    if (draft.desiredEmploymentTypes.length === 0) return null;
    return {
      preferredLocations: cleanedLocations,
      searchRadiusMiles: primaryRadius,
      secondarySearchRadiusMiles: secondaryRadius,
      remotePreference: draft.remotePreference,
      desiredSalary,
      desiredJobTitles: cleanedTitles,
      desiredEmploymentTypes: [...draft.desiredEmploymentTypes],
    };
  } catch {
    return null;
  }
}
