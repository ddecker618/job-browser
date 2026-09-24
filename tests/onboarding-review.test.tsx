// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewStep } from '../src/client/components/onboarding/ReviewStep.js';
import {
  fictionalReviewItems,
  fictionalReviewSavingProps,
} from '../src/client/fixtures/onboarding.fixture.js';
import type { OnboardingReviewItem } from '../src/models/onboarding.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function ReviewHarness({
  initialItems,
  saveFailures = 0,
  initialSaving = false,
}: {
  initialItems: readonly OnboardingReviewItem[];
  saveFailures?: number;
  initialSaving?: boolean;
}) {
  const [items, setItems] = useState<readonly OnboardingReviewItem[]>([
    ...initialItems,
  ]);
  const [saving, setSaving] = useState(initialSaving);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backCount, setBackCount] = useState(0);
  const saveAttemptsRef = useRef(0);
  const failCountRef = useRef(saveFailures);
  const lastSavedRef = useRef<readonly OnboardingReviewItem[] | null>(null);

  return (
    <div
      data-testid="review-harness"
      data-back-count={backCount}
      data-save-attempts={saveAttemptsRef.current}
      data-last-saved={JSON.stringify(lastSavedRef.current ?? [])}
      data-items={JSON.stringify(items)}
    >
      <ReviewStep
        items={items}
        saving={saving}
        saveError={saveError}
        onChange={setItems}
        onBack={() => setBackCount((count) => count + 1)}
        onContinue={() => {
          saveAttemptsRef.current += 1;
          lastSavedRef.current = [...items];
          if (saving) return;
          setSaving(true);
          setSaveError(null);
          window.setTimeout(() => {
            setSaving(false);
            if (failCountRef.current > 0) {
              failCountRef.current -= 1;
              setSaveError('Could not save review. Please try again.');
              return;
            }
            setSaveError(null);
          }, 25);
        }}
      />
    </div>
  );
}

describe('ReviewStep', () => {
  it('shows confirmed, suggested, and unknown items with their supplied reasons and note', () => {
    render(<ReviewHarness initialItems={fictionalReviewItems} />);

    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Suggested').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Why it was suggested:/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/personal check, not a third-party verification/i),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Cisco Meraki administration'),
    ).toBeInTheDocument();
  });

  it('allows explicit confirmation and does not silently confirm suggestions', async () => {
    const user = userEvent.setup();
    render(<ReviewHarness initialItems={fictionalReviewItems} />);

    const confirmButton = screen.getAllByRole('button', {
      name: 'Confirm value',
    })[1]!;
    await user.click(confirmButton);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Confirm or remove each item before continuing.',
    );
  });

  it('treats blank confirmed values as unresolved and shows ready only when every item is nonblank and confirmed', () => {
    const initialItems = [
      {
        id: 'blank-confirmed',
        field: 'skills' as const,
        value: '   ',
        status: 'confirmed' as const,
        reason: null,
      },
      {
        id: 'ready-confirmed',
        field: 'skills' as const,
        value: 'Linux hardening',
        status: 'confirmed' as const,
        reason: null,
      },
    ];

    const { rerender } = render(
      <ReviewHarness
        key={JSON.stringify(initialItems)}
        initialItems={initialItems}
      />,
    );

    expect(screen.getByText(/still need confirmation/i)).toBeInTheDocument();
    expect(screen.queryByText('Ready to continue.')).not.toBeInTheDocument();

    const readyItems = [
      {
        id: 'ready-confirmed',
        field: 'skills' as const,
        value: 'Linux hardening',
        status: 'confirmed' as const,
        reason: null,
      },
    ];

    rerender(
      <ReviewHarness
        key={JSON.stringify(readyItems)}
        initialItems={readyItems}
      />,
    );
    expect(screen.getByText('Ready to continue.')).toBeInTheDocument();
  });

  it('requires reconfirmation after editing a confirmed item', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={[
          {
            id: 'rev-confirmed',
            field: 'skills',
            value: 'BGP configuration',
            status: 'confirmed',
            reason: null,
          },
        ]}
      />,
    );

    const input = screen.getByRole('textbox', { name: /Skill 1/i });
    await user.clear(input);
    await user.type(input, 'BGP routing');

    expect(screen.getAllByText('Suggested').length).toBeGreaterThan(0);
    const confirmButton = screen.getAllByRole('button', {
      name: /Confirm value/i,
    })[0]!;
    expect(confirmButton).toBeEnabled();
  });

  it('prevents blank values from being confirmed and shows a field error', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={[
          {
            id: 'rev-blank',
            field: 'skills',
            value: '   ',
            status: 'suggested',
            reason: 'Likely match from resume.',
          },
        ]}
      />,
    );

    const input = screen.getByRole('textbox', { name: /Skill 1/i });
    await user.clear(input);

    const confirmButton = screen.getAllByRole('button', {
      name: /Confirm value/i,
    })[0]!;

    expect(
      screen.getByText('Enter a value or remove this item.'),
    ).toBeInTheDocument();
    expect(confirmButton).toBeDisabled();
  });

  it('allows removal while preserving stable item identities', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={[
          {
            id: 'rev-stable-a',
            field: 'skills',
            value: 'A',
            status: 'suggested',
            reason: null,
          },
          {
            id: 'rev-stable-b',
            field: 'skills',
            value: 'B',
            status: 'suggested',
            reason: null,
          },
        ]}
      />,
    );

    const removeButton = screen.getAllByRole('button', { name: 'Remove' })[0];
    if (!removeButton) {
      throw new Error('Expected remove button to render');
    }
    await user.click(removeButton);
    expect(screen.queryByDisplayValue('A')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('B')).toBeInTheDocument();
    expect(screen.getByTestId('review-harness')).toHaveAttribute(
      'data-items',
      JSON.stringify([
        {
          id: 'rev-stable-b',
          field: 'skills',
          value: 'B',
          status: 'suggested',
          reason: null,
        },
      ]),
    );
  });

  it('preserves edits when other items change', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={[
          {
            id: 'rev-a',
            field: 'skills',
            value: 'Alpha',
            status: 'confirmed',
            reason: null,
          },
          {
            id: 'rev-b',
            field: 'skills',
            value: 'Beta',
            status: 'suggested',
            reason: 'Resume mention.',
          },
        ]}
      />,
    );

    const alpha = screen.getByRole('textbox', {
      name: /Skill 1/i,
    });
    const beta = screen.getByRole('textbox', {
      name: /Skill 2/i,
    });
    await user.clear(alpha);
    await user.type(alpha, 'Alpha v2');
    const confirmSecond = screen.getAllByRole('button', {
      name: /Confirm value/i,
    })[1]!;
    await user.click(confirmSecond);

    expect(screen.getByDisplayValue('Alpha v2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument();
    expect(beta).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
  });

  it('blocks continuation until unresolved items are confirmed or removed', async () => {
    const user = userEvent.setup();
    render(<ReviewHarness initialItems={fictionalReviewItems} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Confirm or remove each item before continuing.',
    );
    expect(screen.getByTestId('review-harness')).toHaveAttribute(
      'data-save-attempts',
      '0',
    );
  });

  it('allows an empty review list to continue with a helpful explanation', async () => {
    const user = userEvent.setup();
    render(<ReviewHarness initialItems={[]} />);

    expect(
      screen.getByText(/No skills or certifications are listed yet/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('review-harness')).toHaveAttribute(
      'data-save-attempts',
      '1',
    );
  });

  it('keeps valid items error-free after a parent-driven update following a failed continue', async () => {
    const user = userEvent.setup();
    const initialItems: readonly OnboardingReviewItem[] = [
      {
        id: 'valid-before',
        field: 'skills',
        value: 'Linux hardening',
        status: 'suggested',
        reason: 'resume match',
      },
      {
        id: 'invalid-after',
        field: 'skills',
        value: '',
        status: 'suggested',
        reason: 'resume match',
      },
    ];

    const { rerender } = render(
      <ReviewStep
        items={initialItems}
        saving={false}
        saveError={null}
        onChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByText('Confirm or remove each item before continuing.'),
    ).toBeInTheDocument();

    const firstItem: OnboardingReviewItem = {
      id: initialItems[0]!.id,
      field: initialItems[0]!.field,
      value: initialItems[0]!.value,
      status: 'confirmed',
      reason: initialItems[0]!.reason,
    };
    const secondItem: OnboardingReviewItem = initialItems[1]!;
    const confirmedItems: OnboardingReviewItem[] = [firstItem, secondItem];

    rerender(
      <ReviewStep
        items={confirmedItems}
        saving={false}
        saveError={null}
        onChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Linux hardening')).toBeInTheDocument();
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Enter a value or remove this item.'),
    ).toBeInTheDocument();
  });

  it('keeps the Back action and saved state intact without mutating parent data', async () => {
    const user = userEvent.setup();
    const frozen = deepFreeze(fictionalReviewItems);
    render(<ReviewHarness initialItems={frozen} />);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('review-harness')).toHaveAttribute(
      'data-back-count',
      '1',
    );
    expect(
      JSON.parse(
        screen.getByTestId('review-harness').getAttribute('data-items') ?? '[]',
      ),
    ).toEqual(JSON.parse(JSON.stringify(fictionalReviewItems)));
  });

  it('disables editing and duplicate submission while saving', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={fictionalReviewItems}
        initialSaving={true}
      />,
    );

    expect(screen.getByRole('textbox', { name: /Skill 1/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Confirm value' })[0],
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('review-harness')).toHaveAttribute(
      'data-save-attempts',
      '0',
    );
  });

  it('submits from Enter, blocks invalid native submissions, and prevents duplicate submit while saving', async () => {
    const user = userEvent.setup();
    const initial = render(
      <ReviewHarness initialItems={fictionalReviewItems} />,
    );

    const input = screen.getByRole('textbox', { name: /Skill 1/i });
    await user.type(input, '{enter}');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Confirm or remove each item before continuing.',
    );

    initial.unmount();

    const emptyHarness = render(<ReviewHarness initialItems={[]} />);
    const emptyContinue = screen.getByRole('button', { name: 'Continue' });
    await user.click(emptyContinue);
    expect(emptyHarness.getByTestId('review-harness')).toHaveAttribute(
      'data-save-attempts',
      '1',
    );
    emptyHarness.unmount();

    const disabledHarness = render(
      <ReviewHarness
        initialItems={fictionalReviewItems}
        initialSaving={true}
      />,
    );
    const saveDisabledContinue = screen.getByRole('button', {
      name: 'Continue',
    });
    await user.click(saveDisabledContinue);
    expect(disabledHarness.getByTestId('review-harness')).toHaveAttribute(
      'data-save-attempts',
      '0',
    );
  });

  it('preserves edits after save failure and allows retry', async () => {
    const user = userEvent.setup();
    render(
      <ReviewHarness
        initialItems={[
          {
            id: 'rev-save-fail',
            field: 'skills',
            value: 'Firewalls',
            status: 'confirmed',
            reason: null,
          },
        ]}
        saveFailures={1}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save review. Please try again.',
    );
    expect(screen.getByDisplayValue('Firewalls')).toBeInTheDocument();
  });

  it('uses accessible labels, links field errors, and focuses the first invalid item without being hijacked by another page control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside control</button>
        <ReviewHarness
          initialItems={[
            {
              id: 'invalid-skill',
              field: 'skills',
              value: '',
              status: 'suggested',
              reason: 'resume match',
            },
            {
              id: 'valid-skill',
              field: 'skills',
              value: 'Linux hardening',
              status: 'suggested',
              reason: 'resume match',
            },
          ]}
        />
      </>,
    );

    const outside = screen.getByRole('button', { name: 'Outside control' });
    outside.focus();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const invalidInput = screen.getByRole('textbox', { name: /Skill 1/i });
    expect(invalidInput).toHaveAttribute('aria-invalid', 'true');
    expect(invalidInput).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('error'),
    );
    expect(document.activeElement).toBe(invalidInput);
    expect(document.activeElement).not.toBe(outside);
  });

  it('keeps the fixture object and props unmutated during render', () => {
    const frozen = deepFreeze(fictionalReviewSavingProps);
    render(<ReviewStep {...frozen} />);
    expect(
      screen.getByRole('heading', {
        name: /Confirm your skills and certifications/i,
      }),
    ).toBeInTheDocument();
    expect(JSON.parse(JSON.stringify(frozen.items))).toEqual(
      JSON.parse(JSON.stringify(fictionalReviewItems)),
    );
  });
});
