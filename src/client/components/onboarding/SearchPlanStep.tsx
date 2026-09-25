import { useId, useRef } from 'react';
import type { SyntheticEvent } from 'react';

import type {
  OnboardingSearchPlan,
  OnboardingSearchPlanSourceEntry,
  OnboardingSearchPlanSourceState,
} from '../../../models/onboarding.js';
import '../../styles/onboarding.css';

/**
 * MR1-05 — pure, parent-controlled preview component for the
 * bounded search/source plan. The component does not call the API,
 * SQLite, `DiscoveryCoordinator`, any provider, or the network. The
 * caller passes a fully-built plan; this component only renders and
 * emits `onBack` / `onConfirm` callbacks.
 */
export interface SearchPlanStepProps {
  readonly plan: OnboardingSearchPlan;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}

interface Group {
  readonly heading: string;
  readonly state: OnboardingSearchPlanSourceState;
  readonly entries: readonly OnboardingSearchPlanSourceEntry[];
}

function groupSources(
  entries: readonly OnboardingSearchPlanSourceEntry[],
): readonly Group[] {
  const ready: OnboardingSearchPlanSourceEntry[] = [];
  const needsAttention: OnboardingSearchPlanSourceEntry[] = [];
  const excluded: OnboardingSearchPlanSourceEntry[] = [];
  for (const entry of entries) {
    if (entry.state === 'ready') ready.push(entry);
    else if (entry.state === 'needs-attention') needsAttention.push(entry);
    else excluded.push(entry);
  }
  return [
    { heading: 'Ready sources', state: 'ready', entries: ready },
    {
      heading: 'Sources needing attention',
      state: 'needs-attention',
      entries: needsAttention,
    },
    { heading: 'Excluded sources', state: 'excluded', entries: excluded },
  ];
}

function remoteLabel(
  preference: OnboardingSearchPlan['remotePreference'],
): string {
  if (preference === 'preferred') return 'Remote preferred';
  if (preference === 'accepted') return 'Remote accepted';
  return 'Prefer in person';
}

export function SearchPlanStep({
  plan,
  saving,
  saveError,
  onBack,
  onConfirm,
}: SearchPlanStepProps) {
  const headingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const groups = groupSources(plan.sources);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving || !plan.confirmationAllowed) return;
    onConfirm();
  }

  function handleBack(): void {
    if (saving) return;
    onBack();
  }

  const confirmLabel = saving ? 'Confirming…' : 'Confirm plan';
  const confirmDisabled = saving || !plan.confirmationAllowed;

  return (
    <form
      ref={formRef}
      className="onboarding-search-plan"
      onSubmit={handleSubmit}
      aria-busy={saving}
      aria-labelledby={headingId}
    >
      <section className="onboarding-card" aria-labelledby={headingId}>
        <p className="onboarding-progress">Search plan preview</p>
        <h2 id={headingId} tabIndex={-1} className="onboarding-question-title">
          Review your search plan
        </h2>
        <p className="onboarding-question-copy">
          These are the queries and configured sources Job Browser is prepared
          to use.
        </p>
        <p className="onboarding-footnote" role="status">
          No search has run yet. Searching begins only after you confirm this
          plan.
        </p>

        <section
          className="onboarding-search-plan-queries"
          aria-labelledby={`${headingId}-queries`}
        >
          <h3
            id={`${headingId}-queries`}
            className="onboarding-search-plan-section-title"
          >
            Queries included in this search
          </h3>
          {plan.appliedQueries.length === 0 ? (
            <p
              className="onboarding-search-plan-empty"
              data-testid="onboarding-search-plan-empty-included-queries"
            >
              No queries are included. Add at least one confirmed role before
              searching.
            </p>
          ) : (
            <ul
              className="onboarding-search-plan-list"
              data-testid="onboarding-search-plan-included-queries-list"
            >
              {plan.appliedQueries.map((query) => (
                <li
                  key={query}
                  className="onboarding-search-plan-list-item"
                  data-testid={`onboarding-search-plan-included-query-${query}`}
                >
                  <span className="onboarding-search-plan-query">{query}</span>
                </li>
              ))}
            </ul>
          )}

          {plan.omittedTitles.length > 0 ? (
            <div className="onboarding-search-plan-omitted">
              <h4 className="onboarding-search-plan-section-subtitle">
                Confirmed titles not included
              </h4>
              <p className="onboarding-search-plan-omitted-explanation">
                These confirmed titles exceeded the configured per-run query
                limit.
              </p>
              <ul
                className="onboarding-search-plan-list"
                data-testid="onboarding-search-plan-omitted-titles-list"
              >
                {plan.omittedTitles.map((title) => (
                  <li
                    key={title}
                    className="onboarding-search-plan-list-item"
                    data-testid={`onboarding-search-plan-omitted-title-${title}`}
                  >
                    <span className="onboarding-search-plan-omitted-title">
                      {title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : undefined}
        </section>

        <section
          className="onboarding-search-plan-constraints"
          aria-labelledby={`${headingId}-constraints`}
        >
          <h3
            id={`${headingId}-constraints`}
            className="onboarding-search-plan-section-title"
          >
            Location and remote constraints
          </h3>
          <dl className="onboarding-search-plan-constraints-list">
            <div className="onboarding-search-plan-constraint">
              <dt>Preferred locations</dt>
              <dd>
                {plan.preferredLocations.length === 0
                  ? 'No preferred locations'
                  : plan.preferredLocations
                      .map((location) => `${location.city}, ${location.state}`)
                      .join('; ')}
              </dd>
            </div>
            <div className="onboarding-search-plan-constraint">
              <dt>Remote</dt>
              <dd>{remoteLabel(plan.remotePreference)}</dd>
            </div>
            <div className="onboarding-search-plan-constraint">
              <dt>Preferred distance</dt>
              <dd>{`${String(plan.primaryRadiusMiles)} miles`}</dd>
            </div>
            <div className="onboarding-search-plan-constraint">
              <dt>Wider limit</dt>
              <dd>{`${String(plan.secondaryRadiusMiles)} miles`}</dd>
            </div>
          </dl>
        </section>

        <section
          className="onboarding-search-plan-bounds"
          aria-labelledby={`${headingId}-bounds`}
        >
          <h3
            id={`${headingId}-bounds`}
            className="onboarding-search-plan-section-title"
          >
            Bounded query and source totals
          </h3>
          <dl className="onboarding-search-plan-bounds-list">
            <div className="onboarding-search-plan-bound">
              <dt>Queries included</dt>
              <dd data-testid="onboarding-search-plan-applied-count">
                {plan.appliedQueries.length}
              </dd>
            </div>
            <div className="onboarding-search-plan-bound">
              <dt>Confirmed titles omitted</dt>
              <dd data-testid="onboarding-search-plan-omitted-count">
                {plan.omittedTitles.length}
              </dd>
            </div>
            <div className="onboarding-search-plan-bound">
              <dt>Total sources</dt>
              <dd data-testid="onboarding-search-plan-total-source-count">
                {plan.totalSourceCount}
              </dd>
            </div>
            <div className="onboarding-search-plan-bound">
              <dt>Ready sources</dt>
              <dd data-testid="onboarding-search-plan-ready-source-count">
                {plan.readySourceCount}
              </dd>
            </div>
            <div className="onboarding-search-plan-bound">
              <dt>Sources needing attention</dt>
              <dd data-testid="onboarding-search-plan-needs-attention-source-count">
                {plan.needsAttentionSourceCount}
              </dd>
            </div>
            <div className="onboarding-search-plan-bound">
              <dt>Excluded sources</dt>
              <dd data-testid="onboarding-search-plan-excluded-source-count">
                {plan.excludedSourceCount}
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="onboarding-search-plan-sources"
          aria-labelledby={`${headingId}-sources`}
        >
          <h3
            id={`${headingId}-sources`}
            className="onboarding-search-plan-section-title"
          >
            Sources
          </h3>
          {plan.sources.length === 0 ? (
            <p
              className="onboarding-search-plan-empty"
              data-testid="onboarding-search-plan-empty-sources"
            >
              There are no configured sources yet.
            </p>
          ) : (
            groups.map((group) => (
              <section
                key={group.state}
                className="onboarding-search-plan-source-group"
                aria-labelledby={`${headingId}-${group.state}`}
              >
                <h4
                  id={`${headingId}-${group.state}`}
                  className="onboarding-search-plan-group-heading"
                >
                  {group.heading}
                </h4>
                {group.entries.length === 0 ? (
                  <p className="onboarding-search-plan-empty">None.</p>
                ) : (
                  <ul
                    className="onboarding-search-plan-list"
                    data-testid={`onboarding-search-plan-${group.state}-list`}
                  >
                    {group.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="onboarding-search-plan-list-item"
                      >
                        <span
                          className="onboarding-search-plan-source-badge"
                          data-state={entry.state}
                        >
                          <span className="onboarding-search-plan-source-badge-text">
                            {group.heading.replace(/s$/, '')}
                          </span>
                        </span>
                        <span className="onboarding-search-plan-source-name">
                          {entry.displayName}
                        </span>
                        <span className="onboarding-search-plan-source-employer">
                          {`(${entry.employer})`}
                        </span>
                        {entry.reason !== null ? (
                          <span
                            className="onboarding-search-plan-source-reason"
                            data-testid={`onboarding-search-plan-${group.state}-reason-${entry.id}`}
                          >
                            {entry.reason}
                          </span>
                        ) : undefined}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
        </section>

        {plan.warnings.length > 0 ? (
          <section
            className="onboarding-search-plan-warnings"
            aria-labelledby={`${headingId}-warnings`}
          >
            <h3
              id={`${headingId}-warnings`}
              className="onboarding-search-plan-section-title"
            >
              Warnings
            </h3>
            <ul
              className="onboarding-search-plan-list"
              data-testid="onboarding-search-plan-warnings-list"
            >
              {plan.warnings.map((warning) => (
                <li
                  key={warning}
                  className="onboarding-search-plan-list-item onboarding-search-plan-warning"
                  role="status"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </section>
        ) : undefined}
      </section>

      <div className="onboarding-actions">
        <p className="onboarding-footnote">
          Use Back to change your job preferences. Sources needing attention
          must be fixed from the Sources workspace.
        </p>
        <div className="onboarding-actions-left">
          {saving ? (
            <span
              className="onboarding-save-status"
              role="status"
              data-testid="onboarding-search-plan-saving-status"
            >
              Confirming your search plan…
            </span>
          ) : undefined}
          {saveError !== null ? (
            <p
              className="onboarding-save-error"
              role="alert"
              data-testid="onboarding-search-plan-save-error"
            >
              {saveError}
            </p>
          ) : undefined}
          <button
            type="button"
            className="button"
            onClick={handleBack}
            disabled={saving}
            data-testid="onboarding-search-plan-back"
          >
            Back
          </button>
          <button
            ref={confirmRef}
            type="submit"
            className="button primary"
            disabled={confirmDisabled}
            aria-disabled={confirmDisabled}
            data-testid="onboarding-search-plan-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
