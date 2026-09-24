import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import type {
  OnboardingReviewItem,
  OnboardingReviewStepProps,
  OnboardingReviewStatus,
} from '../../../models/onboarding.js';
import '../../styles/onboarding.css';

const REVIEW_FIELD_LABELS = {
  skills: 'Skills',
  certifications: 'Certifications',
} as const;

const REVIEW_STATUS_LABELS: Record<OnboardingReviewStatus, string> = {
  confirmed: 'Confirmed',
  suggested: 'Suggested',
  unknown: 'Unknown',
};

function itemLabel(
  field: OnboardingReviewItem['field'],
  index: number,
): string {
  return `${field === 'skills' ? 'Skill' : 'Certification'} ${String(index + 1)}`;
}

function isBlankValue(value: string): boolean {
  return value.trim() === '';
}

function getValidationError(item: OnboardingReviewItem): string | null {
  if (isBlankValue(item.value)) {
    return 'Enter a value or remove this item.';
  }

  if (item.status !== 'confirmed') {
    return 'Confirm or remove this item before continuing.';
  }

  return null;
}

function reconcileFieldErrors(
  nextItems: readonly OnboardingReviewItem[],
): Record<string, string> {
  const nextErrors: Record<string, string> = {};

  nextItems.forEach((item) => {
    const error = getValidationError(item);
    if (error !== null) {
      nextErrors[item.id] = error;
    }
  });

  return nextErrors;
}

export function ReviewStep({
  items,
  saving,
  saveError,
  onChange,
  onBack,
  onContinue,
}: OnboardingReviewStepProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [continueError, setContinueError] = useState<string | null>(null);
  const [focusAfterAction, setFocusAfterAction] = useState<string | null>(null);

  const groupedItems = {
    skills: items.filter((item) => item.field === 'skills'),
    certifications: items.filter((item) => item.field === 'certifications'),
  } as const;

  const totalUnresolved = items.filter(
    (item) => isBlankValue(item.value) || item.status !== 'confirmed',
  ).length;
  const isReadyToContinue =
    items.length === 0 ||
    items.every(
      (item) => !isBlankValue(item.value) && item.status === 'confirmed',
    );
  const topAlert = saveError ?? continueError;

  useEffect(() => {
    const reconciled = reconcileFieldErrors(items);

    setFieldErrors((previous) => {
      const hasDifference =
        Object.keys(previous).length !== Object.keys(reconciled).length ||
        Object.entries(reconciled).some(
          ([key, value]) => previous[key] !== value,
        );

      return hasDifference ? reconciled : previous;
    });

    if (continueError !== null && Object.keys(reconciled).length === 0) {
      setContinueError(null);
    }
  }, [continueError, items]);

  useEffect(() => {
    if (focusAfterAction === null) return;

    if (focusAfterAction === '__heading__') {
      headingRef.current?.focus({ preventScroll: true });
      setFocusAfterAction(null);
      return;
    }

    if (focusAfterAction === '__continue__') {
      const continueButton = formRef.current?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      continueButton?.focus({ preventScroll: true });
      setFocusAfterAction(null);
      return;
    }

    const target = inputRefs.current[focusAfterAction];
    target?.focus({ preventScroll: true });
    setFocusAfterAction(null);
  }, [focusAfterAction, items]);

  useEffect(() => {
    if (saveError !== null) return;
    if (continueError === null) return;

    const firstInvalid = formRef.current?.querySelector<HTMLInputElement>(
      'input[aria-invalid="true"]',
    );
    firstInvalid?.focus({ preventScroll: true });
  }, [continueError, fieldErrors, saveError]);

  function updateItem(itemId: string, nextValue: string): void {
    const target = items.find((item) => item.id === itemId);
    if (target === undefined) return;

    onChange(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              value: nextValue,
              status: item.status === 'confirmed' ? 'suggested' : item.status,
            }
          : item,
      ),
    );

    setFieldErrors((previous) => {
      if (nextValue.trim() === '') {
        return { ...previous, [itemId]: 'Enter a value or remove this item.' };
      }

      return Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== itemId),
      );
    });

    setContinueError(null);
  }

  function handleConfirm(itemId: string): void {
    if (saving) return;

    const target = items.find((item) => item.id === itemId);
    if (target === undefined) return;

    if (target.value.trim() === '') {
      setContinueError(null);
      setFieldErrors((previous) => ({
        ...previous,
        [itemId]: 'Enter a value or remove this item.',
      }));
      inputRefs.current[itemId]?.focus({ preventScroll: true });
      return;
    }

    onChange(
      items.map((item) =>
        item.id === itemId ? { ...item, status: 'confirmed' } : item,
      ),
    );

    setFieldErrors((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== itemId),
      ),
    );
    setContinueError(null);

    const currentIndex = items.findIndex((item) => item.id === itemId);
    const nextItemId = items[currentIndex + 1]?.id ?? '__continue__';
    setFocusAfterAction(nextItemId);
  }

  function handleRemove(itemId: string): void {
    if (saving) return;

    const nextItems = items.filter((item) => item.id !== itemId);
    onChange(nextItems);

    setFieldErrors((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== itemId),
      ),
    );
    setContinueError(null);
    setFocusAfterAction(nextItems[0]?.id ?? '__heading__');
  }

  function handleContinueClick(): void {
    if (saving) return;

    const nextErrors = reconcileFieldErrors(items);
    const hasInvalidItems = Object.keys(nextErrors).length > 0;

    if (hasInvalidItems) {
      setFieldErrors(nextErrors);
      setContinueError('Confirm or remove each item before continuing.');

      const firstInvalid = formRef.current?.querySelector<HTMLInputElement>(
        'input[aria-invalid="true"]',
      );
      firstInvalid?.focus({ preventScroll: true });
      return;
    }

    setContinueError(null);
    setFieldErrors({});
    onContinue();
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    handleContinueClick();
  }

  return (
    <form
      ref={formRef}
      className="onboarding-review"
      aria-busy={saving}
      onSubmit={handleSubmit}
    >
      <div className="onboarding-card onboarding-review-card">
        <p className="onboarding-progress">Review</p>
        <h2
          ref={headingRef}
          className="onboarding-question-title"
          id={`${id}-heading`}
          tabIndex={-1}
        >
          Confirm your skills and certifications
        </h2>
        <p className="onboarding-question-copy">
          Review each item below. Confirm the ones that are accurate for your
          profile. This is a personal check, not a third-party verification.
        </p>

        {topAlert !== null ? (
          <p
            className={
              saveError !== null
                ? 'onboarding-save-error'
                : 'onboarding-field-error'
            }
            role="alert"
          >
            {topAlert}
          </p>
        ) : undefined}

        {items.length === 0 ? (
          <div className="onboarding-review-empty">
            <p>
              No skills or certifications are listed yet. You can continue
              without adding anything.
            </p>
          </div>
        ) : undefined}

        {(['skills', 'certifications'] as const).map((field) => {
          const fieldItems = groupedItems[field];

          return (
            <section
              key={field}
              className="onboarding-review-group"
              aria-labelledby={`${id}-${field}-heading`}
            >
              <h3
                id={`${id}-${field}-heading`}
                className="onboarding-review-heading"
              >
                {REVIEW_FIELD_LABELS[field]}
              </h3>

              {fieldItems.length === 0 ? (
                <p className="onboarding-review-empty-inline">
                  No {REVIEW_FIELD_LABELS[field].toLowerCase()} were found. You
                  can keep going without adding any.
                </p>
              ) : undefined}

              {fieldItems.map((item, index) => {
                const errorText = fieldErrors[item.id] ?? null;
                const isBlank = isBlankValue(item.value);
                const statusLabel = REVIEW_STATUS_LABELS[item.status];

                return (
                  <div
                    key={item.id}
                    className="onboarding-review-item"
                    data-review-item-id={item.id}
                  >
                    <div className="onboarding-review-item-header">
                      <span
                        className={`onboarding-review-status onboarding-review-status-${item.status}`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <label
                      className="onboarding-field"
                      htmlFor={`${id}-${item.id}`}
                    >
                      <span>{itemLabel(field, index)}</span>
                      <input
                        ref={(node) => {
                          inputRefs.current[item.id] = node;
                        }}
                        id={`${id}-${item.id}`}
                        type="text"
                        value={item.value}
                        disabled={saving}
                        aria-invalid={Boolean(errorText)}
                        aria-describedby={
                          errorText !== null
                            ? `${id}-${item.id}-error`
                            : undefined
                        }
                        onChange={(event) =>
                          updateItem(item.id, event.target.value)
                        }
                      />
                    </label>

                    {item.reason !== null && item.reason.trim() !== '' ? (
                      <p className="onboarding-review-reason">
                        Why it was suggested: {item.reason}
                      </p>
                    ) : undefined}

                    {errorText !== null ? (
                      <p
                        id={`${id}-${item.id}-error`}
                        className="onboarding-field-error"
                        aria-live="polite"
                      >
                        {errorText}
                      </p>
                    ) : undefined}

                    <div className="onboarding-review-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={
                          saving || item.status === 'confirmed' || isBlank
                        }
                        onClick={() => handleConfirm(item.id)}
                      >
                        Confirm value
                      </button>

                      <button
                        type="button"
                        className="button secondary"
                        disabled={saving}
                        onClick={() => handleRemove(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}

        <div className="onboarding-actions">
          <div className="onboarding-actions-left">
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={onBack}
            >
              Back
            </button>
            <button type="submit" className="button" disabled={saving}>
              Continue
            </button>
          </div>

          {saving ? (
            <p className="onboarding-save-status" role="status">
              Saving your review…
            </p>
          ) : totalUnresolved > 0 ? (
            <p className="onboarding-save-status">
              {totalUnresolved} item{totalUnresolved === 1 ? '' : 's'} still
              need confirmation.
            </p>
          ) : isReadyToContinue ? (
            <p className="onboarding-save-status">Ready to continue.</p>
          ) : (
            <p className="onboarding-save-status">
              {items.length === 0
                ? 'No items to confirm.'
                : 'Still checking review items.'}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
