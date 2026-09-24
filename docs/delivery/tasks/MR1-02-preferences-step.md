# MR1-02 — Guided onboarding preferences step (one question at a time)

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md); do not duplicate state here.
**Parent package:** MR-1 candidate-first onboarding
**Dependencies:** MR1-01 (frozen contract), MR0-01
**Expected size:** one focused session (this task)

## Outcome

A reusable `PreferencesStep` component that walks the five **enabled**
preferences questions one at a time (`desired-work`, `location`,
`travel-distance`, `remote-work`, `employment-types`), driven entirely by
the parent-owned draft, `currentQuestion`, validation and save state from
the MR1-01 contract — plus interaction tests that exercise the guided
behavior through a test-only controlled parent over the fictional
fixtures. The step never saves, navigates by itself, invents answers, or
touches salary.

## Starting point

- **Baseline commit:** `8281609` (same working tree as MR1-01; all MR0-01/
  MR1-01 changes remain uncommitted and are preserved).
- **Existing modules to reuse (read-only, unchanged):**
  `src/models/onboarding.ts` (props contract: `value`, `errors`,
  `currentQuestion`, `saving`/`saveError`, `onChange`/`onBack`/
  `onContinue`; draft and error types; `OnboardingEnabledQuestion`),
  `src/schemas/onboarding.ts` (`validateQuestion`, question-walk helpers,
  sequences), `src/client/fixtures/onboarding.fixture.ts` (fictional-only),
  `src/domain/job.ts` (`EMPLOYMENT_TYPES`, `RemotePreference`),
  `src/client/styles.css` (design tokens and shared control conventions),
  existing form UI (`ProfilePage`, `OccurrenceFields`) and UI test
  conventions (`search-profile-ui.test.tsx`, `jobs-page-ui.test.tsx`).
- **Sample data and expected behavior:** fictional fixtures only; a
  saved draft with an existing salary (`fictionalFullContractDraft`) must
  pass through the walk untouched; no real candidate or employer data.

## Files owned by this task

| File                                                   | Existing/new | Intended change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/components/onboarding/PreferencesStep.tsx` | new          | The guided step: renders only `currentQuestion` from the enabled sequence; progress label "Question N of 5"; visible heading + plain-language copy per question; examples as text (never pre-filled answers); validation scoped to the current question with errors beside the fields (`role=alert`, `aria-invalid`, `aria-describedby`); add/remove rows are `type="button"` and never submit; radius fields are `type="text" inputMode="numeric"` (transient text preserved, no zero/NaN coercion); remote work starts unselected with accurate option copy and **no fake "not sure"/skip**; `'unknown'` employment type is labeled accurately ("Jobs with unspecified employment type") and selecting it stores the exact `'unknown'` value; empty roles/locations render an immediate editable blank row (no Add-first discovery) while the draft stays parent-owned; `saving` disables every input plus add/remove, Back and submit (preventing edits during a pending save), shows `role="status"` saving text and `aria-busy`; `saveError` shows as `role="alert"`; submit is native form submission; focus moves to the question heading on question change and to the first invalid field when errors render after a blocked/deferred Continue (including an actionable focus target for empty-list errors); a salary `currentQuestion` renders a "comes later" note with no controls (unreachable in the enabled flow). |
| `src/client/styles/onboarding.css`                     | new          | Feature-scoped `onboarding-*` styles reusing the shared design tokens; imported by the component itself so it renders without a future page; responsive to narrow windows and 200% zoom (`@media (max-width: 560px)`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/onboarding-preferences.test.tsx`                | new          | Interaction tests through a **test-only controlled parent** over fictional fixtures: a local harness owns the draft, `currentQuestion`, per-question validation via `validateQuestion`, and a simulated save state (success/failure/retry, exposed via `data-*` scaffolding only). Tests assert observable behavior, not implementation details.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/delivery/tasks/MR1-02-preferences-step.md`       | new          | This task card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SESSION_HANDOFF.md`                                   | existing     | Pointer: MR1-02 claimed/active then **Review**; component implemented but not connected; board is the status authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`                   | existing     | MR1-02 row **Ready → In progress** (claim by OpenCode 2026-09-19) then **Review**; session-log rows appended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Shared files — integration owner only

None. The new component and styles carry the `onboarding-` namespace and
read only from the MR1-01 contract surface (approved for use per D11).
No shared contract type, validator, schema or existing module was
modified; no incompatibility was found that would require one.

## Contract

Authoritative source: the decision record
[`docs/delivery/decisions/MR1-01-onboarding-contract.md`](../../delivery/decisions/MR1-01-onboarding-contract.md)
and the types it froze. This task adds no second schema or parallel
validation rules — it reuses `validateQuestion` per step.

Behavior of the step:

- **One question at a time, in order.** Enabled sequence only (salary
  deferred, L1): `desired-work` → `location` → `travel-distance` →
  `remote-work` → `employment-types`. Progress shows "Question N of 5".
- **Parent owns the runtime.** `value` and `currentQuestion` come from
  the parent; `onChange` applies an updated draft (non-mutating);
  `onContinue` asks the parent to validate and advance (final enabled
  question ⇒ final validation + saving); `onBack` asks for one step
  backward preserving answers. The step does not save, navigate, persist
  or start discovery on its own.
- **Validation scope.** Only the reached question shows errors; later
  questions raise none until reached. `handleContinue` → parent; the
  step also blocks its own submit while `saving` or while the current
  question has errors. Focus moves to the first invalid field after an
  attempted Continue, whether the errors were already present or the
  parent supplies them only after Continue (deferred validation) — the
  step keeps validation parent-owned and applies no rules of its own.
- **Honest guidance, no inventions.** Examples are explanatory text only
  and are never inserted as answers; remote options describe what each
  choice means; there is no saved "not sure" remote answer nor a skip
  that cannot be honored — choosing is required. Employment types are
  exact via `scoreEmploymentType` (a job matches only when it lists one
  of the chosen types), so each option is labeled precisely: `'unknown'`
  is "Jobs with unspecified employment type" (the listing does not state
  its arrangement) and selecting it stores the exact `'unknown'` value;
  no "Open to all" pseudo-option maps other types behind the user's
  back; full-time guidance is occupation-neutral.
- **Useful from the first render.** When roles or locations are empty,
  one editable blank row is shown immediately; typing into it creates the
  corresponding draft entry without mutating props or inserting example
  answers. Add-another and Remove behavior is unchanged.
- **Salary untouched.** No salary inputs anywhere; a draft that already
  carries a salary passes through the walk unchanged.
- **Save/retry UX.** While `saving`: every input, add/remove control,
  Back and submit is disabled + `aria-busy`, `role="status"` saving text
  — the displayed answers cannot diverge from the submitted snapshot. A
  `saveError` from the parent renders as `role="alert"` with the draft
  and answers intact for retry; editing resumes once saving ends.
- **Accessibility/keys.** Native form semantics, visible labels, errors
  linked via `aria-describedby`, keyboard reachable add/remove controls
  that do not submit, sensible focus on question change and on errors
  after a blocked submit, focus-visible handle on the rerendered
  question heading.

## In scope / out of scope

- In scope: the guided step component; feature-scoped stylesheet;
  interaction tests (controlled harness over fictional fixtures, 22
  scenarios listed under Acceptance checks); task card; board row to
  Review; handoff pointer; local validation.
- Out of scope: any production route, first-start wiring or parent
  screen (MR1-06); real saving/persistence or progress storage (MR1-04);
  any API/DB/migration/discovery change; scoring, notifications or
  salary semantics; new dependencies or frameworks; production data;
  running the app or a visual regression harness; commits, pushes,
  publishing, installer builds; starting MR1-03 or any other board row.

## Acceptance checks

- [x] Happy-path guided flow: starting empty, the walk advances through
      all five enabled questions in order (progress "Question 1 of 5" …
      "Question 5 of 5"); the final question's submit is "Save and
      finish" and asks the parent to save.
- [x] Validation blocks correctly scoped: an invalid current answer
      (e.g. blank radius fields) stays on the question, shows errors,
      marks the fields `aria-invalid`, and focuses the first invalid
      field; later unmet questions raise **no** errors before they are
      reached (verified by rendering with a full error object).
- [x] Back preserves answers: navigating back shows previously answered
      values (roles, city/state, radius) intact.
- [x] Add/remove roles and locations: rows are added and removed in the
      draft without leaving the question and without submitting;
      removing keeps the remaining values.
- [x] Numeric input keeps temporary text: typing "25." retains "25."
      with no coercion to `0`/`NaN`; a blocked submit shows the parse
      error and the text stays; a valid pair advances.
- [x] Remote choice records both value and answer state: choosing an
      option checks it, writes `remotePreference` and marks
      `answers.remotePreference` `'answered'`; no "not sure"/skip
      control exists in the remote question.
- [x] Employment types select/deselect and at least one is required.
- [x] Employment-type semantics are exact: the `'unknown'` option is
      labeled "Jobs with unspecified employment type" with a description
      that the listing does not state its arrangement, selecting it
      stores the literal `'unknown'` value (never a mapping to other
      types), no "Open to all" pseudo-option exists, full-time guidance
      is occupation-neutral (no "engineering workweek"), and the hint
      describes exact matching.
- [x] Empty initial states are immediately usable: empty roles render an
      editable blank role row and empty locations render a blank
      city/state row; typing into either creates the corresponding draft
      entry without any Add-first discovery.
- [x] Saving disables editing, add/remove, Back and submit; attempts
      during a pending save leave the draft unchanged (single attempt),
      and editing resumes after a failed save (checkbox toggling works
      again and a retry submits the updated draft).
- [x] Deferred validation focus: a parent that supplies errors only after
      Continue gets the first invalid control focused once the errors
      render (roles empty-list case); an empty-locations error focuses
      the blank location row as an actionable target.
- [x] Saving is requested on the final question and duplicate submission
      is blocked while `saving` (`aria-busy`, disabled submit,
      `role="status"`, single save attempt).
- [x] A failed save keeps the answers and supports retry (submit again
      after `saveError` succeeds; two attempts observed).
- [x] A resumed draft starts at its saved question (`travel-distance`)
      and keeps walking from there.
- [x] Salary controls are absent on every reached question and an
      existing salary in the draft is saved back unchanged.
- [x] Keyboard submission works and errors/controls are associated
      (visible labels, `aria-describedby` resolving to the error text).
- [x] Style is feature-scoped (`onboarding-*`), token-based, responsive
      to narrow/zoomed windows, and imported by the component.

## Review evidence

### First review round (initial submission)

- **Focused tests run (exact result):**
  - `npx vitest run tests/onboarding-preferences.test.tsx` — **15/15 PASS**.
  - `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx` — **80/80 PASS** (contract unchanged; interaction suite added).
  - `npx vitest run tests/search-profile-ui.test.tsx tests/jobs-page-ui.test.tsx` — **14/14 PASS** (existing UI suites unaffected; shared UI not modified).
- **Static gates (exact result):**
  - `npm run typecheck` — clean (exit 0).
  - `npx eslint` on `src/client/components/onboarding/PreferencesStep.tsx`
    and `tests/onboarding-preferences.test.tsx` — clean.
  - `npx prettier --check` on `PreferencesStep.tsx`, `onboarding.css`
    and `tests/onboarding-preferences.test.tsx` — conforming.
  - Markdown link resolution in changed documents and `git diff --check`
    — see the board-adjacent notes; CRLF-only notices aside, clean.
- **Checks NOT run (and why):** full `npm run verify` suite not executed
  (the change adds a scoped component + styles + tests without touching
  existing runtime modules); **no browser/visual check** — the component
  is deliberately not wired into any production route yet (no preview
  path exists), so the jsdom harness proves **behavior**, not layout or
  pixels; an automated a11y audit (e.g. axe) was not run.
- **Integrated commit/reference:** none — the task boundary forbids
  commits and pushes. The user will commit and push after review.
- **Reviewer and acceptance date:** recorded in the acceptance block below.

### Review-corrections round (Codex feedback 2026-09-19, task stays in Review)

- **Employment-type semantics corrected.** The UI previously labeled the
  existing `'unknown'` employment type "Not sure" and implied "any
  arrangement works". `scoreEmploymentType` matches **exact**
  `profile.desiredEmploymentTypes` membership only, so the option is now
  labeled "Jobs with unspecified employment type" and explained as a
  listing that does not state its employment arrangement; selecting it
  stores the literal `'unknown'` value. No "Open to all" pseudo-option
  was added (a truthful all-types choice would require explicitly
  selecting every existing type, which the six exact options already
  allow individually); full-time guidance is now occupation-neutral
  ("standard weekly schedule") instead of "the standard engineering
  workweek". Scoring and persisted enums were not changed.
- **First question usable immediately.** Empty roles/locations now render
  an editable blank row at once (no Add-first discovery); typing creates
  the corresponding draft entry. The draft stays parent-controlled;
  props are never mutated and examples are never inserted. Add-another
  and Remove behavior is retained.
- **Consistent save state.** While `saving`, every input plus add/remove,
  Back and submit is disabled, so the displayed answers cannot diverge
  from the submitted snapshot. Tests prove edits during a pending save
  are blocked and editing + retry resume after a failed save.
- **Realistic validation focus.** A `DeferredErrorHarness` parent passes
  no errors until Continue; the step then focuses the first invalid
  control once the errors render. Empty-list errors resolve to an
  actionable target (the blank role/city input). Validation rules stay
  parent-owned via `validateQuestion`; none are duplicated.
- **Copy refined.** Implementation-detail copy ("There is no saved 'not
  sure' answer…") and the "only held in this session until reviewed"
  claim were removed in favor of helpful wording; the footnote now
  explains that searching begins after the search plan is confirmed.
- **Focused tests run (exact result, after corrections):**
  - `npx vitest run tests/onboarding-preferences.test.tsx` — **22/22 PASS**
    (15 original scenarios + 7 new: employment-semantics regression,
    empty-roles blank row, empty-locations blank row, controls disabled
    while saving, edits blocked during a pending save + resume after
    failure, deferred-error focus on roles, deferred empty-location
    focus target).
  - Combined related suites: `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/search-profile-ui.test.tsx tests/jobs-page-ui.test.tsx` — **101/101 PASS** (65 contract + 22 interaction + 14 existing UI).
- **Static gates (exact result, after corrections):**
  - `npx tsc --noEmit` — clean (exit 0).
  - `npx eslint` on `PreferencesStep.tsx` and `tests/onboarding-preferences.test.tsx` — clean.
  - `npx prettier --check` on `PreferencesStep.tsx`, `onboarding.css`,
    `tests/onboarding-preferences.test.tsx` and the updated docs — conforming.
  - Markdown link resolution on changed docs — OK; `git diff --check` — clean.
- **Checks NOT run (unchanged):** full `npm run verify` suite not
  executed; **no browser/visual check** — passing jsdom tests do not
  verify layout or 200% zoom, and no preview route exists; no axe audit.

### Accepted

- **Accepted by the Codex reviewer on 2026-09-19** after the
  review-corrections round. MR1-02 moved to **Done** on the delivery
  board and its claimed files were released back to the unclaimed
  bucket. Release status remains **Not shipped**.
- **Outstanding checks are NOT passed and are deferred as explicit
  acceptance items:** the visual, narrow-window and 200% zoom checks of
  the component in the integrated wizard belong to **MR1-06** (connect
  and review wizard screens) and **MR1-07** (validate installed
  onboarding and first-user experience). Passing jsdom tests prove
  behavior only; no browser preview or zoom rendering was run, so
  layout/zoom verification was **not** performed or claimed here.

## Handoff

- **What works:** a self-contained, contract-driven `PreferencesStep`
  that renders exactly the enabled questions one at a time with the
  required copy, examples, error placement, save/retry UX and
  accessibility mechanics, fully covered by interaction tests through a
  test-only parent. Empty roles/locations start with an editable blank
  row so the first question is immediately usable; every control is
  disabled during a pending save; and a parent that reveals errors only
  after Continue still gets the first invalid control focused. Employment
  types are presented with exact-match semantics and `'unknown'` is
  labeled truthfully. No shared contract was modified and no
  incompatibility was found, so the contract surface remains owned by
  MR1-01.
- **What remains (roles per D11: OpenCode implements, Codex reviews,
  an optional contributor optional):**
  - **First-start wiring, a parent wizard, routing and real saving** are
    later tasks (MR1-04 stores/restores `OnboardingProgressSnapshot` and
    wires confirmed preferences through existing profile services;
    MR1-06 builds the parent screen, routing and API integration). Until
    then the component proves its behavior only through the test harness.
  - **Visual review deferred, not passed.** Opening the component under
    the integrated wizard to check the scoped styles at narrow widths
    and 200% zoom was **not** performed by MR1-02 (no preview route
    exists; jsdom tests do not verify layout or zoom). These checks are
    explicit acceptance items for **MR1-06** (connect and review wizard
    screens) and **MR1-07** (validate installed onboarding and
    first-user experience).
  - MR1-03 (OpenCode; optional an optional contributor slice): review/confirmation step +
    UI tests; MR1-05: search-plan preview; both use the same prop
    patterns.
  - Product decisions recorded here but not re-litigated: employment
    types are exact matches (`'unknown'` is a truthful "unspecified
    employment type" option, stored as the literal enum value); no "Open
    to all" shortcut. Salary-period representation (L1) remains pending
    before any salary screen, and remote "not sure" handling (L2) — this
    step intentionally offers **no** remote "not sure" path.
- **Reviewer acceptance:** accepted by the Codex reviewer on 2026-09-19;
  MR1-02 is **Done** on the delivery board and its claimed files are
  released.
- **Next concrete action:** MR1-02 is **Done**. The next task is MR1-03
  (review/confirmation screen; OpenCode implements, Codex reviews) —
  not started. The board remains the status authority.

## What this task did **not** do

- Did not add a production route, first-start flow, API, database,
  migration, persistence, discovery, scoring, notification or salary
  change; did not add dependencies or frameworks.
- Did not modify any existing schema, contract type, validator,
  component, or stylesheet outside the new `onboarding-` namespace.
- Did not run the app, a browser preview, discovery, installer, package,
  or touch production data.
- Did not commit, push, publish, or release; did not start another row.

## Release status reminder

This task does not ship an application release. Release status remains
tracked on the delivery board, not on this card.
