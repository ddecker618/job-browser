# MR1-01 — Freeze first onboarding contract, fixtures and ownership

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md); do not duplicate state here.
**Parent package:** MR-1 candidate-first onboarding
**Dependencies:** MR0-01
**Expected size:** one focused session (this task)

## Outcome

Every downstream onboarding task can build against one frozen
TypeScript contract — editable preferences draft, validated
preferences, a review confirmation boundary, error and save-state
shapes, component props, and fictional fixtures — without inventing
a second schema or a competing authority for candidate preferences.

## Starting point

- **Baseline commit:** `8281609` (`release: 1.1.5 ship P37 shadow job-type taxonomy`; absent from the locally recorded `origin/main` reference — current remote-server state was not checked).
- **Existing modules to reuse (read-only, unchanged):** `src/schemas/candidate-profile.ts` (field shapes and semantics, reused via `candidateProfileSchema.shape`), `src/preferences/` profile preferences store/runtime/adapters (persistence authority, unchanged), `src/intelligence/scoringEngine.ts` (raw-number salary comparison, informs salary semantics), `src/db/migrations/004_dashboard.sql` (`app_settings` table — candidate for MR1-04 progress storage, not used here).
- **Sample data and expected behavior:** fictional fixtures only (see below); no real candidate or employer data. Existing `candidate-profile.test.ts` and preference-store tests are reference behavior for validated output.

## Files owned by this task

| File                                                    | Existing/new | Intended change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/models/onboarding.ts`                              | new          | Froze the contract types: preference drafts (string numerics, nullable remote, `answers` answer-state metadata), validated preferences (Pick of seven profile fields), error shapes, `OnboardingSaveState` used by both step prop contracts, review items, `OnboardingQuestion` + `OnboardingEnabledQuestion`, versioned `OnboardingProgressSnapshot`, conversion result, and the question-navigation props (`currentQuestion`, `onChange`/`onBack`/`onContinue`).                                                                                                                                                                       |
| `src/schemas/onboarding.ts`                             | new          | Pure validation/conversion helpers: strict-decimal `parseAmountText`, `validateQuestion` (one question at a time), `validatePreferencesDraft(draft, sequence?)`, `firstUnresolvedQuestion(draft, sequence?)`, `getNextOnboardingQuestion`/`getPreviousOnboardingQuestion`, `createProgressSnapshot`, `convertPreferencesDraft` (guards the full contract), `pickPreferencesFromProfile`, `mergePreferencesIntoProfile` (null-safe), `toPreferencesDraft` (null salary → `'unanswered'`), `createEmptyPreferencesDraft` (no silent defaults), full + enabled question-sequence constants, schemas reusing `candidateProfileSchema.shape`. |
| `src/client/fixtures/onboarding.fixture.ts`             | new          | Fictional-only fixtures: enabled-flow complete draft (salary deferred), full-contract draft (salary answered, for future enablement), first-time user with no answers, snapshot-recorded deliberate salary skip, resumed partial session (+ progress snapshot at the current question), corrected earlier answer, missing location, empty roles/employment types, invalid radius/salary, saving, save-failure with answers preserved, review states.                                                                                                                                                                                     |
| `tests/onboarding-contract.test.ts`                     | new          | Contract tests focused on validity, error fields and conversion: parsing matrix (hex/scientific/separators/signs/incomplete decimals), blank-vs-zero, answer-state semantics, enabled-versus-supported distinction, required-before-search, question-navigation contract (current-question prop, callbacks, next/previous walk, final-question completion), per-question validation, progress snapshot + resume invariant, deferred-salary survival regression, restore intent, schema compatibility, no mutation, merge preservation, round-trip, type checks. No verbatim error-wording assertions.                                    |
| `docs/delivery/decisions/MR1-01-onboarding-contract.md` | new          | Decision record (D1–D11): parsing syntax, answer-state semantics, question-navigation contract, enabled-versus-supported sequence, salary deferral (D4a/L1), null-safe merge, snapshot restore intent, boundaries, storage authority, contributor roles, L1–L5 limitations with impact and next actions, alternatives considered.                                                                                                                                                                                                                                                                                                        |
| `docs/delivery/tasks/MR1-01-onboarding-contract.md`     | new          | This task card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/DUSTIN_FIRST_CODING_TASK.md`                      | existing     | Re-pointed at the frozen contract (draft semantics, answer states, per-question validation, guided flow, fixtures, props) AND repositioned as an **optional learning guide**, not a required assignment (D11): MR1-02 is implemented by OpenCode and must not depend on it.                                                                                                                                                                                                                                                                                                                                                              |
| `docs/JOB_BROWSER_BUILD_BLUEPRINT.md` (§5)              | existing     | Adoption note: the illustrative §5 component contract is superseded by the published types (string numerics, answer metadata, question-navigation props, enabled sequence omitting salary, progress snapshot, contributor roles).                                                                                                                                                                                                                                                                                                                                                                                                        |
| `SESSION_HANDOFF.md`                                    | existing     | Short pointer: MR1-01 claimed/active then **Done** after review; claimed files listed then released; board is the status authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`                    | existing     | MR1-01 row → **Review** (claim already recorded in "Current work"); then **Done** on 2026-09-18 after **Codex reviewer acceptance** and release of claimed files; ownership updated to the D11 contributor roles; session-log rows appended.                                                                                                                                                                                                                                                                                                                                                                                             |

## Shared files — integration owner only

None from this task. The new contract files are owned by MR1-01 and are
the designated shared surface for MR1-02/03/04/05/06; after acceptance,
the **implementation owner (OpenCode)** edits shared contracts with
**Codex review**, and any contributor requests a contract change on the
decision record rather than defining a second type (roles per D11).

## Contract

One authoritative source: the decision record
[`docs/delivery/decisions/MR1-01-onboarding-contract.md`](../../delivery/decisions/MR1-01-onboarding-contract.md),
implemented by the types in `src/models/onboarding.ts` and the pure
helpers in `src/schemas/onboarding.ts`.

Highlights (full semantics in the decision record):

- Draft numerics are strings; strict decimal syntax (`^\d+(?:\.\d+)?$`)
  is the only accepted format; blank ⇒ null/not-provided, never `0` or
  `NaN`; hex, scientific, signs, separators and incomplete decimals are
  rejected.
- Unanswered is explicit: `remotePreference` starts `null` (no silent
  default) and `answers` metadata distinguishes `unanswered`, `answered`
  and `skipped` for remote work and salary. Required questions must be
  answered before anything converts; optional salary may be
  unanswered/skipped and converts to `desiredSalary: null`.
- Question-navigation contract: the preferences props carry
  `currentQuestion: OnboardingQuestion` and an explicit callback
  contract — `onChange` updates the draft without advancing;
  `onContinue` validates the current question then advances (final
  enabled question ⇒ final validation + saving); `onBack` goes backward
  one question preserving answers; the parent restores `currentQuestion`
  from the progress snapshot on resume.
- Enabled vs supported: `ONBOARDING_ENABLED_QUESTION_SEQUENCE`
  (roles → location → travel distance → remote work → employment
  types) is the walk the UI uses and **omits salary**; the full
  `ONBOARDING_QUESTION_SEQUENCE` still supports salary for future
  enablement. Default validation/progression ignore the deferred
  salary; `convertPreferencesDraft` still guards the full contract so a
  half-entered salary block is never mis-applied (L1, D4a).
- Salary is deferred (L1): the enabled flow does not present it, and
  omitting the question **never clears an existing saved salary** — the
  merge step skips null-valued fields (regression-tested).
- Restored intent (L4): a saved null salary prefills as `'unanswered'`;
  only an actual stored snapshot that recorded `'skipped'` restores a
  deliberate skip.
- `onboardingValidatedPreferencesSchema` reuses
  `candidateProfileSchema.shape`, so merged output satisfies
  `candidateProfileSchema` by construction; `mergePreferencesIntoProfile`
  preserves unrelated profile fields and writes no nulls.
- Error shape separates field validation from save failures: both step
  prop contracts extend `OnboardingSaveState` (`saving`, `saveError`);
  retry keeps draft and errors intact. Wording is not frozen.
- Review boundary (`OnboardingReviewItem`) reuses existing resume
  proposal representations; suggestions require confirmation and the app
  must not promise automatic suggestions it cannot produce (L3).
- Roles (D11): OpenCode implements scheduled tasks, Codex reviews,
  an optional contributor may optionally claim a small bounded contribution; planned
  work never depends on an optional contributor's optional learning guide.
- Parent owns state/saving/navigation (props contract); no storage,
  route, API, migration, or UI exists from this task.

## In scope / out of scope

- In scope: freeze contract types; pure validation/conversion helpers;
  fictional fixtures; contract tests; decision record; task card;
  question-navigation contract (`currentQuestion` + callbacks); salary
  deferral with existing-data preservation (L1) and restore intent
  (L4); contributor roles (D11); re-point an optional contributor's optional learning
  guide at the frozen contract; blueprint adoption note; handoff
  pointer; board row to Review with updated ownership; local validation
  (typecheck, focused + related tests, prettier, eslint, link
  resolution, diff check).
- Out of scope: any UI component or route; any API endpoint; any
  database change, migration, or persistence (including wizard progress
  storage — MR1-04); running the app or discovery; touching production
  data; changing existing profile schemas, stored formats, salary
  scoring, or settings behavior; new packages/dependencies; commits,
  pushes, or publishing; starting any other board row; marking MR1-01
  Done or shipping a release.

## Acceptance checks

- [x] Happy-path behavior: the enabled-flow draft (salary deferred)
      converts (`ok: true`) to validated preferences that parse through
      `onboardingValidatedPreferencesSchema` and produce a profile that
      parses through `candidateProfileSchema` when merged; the
      full-contract draft (salary answered) converts with its salary.
- [x] Invalid/empty input: blank numerics are null/not-provided (never
      `0`/`NaN`); unintended numeric formats (hex, scientific, signs,
      separators, incomplete decimals) are rejected; partial salary,
      target-below-minimum, malformed currency, secondary-radius-below-
      primary, empty roles/locations/employment types, unanswered remote
      work, and inconsistent salary/answers all fail convert with errors
      on the offending field and location row.
- [x] Answer states: first-time draft has `remotePreference: null` and
      `'unanswered'` states (no silent default); skipped/deferred salary
      converts to null; unresolved required values always block while
      the deferred salary never does.
- [x] Question-navigation contract: props carry `currentQuestion` and
      the `onChange`/`onBack`/`onContinue` signatures; next/previous
      walk the enabled sequence (salary never appears); the final
      enabled question has no unresolved work left (final validation +
      saving path); per-question `validateQuestion` reports only the
      requested question.
- [x] Enabled vs supported: default validation/progression ignore the
      deferred salary; `convertPreferencesDraft` still guards the full
      contract (a half-entered answered salary fails convert even
      though the enabled walk omits it).
- [x] Existing data preserved: a profile with an existing
      `desiredSalary` keeps it through the deferred-salary flow
      (regression test); merge writes no nulls over existing values and
      preserves unrelated profile fields; inputs are never mutated
      (deep-freeze tested); no existing schema, stored profile, DB,
      route, or migration was changed; salary scoring and settings
      behavior untouched.
- [x] Restore intent (L4): a saved null salary prefills as
      `'unanswered'`; a snapshot-recorded `'skipped'` stays skipped.
- [x] Failure/retry behavior: save failures are `saveError` + intact
      draft/errors (fixture asserts answers are preserved); the
      save-state contract prevents duplicate Continue while `saving`.
- [x] Accessibility/keyboard behavior: not implemented here (no UI);
      the props contract is keyboard-agnostic and parent-owned.

## Review evidence

### First review round (initial submission)

- **Changed files:** the ten listed under "Files owned by this task"
  plus the new `docs/delivery/decisions/` directory. No other tracked
  or untracked file was modified; `README.md` and `docs/PROJECT_MEMORY.md`
  (MR0-01 files) are untouched by MR1-01.
- **Focused tests run (exact result):** `tests/onboarding-contract.test.ts`
  first passed 26/26 (after fixing a validator bug where a valid salary
  block returned an empty errors object); related profile/preference/
  scoring tests passed 24/24. Typecheck, eslint and prettier clean.

### Review-corrections round (this round; task stays in Review)

Changes applied from review feedback:

- **Explicitly represented unanswered preferences.** `remotePreference`
  is `null` in the empty draft (the silent `'preferred'` default was
  removed); `answers` metadata (`unanswered`/`answered`/`skipped`)
  covers remote work and salary; required values cannot convert until
  answered; optional salary may remain unresolved/skipped and converts
  to `null`.
- **Guided progression.** `OnboardingQuestion` union, ordered
  `ONBOARDING_QUESTION_SEQUENCE`, required/optional sets,
  `validateQuestion` (single-question validation), and
  `firstUnresolvedQuestion`. Parent still owns navigation/saving.
  `OnboardingProgressSnapshot` (version 1: step + current question +
  full draft/answer states) is the persistable format for MR1-04; still
  no storage implemented.
- **Guidance fixtures.** Added first-time-no-answers, undecided
  optional salary, explicitly skipped optional salary, resumed partial
  session (+ snapshot), corrected earlier answer, and save-failure-with-
  answers-preserved. Documentation and copy must not promise automatic
  suggestions the app cannot produce.
- **Tightened numeric parsing.** `parseAmountText` accepts only
  `^\d+(?:\.\d+)?$`; hex, scientific, signs, separators, and incomplete
  decimals (leading/trailing dot) are rejected; blank stays distinct
  from zero; salary/radius constraints preserved. Focused parsing
  matrix tests added.
- **Salary guidance.** Absence of a salary-period field recorded as an
  unresolved limitation (L1) before the salary screen ships; no
  annual/hourly conversion invented.
- **Contract cleanup.** `OnboardingSaveState` is now used by both step
  prop contracts (removed the redundant free-floating abstraction);
  tests assert validity, error fields and conversion rather than
  freezing user-facing wording.
- **Documentation.** Decision record, task card, blueprint §5 and
  an optional contributor's task aligned to the revised exports and the guided flow, and
  distinguish contract-supported requirements from UI (later),
  persistence (MR1-04) and final integration/first-start (later).

- **Focused tests run (exact result):**
  - `npx vitest run tests/onboarding-contract.test.ts` — **52/52 PASS**.
  - `npx vitest run tests/candidate-profile.test.ts tests/profile-preferences-store.test.ts tests/profile-preferences-runtime.test.ts tests/scoring-engine.test.ts` — **24/24 PASS** (related existing behavior unchanged).
- **Static gates (exact result):**
  - `npm run typecheck` — clean (exit 0).
  - `npx eslint` on the four new source/test files — clean.
  - `npx prettier --check` (via `--write`) on the four new source/test
    files and all changed docs — conforming.
  - Markdown link resolution in all changed documents — all links
    resolve; `git diff --check` — clean (only a CRLF→LF notice on
    `SESSION_HANDOFF.md`).
- **Checks NOT run (and why):** full `npm run verify` suite not
  executed — the change adds/revises new modules and test files without
  touching existing runtime modules; scope is contract-only. No app
  launch, discovery run, install, package, or production-data access.
- **Integrated commit/reference:** none — the task boundary forbids
  commits and pushes. The user will commit and push after review.
- **Reviewer and acceptance date:** accepted **2026-09-18 by the Codex
  reviewer** after the final review-corrections round; the board has
  moved the row to **Done** and the claimed files were released. (This
  "pending" line is the historical snapshot of this round's state,
  superseded by that acceptance.)

### Final review-corrections round (this round; task stays in Review)

Changes applied from the third review pass:

- **Question-navigation contract.** `OnboardingPreferencesStepProps`
  now carries `currentQuestion: OnboardingQuestion`; the callback
  contract is documented in the models (`onChange` updates without
  advancing, `onContinue` validates the current question then advances,
  `onBack` moves backward preserving answers, the final enabled
  question triggers final validation + saving, the parent restores
  `currentQuestion` from the snapshot). Added
  `getNextOnboardingQuestion`/`getPreviousOnboardingQuestion` and
  verified the walk in fixtures, type checks and navigation tests.
- **Salary deferred (L1).** `ONBOARDING_ENABLED_QUESTION_SEQUENCE`
  omits `'salary'`; default `validatePreferencesDraft` /
  `firstUnresolvedQuestion` use the enabled scope while
  `convertPreferencesDraft` still guards the full supported contract.
  A regression test proves an **existing profile salary survives the
  deferred flow** via the null-safe merge; `OnboardingEnabledQuestion`
  separates supported contract types from currently enabled questions.
- **Restored intent (L4).** `toPreferencesDraft` prefills a saved null
  salary as **`'unanswered'`** (not `'skipped'`); only an actual stored
  snapshot that recorded `'skipped'` restores a deliberate skip —
  fixtures and tests updated.
- **Contributor roles (D11).** OpenCode implements scheduled tasks,
  Codex reviews, an optional contributor may optionally claim a small bounded
  contribution; `docs/DUSTIN_FIRST_CODING_TASK.md` is now an **optional
  learning guide** and planned implementation does not depend on it.
  Board ownership updated; MR1-02 onward apply these roles without
  starting them.

- **Focused tests run (exact result):**
  - `npx vitest run tests/onboarding-contract.test.ts` — **65/65 PASS**.
  - `npx vitest run tests/candidate-profile.test.ts tests/profile-preferences-store.test.ts tests/profile-preferences-runtime.test.ts tests/scoring-engine.test.ts` — **24/24 PASS** (related existing behavior, salary scoring and settings unchanged).
  - Combined: **89/89 PASS across the five files**.
- **Static gates (exact result):**
  - `npm run typecheck` — clean (exit 0).
  - `npx eslint` on the four new source/test files — clean.
  - `npx prettier --check` (via `--write`) on the four new source/test
    files and all changed docs — conforming.
  - Markdown link resolution in all changed documents — all links
    resolve; `git diff --check` — clean (only a CRLF→LF notice on
    `SESSION_HANDOFF.md`).
- **Checks NOT run (and why):** full `npm run verify` suite not
  executed — the change adds/revises new modules and test files without
  touching existing runtime modules; scope is contract-only. No app
  launch, discovery run, install, package, or production-data access.
- **Integrated commit/reference:** none — the task boundary forbids
  commits and pushes. The user will commit and push after review.
- **Reviewer and acceptance date:** accepted **2026-09-18 by the Codex
  reviewer** after the final review-corrections round; the board has
  moved the row to **Done** and the claimed files were released. (This
  "pending" line is the historical snapshot of this round's state,
  superseded by that acceptance.)

## Handoff

- **What works:** the onboarding contract is frozen and test-backed
  after the final review corrections, including the question-navigation
  contract (`currentQuestion` + `onChange`/`onContinue`/`onBack`),
  enabled-versus-supported sequences (salary deferred per L1),
  null-safe merge that preserves existing salary data, and L4 restore
  intent. MR1-02 builds against `src/models/onboarding.ts`,
  `src/schemas/onboarding.ts` helpers, and the fictional fixtures,
  knowing the parent owns save/navigation/current-question, validation
  can be scoped to one question at a time, and salary is not presented.
- **What remains (roles per D11: OpenCode implements, Codex reviews,
  an optional contributor optional):**
  - MR1-02 (OpenCode; optional an optional contributor slice): preferences flow, one
    enabled question at a time in order + UI tests; **no salary
    question** until L1 is resolved; copy must not claim a salary
    period or auto-suggest.
  - MR1-03 (OpenCode; optional an optional contributor slice): review/confirmation
    screen + UI tests; suggestions require confirmation; no promises of
    automatic suggestions.
  - MR1-04 (OpenCode): store/restore `OnboardingProgressSnapshot`
    (version 1, incl. current question + answer states; likely
    versioned JSON in `app_settings`) and integrate confirmed
    preferences through the existing profile services; the parent
    restores `currentQuestion` from the snapshot; treat restored salary
    skip per L4.
  - MR1-05 (OpenCode): search-plan preview; execution only after
    confirmation.
  - MR1-06 (OpenCode; Codex review): parent screen, routing, API
    integration, retry/cancel.
  - Experience step has a step name but **no prop contract yet**;
    MR1-04/06 decide it.
  - Product decisions still pending for the reviewer (not marked
    accepted here): salary-period representation (L1) before any salary
    screen, and remote "not sure" handling (L2).
- **Reviewer acceptance:** **Codex reviewer accepted MR1-01 on 2026-09-18** (final review-corrections round). The board moved the row to **Done** and the claimed files were **released** back to the unclaimed bucket. Documented limitations (L1–L5) and the salary deferral remain recorded and unresolved (reviewer may still amend them later).
- **Next concrete action:** MR1-02 is now available and is the next task — **implemented by OpenCode, reviewed by Codex, optional bounded an optional contributor participation**. Not started; the board remains the status authority.

## What this task did **not** do

- Did not change any existing schema, stored profile format, database,
  migration, route, API, or UI.
- Did not run the app, discovery, installer, package, or touch
  production data.
- Did not add dependencies, commits, pushes, or releases.
- Did not implement wizard progress storage (MR1-04), search-plan
  execution (MR1-05), or any other board row.

## Release status reminder

This task does not ship an application release. Release status remains
tracked on the delivery board, not on this card.
