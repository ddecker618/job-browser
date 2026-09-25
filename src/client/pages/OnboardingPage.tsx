import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api, type OnboardingStatusResponse } from '../api.js';
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
  OnboardingSearchPlanSourceEntry,
} from '../../models/onboarding.js';

type WizardStep = 'preferences' | 'review' | 'search-plan';

type BlockKind = 'malformed' | 'unsupported-version' | 'storage-failure';

interface CompleteOutcome {
  readonly ok: boolean;
  readonly discoveryStarted?: boolean;
  readonly discoveryError?: string;
  readonly cascadeError?: string;
  readonly saveError?: string;
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
        completedAt={status.completion.completedAt}
        outcome={retryOutcome}
        busy={retryBusy}
        onRetry={async () => {
          setRetryBusy(true);
          try {
            const result = await api.retryOnboardingDiscovery();
            if (result.ok) {
              setRetryOutcome({ ok: true, message: null });
            } else {
              setRetryOutcome({ ok: false, message: result.error });
            }
          } catch (error) {
            setRetryOutcome({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : 'Discovery could not be retried.',
            });
          } finally {
            setRetryBusy(false);
          }
        }}
      />
    );
  }
  if (status.state === 'blocked' && status.blockKind !== undefined) {
    return (
      <BlockedView
        title={blockTitle(status.blockKind)}
        message={
          status.blockMessage ?? 'Onboarding progress could not be loaded.'
        }
        primaryLabel="Reset onboarding"
        onPrimary={() => {
          void (async () => {
            await api.resetOnboardingProgress();
            await loadStatus();
          })();
        }}
        secondaryLabel="Open Sources"
        secondaryHref="/sources"
      />
    );
  }

  return <Wizard status={status} onRefreshStatus={loadStatus} />;
}

function blockTitle(kind: BlockKind): string {
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
}: {
  readonly title: string;
  readonly message: string;
  readonly primaryLabel: string;
  readonly onPrimary: () => void | Promise<void>;
  readonly secondaryLabel: string;
  readonly secondaryHref: string;
}) {
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
      <p className="onboarding-footnote">
        Resetting clears the stored progress so you can start fresh. It does not
        change your candidate profile, sources, jobs, applications, or scoring
        data.
      </p>
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
  completedAt,
  outcome,
  busy,
  onRetry,
}: {
  readonly completedAt: string | null;
  readonly outcome: {
    readonly ok: boolean;
    readonly message: string | null;
  } | null;
  readonly busy: boolean;
  readonly onRetry: () => Promise<void>;
}) {
  return (
    <section className="onboarding-card onboarding-completed">
      <h2 className="onboarding-question-title">Onboarding complete</h2>
      <p className="onboarding-question-copy">
        Your preferences and search plan are saved. Discovery has run for your
        configured sources.
      </p>
      {completedAt !== null ? (
        <p className="onboarding-footnote" role="status">
          Completed at {completedAt}
        </p>
      ) : undefined}
      {outcome !== null && !outcome.ok && outcome.message !== null ? (
        <p className="onboarding-save-error" role="alert">
          {outcome.message}
        </p>
      ) : undefined}
      <div className="onboarding-actions">
        <div className="onboarding-actions-left">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void onRetry()}
          >
            {busy ? 'Retrying…' : 'Retry search'}
          </button>
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
  const snapshotValue = isV2Snapshot(status.snapshot) ? status.snapshot : null;
  const initialDraft =
    snapshotValue !== null
      ? snapshotValue.answers
      : createEmptyPreferencesDraft();
  const initialReviewItems =
    snapshotValue !== null ? snapshotValue.reviewItems : [];

  const [draft, setDraft] = useState<OnboardingPreferencesDraft>(initialDraft);
  const [reviewItems, setReviewItems] =
    useState<readonly OnboardingReviewItem[]>(initialReviewItems);
  const initialStep: WizardStep =
    status.snapshot !== undefined &&
    status.snapshot !== null &&
    isV2Snapshot(status.snapshot) &&
    status.snapshot.onboardingStep === 'search-plan'
      ? 'search-plan'
      : status.snapshot !== undefined &&
          status.snapshot !== null &&
          isV2Snapshot(status.snapshot) &&
          status.snapshot.onboardingStep === 'review'
        ? 'review'
        : 'preferences';
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [question, setQuestion] = useState<OnboardingQuestion>(
    status.question ?? firstUnresolvedQuestion(initialDraft) ?? 'desired-work',
  );
  const [preferencesErrors, setPreferencesErrors] = useState<
    ReturnType<typeof validateQuestion>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

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

  const persistSnapshot = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveOnboardingProgress(snapshot);
    } catch (error) {
      setSaveError(safeSaveMessage(error));
    } finally {
      setSaving(false);
    }
  }, [snapshot]);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    setConfirmError(null);
    setDiscoveryError(null);
    try {
      const cleanedTitles = draft.desiredJobTitles
        .map((title) => title.trim())
        .filter((title) => title !== '');
      const preferencesPayload = {
        preferredLocations: draft.preferredLocations
          .map((location) => ({
            city: location.city.trim(),
            state: location.state.trim(),
          }))
          .filter((location) => location.city !== '' && location.state !== ''),
        searchRadiusMiles: Number(draft.searchRadiusMiles),
        secondarySearchRadiusMiles: Number(draft.secondarySearchRadiusMiles),
        remotePreference: draft.remotePreference,
        desiredSalary:
          draft.answers.desiredSalary === 'answered' &&
          draft.desiredSalary !== null
            ? {
                minimum: Number(draft.desiredSalary.minimum) || 0,
                target: Number(draft.desiredSalary.target) || 0,
                currency: draft.desiredSalary.currency.trim(),
              }
            : null,
        desiredJobTitles: cleanedTitles,
        desiredEmploymentTypes: draft.desiredEmploymentTypes,
      };
      const result = (await api.completeOnboarding({
        preferences: preferencesPayload,
        reviewItems: [...reviewItems],
      })) as unknown as CompleteOutcome;
      if (!result.ok) {
        setConfirmError(
          result.saveError ??
            'Onboarding could not be completed. Retry to keep your draft.',
        );
        return;
      }
      if (result.discoveryError !== undefined) {
        setDiscoveryError(result.discoveryError);
      }
      await onRefreshStatus();
    } catch (error) {
      setConfirmError(safeCompletionMessage(error));
    } finally {
      setConfirming(false);
    }
  }, [draft, onRefreshStatus, reviewItems]);

  const plan = useMemo<OnboardingSearchPlan>(
    () => normalizePlan(status.plan, draft),
    [status.plan, draft],
  );

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
            const previous = getPreviousOnboardingQuestion(question);
            if (previous !== null) setQuestion(previous);
          }}
          onContinue={() => {
            void (async () => {
              const errors = validateQuestion(draft, question);
              if (Object.keys(errors).length > 0) {
                setPreferencesErrors(errors);
                return;
              }
              const next = getNextOnboardingQuestion(question);
              await persistSnapshot();
              if (next === null) {
                setStep('review');
                return;
              }
              setQuestion(next);
            })();
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
            void (async () => {
              await persistSnapshot();
              setStep('preferences');
            })();
          }}
          onContinue={() => {
            void (async () => {
              await persistSnapshot();
              setStep('search-plan');
            })();
          }}
        />
      ) : undefined}

      {step === 'search-plan' ? (
        <SearchPlanStep
          plan={plan}
          saving={confirming}
          saveError={confirmError}
          onBack={() => {
            void (async () => {
              await persistSnapshot();
              setStep('review');
            })();
          }}
          onConfirm={() => {
            void handleConfirm();
          }}
        />
      ) : undefined}

      <div className="onboarding-actions onboarding-wizard-footer">
        <div className="onboarding-actions-left">
          <button
            type="button"
            className="button secondary"
            disabled={saving || confirming}
            onClick={() => {
              void (async () => {
                await persistSnapshot();
                await api.resetOnboardingProgress();
                await onRefreshStatus();
              })();
            }}
          >
            Cancel and leave
          </button>
        </div>
      </div>

      {discoveryError !== null ? (
        <p className="onboarding-save-error" role="alert">
          {discoveryError}
        </p>
      ) : undefined}
    </div>
  );
}

function isV2Snapshot(value: unknown): value is OnboardingProgressSnapshot & {
  readonly reviewItems: readonly OnboardingReviewItem[];
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { version?: unknown; reviewItems?: unknown };
  return candidate.version === 2 && Array.isArray(candidate.reviewItems);
}

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
    message.toLowerCase().includes('fetch')
  ) {
    return 'Onboarding progress could not be saved.';
  }
  if (message.toLowerCase().includes('explicitly reset')) {
    return 'Existing onboarding progress must be reset before it can be replaced.';
  }
  if (message === '') return 'Onboarding progress could not be saved.';
  // Pass through server-supplied safe messages (they are already
  // bounded). Otherwise fall back to the generic phrase.
  if (
    message.startsWith('Onboarding progress could not be saved') ||
    message.startsWith('Existing onboarding progress must be reset')
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
    message.startsWith('Onboarding could not be completed')
  ) {
    return message;
  }
  return 'Onboarding could not be completed.';
}

function normalizePlan(
  raw: unknown,
  draft: OnboardingPreferencesDraft,
): OnboardingSearchPlan {
  if (typeof raw === 'object' && raw !== null) {
    const candidate = raw as Partial<OnboardingSearchPlan>;
    if (
      typeof candidate.version === 'number' &&
      Array.isArray(candidate.appliedQueries) &&
      Array.isArray(candidate.omittedTitles) &&
      Array.isArray(candidate.sources) &&
      typeof candidate.confirmationAllowed === 'boolean'
    ) {
      return candidate as OnboardingSearchPlan;
    }
  }
  const cleanedTitles = draft.desiredJobTitles
    .map((title) => title.trim())
    .filter((title) => title !== '');
  return {
    version: 1,
    confirmedTitles: cleanedTitles,
    appliedQueries: cleanedTitles,
    omittedTitles: [],
    preferredLocations: draft.preferredLocations
      .map((location) => ({
        city: location.city.trim(),
        state: location.state.trim(),
      }))
      .filter((location) => location.city !== '' && location.state !== ''),
    remotePreference: draft.remotePreference ?? 'accepted',
    primaryRadiusMiles: Number(draft.searchRadiusMiles) || 0,
    secondaryRadiusMiles: Number(draft.secondarySearchRadiusMiles) || 0,
    sources: [] as readonly OnboardingSearchPlanSourceEntry[],
    totalSourceCount: 0,
    readySourceCount: 0,
    needsAttentionSourceCount: 0,
    excludedSourceCount: 0,
    warnings: [],
    confirmationAllowed: cleanedTitles.length > 0,
  };
}
