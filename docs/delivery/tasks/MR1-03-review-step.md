# MR1-03 — Review/confirmation screen and interaction tests

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md); do not duplicate state here.
**Parent package:** MR-1 candidate-first onboarding
**Dependencies:** MR1-01 (frozen contract), MR1-02 (preferences step accepted)
**Expected size:** one focused session (this task)

## Outcome

A reusable `ReviewStep` component that groups skills and certifications, shows confirmed/suggested/unknown states in text (not color alone), and requires explicit confirmation before a value is treated as accurate. The screen keeps the parent responsible for the item list, save state and navigation, and it exposes item edits, removals, and continue/back requests through the already-frozen MR1-01 contract.

## Starting point

- **Baseline commit:** `8281609` (same working tree as MR1-02; all prior MR work remains uncommitted and preserved).
- **Existing modules to reuse (read-only, unchanged):**
  `src/models/onboarding.ts` (`OnboardingReviewStepProps`, `OnboardingReviewItem`, `OnboardingReviewStatus`),
  `src/client/fixtures/onboarding.fixture.ts` (fictional-only review values),
  `src/client/styles/onboarding.css` (shared onboarding design tokens),
  the MR1-01 contract and MR1-02 preferences tests for validation conventions.
- **Sample data and expected behavior:** fictional fixtures only; no real candidate or employer data; no route, discovery, or persistence work.

## Files owned by this task

| File                                              | Existing/new         | Intended change                                                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/components/onboarding/ReviewStep.tsx` | new                  | Review/confirmation screen for skills and certifications; explicit confirm, edit, and remove; blank-value protections; unresolved-item blocking; empty-state continuation; save state disable + retry support; accessible labels and focus handling. |
| `tests/onboarding-review.test.tsx`                | new                  | Interaction tests through a controlled parent harness using fictional fixtures; verifies state labels, reconfirmation, blank validation, stable IDs, save-failure retention, and keyboard/focus behavior.                                            |
| `src/client/styles/onboarding.css`                | existing shared file | Scoped review-step styling aligned to the onboarding design without regressing the preferences form.                                                                                                                                                 |
| `src/client/fixtures/onboarding.fixture.ts`       | existing shared file | Adds fictional review fixtures used by the review tests and review step examples.                                                                                                                                                                    |
| `docs/delivery/tasks/MR1-03-review-step.md`       | new                  | This task card.                                                                                                                                                                                                                                      |
| `SESSION_HANDOFF.md`                              | existing             | Transfer pointer and work status updated to reflect the OpenCode → Copilot handoff.                                                                                                                                                                  |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`              | existing             | MR1-03 status updated to **Review** and transfer date recorded.                                                                                                                                                                                      |

## Contract

Authoritative source: `src/models/onboarding.ts` and the MR1-01 onboarding contract decision record.

Behavior of the step:

- **Parent owns the runtime.** `items`, `saving`, `saveError`, navigation and save requests are parent-owned. The review step emits updated item arrays and calls `onBack` / `onContinue`; it does not navigate or persist.
- **Confirmed vs suggested vs unknown.** Each item displays a text label instead of relying on color alone. Suggested items are not silently confirmed when the user continues.
- **Explicit user confirmation.** The component requires the user to confirm the value before it is treated as accurate. Confirmed values are distinct from suggestions and unknown entries.
- **Edit resets confirmation.** Changing a confirmed value resets it to a non-confirmed state until the user explicitly reconfirms it.
- **Blank-value validation.** Blank or whitespace-only entries are invalid; the user must either enter a value or remove the item. Confirm is disabled for blank values.
- **Stable identities.** Items keep a stable `id`; removing one does not mutate the remaining IDs or reorder them unexpectedly.
- **Unresolved items block continuation.** Any unresolved item must be confirmed or removed before the user can continue. An empty list may continue with a helpful explanatory message.
- **Save state and retry.** While `saving`, fields, remove and confirm actions, Back, and Continue are disabled. Duplicate submission is prevented. A save failure keeps the pending edits intact and allows another retry.
- **Accessibility.** Labels are explicit and field errors are associated with the correct input. Focus moves predictably after edits, removals, blocked continuation, or save-error states.
- **Duplicates.** The chosen rule matches current profile behavior: duplicate review entries are not silently bulk-confirmed or merged inside the step; the step preserves the item list as supplied by the parent and requires the user to act on each unresolved item individually. This is documented because the parent handles duplicate-treatment policy at the profile layer and the review step does not invent a broader bulk-confirmation rule.

## In scope / out of scope

- In scope: review/confirmation step; focused styling; interaction tests; task card; board and handoff updates; local validation.
- Out of scope: production route wiring, first-start integration, real persistence or storage, API changes, discovery or parser logic, salary or notification changes, new dependencies, production data access, commits, pushes, or installer builds.

## Acceptance checks

- [x] Distinct confirmed/suggested/unknown states are rendered with text and supplied reasons.
- [x] Explicit confirmation is required; suggestions do not silently become confirmed.
- [x] Editing a confirmed value requires reconfirmation.
- [x] Blank values are rejected and cannot be confirmed.
- [x] Stable IDs are preserved through edits and removals.
- [x] Edits survive other interactions and save-failure retry loops.
- [x] Unresolved items block Continue until confirmed or removed.
- [x] Empty review lists can continue with explanatory copy.
- [x] Back preserves state and save in-flight disables controls and duplicate submit.
- [x] Save failure keeps edits and allows retry.
- [x] Keyboard, labels, focus handling, and error associations behave as expected.
- [x] No props or fixtures are mutated during render or interaction.

## Transfer and review status

This task was interrupted when OpenCode exhausted its usage allowance. The work was resumed by GitHub Copilot on 2026-09-20, with the transfer recorded in the delivery board and handoff documents. The task was accepted by the Codex reviewer on 2026-09-20 and moved to **Done**. The implementation remains out of the release path: the release status stays `Not shipped` until a separately validated release gate. The browser, narrow-window, and 200% zoom checks remain explicit acceptance items for **MR1-06/MR1-07** and are not marked as passed.
