# MR1-01 — Decision: first onboarding contract, fixtures and file ownership

**Date:** 2026-09-18 (revised a third time for the final review
corrections: question-navigation contract, deferred salary, restored
intent, contributor roles)
**Status:** In review; board is the status authority
([`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md)).

## Problem

The wizard must guide a new user through preferences one clear decision
at a time, let uncertainty stay expressible without inventing
preferences, and hand confirmed values to the existing profile
services — without a second profile authority, a new storage layer, or
a competing schema. This document records the frozen contract
(types, parsing rules, answer-state semantics, the question-navigation
contract, an enabled-versus-supported question distinction, a review
boundary, fixtures, and ownership) plus the unresolved limitations that
later tasks must respect.

## Decisions

### D1. Numeric parsing uses an explicit, documented decimal syntax

Accepted: an optional decimal part over plain digits after trimming,
i.e. `^\d+(?:\.\d+)?$`. Blank is **null / not provided** and stays
distinct from an explicit `0`. Rejected: hexadecimal (`0x10`), sign
(`-5`, `+5`), scientific notation (`1e3`), thousands separators
(`70,000`), currency symbols (`$70000`), and incomplete decimals such
as a leading dot (`.5`) or trailing dot (`70000.`) — those are user
mid-edits and are reported, not silently accepted. `parseAmountText`
implements this; radii additionally require a positive whole-number
value (`"50.0"` is a whole number and is accepted); salary amounts only
require a non-negative value. Zero is a valid explicit amount for
salary and stays distinct from a blank (blank ⇒ no preference).

### D2. Draft numerics are strings, blank means "not provided"

`OnboardingPreferencesDraft` keeps radii and salary amounts as
`string`. An empty input is never coerced to `0` or `NaN`; it keeps
meaning "not answered". This mirrors the existing `ProfilePage` inputs.

### D3. Unanswered preferences are explicit; nothing is silently assumed

- `createEmptyPreferencesDraft()` returns **`remotePreference: null`**
  with answer state `'unanswered'` — the old silent `'preferred'`
  default is **removed**.
- The draft carries `answers: { remotePreference, desiredSalary }` with
  per-question state `'unanswered' | 'answered' | 'skipped'`. This
  metadata lives in the **onboarding draft**, never in the saved-profile
  schema.
- For list/blank questions (roles, locations, radii, employment types)
  emptiness **is** the "unanswered" state; no separate flag is needed.
- Required questions (roles, location, travel distance, remote work,
  employment types) must reach a valid answered state before the draft
  can convert; an unanswered required value **cannot** become a saved
  preference.
- Remote work can express `'unanswered'`; `'skipped'` is not accepted
  for it because the saved profile cannot represent a skipped remote
  choice (see Limitation L2).
- Salary is supported by the contract but **deferred in the enabled
  flow** (D4a, L1).

### D4. Salary semantics

- Only `answers.desiredSalary === 'answered'` uses the amounts; then
  **both** minimum and target are required, `target >= minimum`, and
  currency is a 3-letter code (default `USD`).
- `'unanswered'` / `'skipped'` salary converts to `null` (no
  preference). Typed amounts while not set to "included" are a
  validation error on the amount fields so draft data is never
  silently discarded.
- **No period/annualization semantics exist** (Limitation L1). Raw
  values are numbers without an implied unit; the scoring engine
  compares them against job `salaryMinimum`/`salaryMaximum` without
  conversion, and the contract preserves that.
- **Converted output is always null-safe at merge:** a null value in
  converted preferences means "not provided", never "clear this
  preference". `mergePreferencesIntoProfile` therefore **does not
  overwrite** an existing profile field with a null (D7). A deliberate
  future "clear salary" action will need an explicit mechanism when the
  salary question is enabled; that mechanism is not invented here.

### D4a. Salary is deferred until salary-period semantics exist (L1)

The current onboarding UI **does not present the salary question**:

- `ONBOARDING_ENABLED_QUESTION_SEQUENCE` is the walk the wizard uses
  and **omits `'salary'`**; salary stays reachable in
  `ONBOARDING_QUESTION_SEQUENCE` (the full supported contract).
- Omitting the salary question must **not clear an existing profile
  salary**: a deferred draft converts to `desiredSalary: null` and the
  merge step leaves the existing saved salary untouched (D4, D7). A
  regression test proves an existing salary survives the deferred flow.
- `validatePreferencesDraft` and `firstUnresolvedQuestion` default to
  the enabled sequence, so an untouched salary never blocks validation
  or progression. `convertPreferencesDraft` still validates the **full**
  supported contract before producing output, so a half-entered salary
  block can never be mis-applied even though the enabled walk skips it.
- The salary UI may return only after a dedicated task adds a
  salary-period representation to saved-profile semantics, provider
  mapping and scoring. Until then, no onboarding surface labels raw
  amounts with a period (annual/hourly) or promises conversion.

### D5. Question-navigation contract

`OnboardingQuestion` is a closed union with the fixed full order in
`ONBOARDING_QUESTION_SEQUENCE`:
**desired-work → location → travel-distance → remote-work →
employment-types → salary**, and the enabled walk in
`ONBOARDING_ENABLED_QUESTION_SEQUENCE` (same order, salary omitted).
`getNextOnboardingQuestion` / `getPreviousOnboardingQuestion` walk a
sequence (default enabled) for parent navigation.

`OnboardingPreferencesStepProps` carries `currentQuestion:
OnboardingQuestion` alongside the draft, errors and save state, with an
explicit callback contract — **the component never saves, navigates or
invents a value**:

- `onChange(next)` — parent applies the updated draft **without
  advancing**.
- `onContinue()` — parent validates the **current question**; if valid,
  it advances to the next enabled question.
- `onBack()` — parent moves backward one enabled question, **preserving
  all answers**.
- Completing the **final enabled question** requests final validation
  and saving instead of advancing.
- The parent **restores `currentQuestion` from the progress snapshot**
  when a session resumes.

Validation helpers:

- `validateQuestion(draft, question)` returns errors **for one question
  only**, so the UI validates the current question without surfacing
  errors on untouched later questions.
- `validatePreferencesDraft(draft, sequence?)` validates the default
  enabled sequence (salary omitted) or any explicit sequence.
- `firstUnresolvedQuestion(draft, sequence?)` returns the first enabled
  question that must be (re-)answered, for routing new users, returning
  users and go-back corrections; the default ignores the deferred
  salary.

### D6. A persistable progress snapshot for MR1-04

`OnboardingProgressSnapshot` = `{ version: 1, onboardingStep,
currentQuestion, answers }` (the full draft, including answer states).
`createProgressSnapshot` builds it. It is the **format MR1-04 will
store and restore** (likely as versioned JSON in `app_settings` if
suitable); **this task implements no storage** and adds no migration.
**Restored intent mapping (L4):** a saved profile with
`desiredSalary: null` is prefilled as **`'unanswered'`** because "never
considered" versus "declined" cannot be recovered from the saved value;
only an actual stored snapshot that recorded `'skipped'` restores a
deliberate skip.

### D7. Single schema authority for validated preferences; null-safe merge

`onboardingValidatedPreferencesSchema` reuses `candidateProfileSchema.shape`
for the seven preference fields and adds the secondary `>=` primary
refine. Anything that converts and is then merged into a profile
satisfies `candidateProfileSchema` by construction.
`mergePreferencesIntoProfile` preserves unrelated profile fields and
**skips null-valued converted fields** (D4) so absent answers never
wipe existing data.

### D8. Error shape separates validation from save failures

Per-field messages (roles, radii, remote, employment types, salary
object), per-location-row entries (`{ index, city?, state? }`), and an
empty-location marker. Save failures are `saveError: string | null`
with the draft retained; they are not validation errors. **Error
wording is not part of the frozen contract** — tests assert validity,
error-field location, and conversion behavior, not verbatim wording.

### D9. Guidance: suggestions require confirmation; nothing is promised

`OnboardingReviewItem` (`field: 'skills' | 'certifications'`, `status:
confirmed | suggested | unknown`, `reason`) reuses existing resume
proposal representations. Suggestions **require user confirmation** and
never become confirmed facts automatically. The application cannot yet
produce job suggestions or auto-certified claims, so guidance copy and
fixtures must not promise automatic suggestions that are not
implemented.

### D10. Storage and integration boundaries

Confirmed preferences live only in the existing profile authority.
Wizard progress storage is MR1-04 (decision deferred from this task).
No routes, APIs, migrations, UI, or persistence exist from this task;
search-plan execution and discovery start only after user confirmation
(MR1-05). Shared contracts after acceptance are edited by the
implementation owner (OpenCode) with Codex review; anyone needing a
contract change requests it on this decision record rather than
defining a competing type.

### D11. Contributor roles

- **OpenCode handles scheduled implementation** of board tasks.
- **Codex reviews** implementation before acceptance.
- **an optional contributor may optionally claim a small, clearly bounded contribution**
  (for example a single sub-component or a focused test slice).
- **Planned implementation must not depend on an optional contributor completing a
  learning task.** [`docs/DUSTIN_FIRST_CODING_TASK.md`](../../DUSTIN_FIRST_CODING_TASK.md)
  is an **optional learning guide**, not a required assignment; the
  board rows do not wait on it.
- **Do not overwrite work an optional contributor has already claimed or started.**
  Coordinate overlapping files first (one owner per file at a time,
  including CSS and shared types).
- Task mapping (scheduled implementation — OpenCode; review — Codex;
  an optional contributor participation optional): MR1-02 preferences flow + tests,
  MR1-03 review screen + tests, MR1-04 progress storage + profile
  integration, MR1-05 search-plan preview, MR1-06 parent screen /
  routing / API / retry-cancel. MR1-07 is a joint validation task.

## What this contract supports

- Representing a new user with **no answers** and proving no silent
  default is chosen.
- A guided, one-question-at-a-time walk where the parent owns the
  current question, navigation and saving, with `onChange` /
  `onContinue` / `onBack` semantics encoded in the props contract.
- Expressing **uncertainty** (`'unanswered'`) and an **explicit skip** of
  the optional salary question, with a snapshot-recorded skip kept
  distinct from a saved-null prefill (L4).
- Resuming a partial session from `OnboardingProgressSnapshot`
  (draft + current question) via `firstUnresolvedQuestion`.
- Correcting an earlier answer without losing later answers (parent
  state + merge/round-trip helpers).
- Strict, documented numeric parsing that keeps blank distinct from
  zero, and preserves the existing salary/radius constraints.
- Converting only well-formed answers into saved-profile-compatible
  preferences (7 fields), where a **deferred salary never clears an
  existing saved salary** during merge.
- Keeping the salary question reachable in the supported contract for
  future enablement (L1) while the enabled walk omits it today.

## What is UI behavior to implement later (not this task)

One-question-at-a-time screens in the enabled order driven by the
`currentQuestion` prop and the `onChange`/`onContinue`/`onBack`
contract; plain-language explanations, examples and optional help;
per-question validation via `validateQuestion` (never showing errors for
untouched questions); **the deferred salary question is NOT presented
at all** until L1 is resolved; "not sure" handling on remote work with
copy that does not promise auto-chosen preferences; review-and-confirm
for suggested items. These are MR1-02 / MR1-03 / MR1-06 work and must
not be built here.

## What is persistence to implement in MR1-04

Storing and restoring `OnboardingProgressSnapshot` (version 1) —
including current question and all answer states — through the existing
`app_settings`-style JSON envelope **if suitable**, wired into the
existing profile services; version-conflict handling on resume; the
parent restores `currentQuestion` from the stored snapshot. No second
profile authority; no schema change to the saved profile.

## What is final integration and first-start behavior to implement later

Parent screen, routing, and API wiring (MR1-06); the experience step
(step names exist, props deliberately unfrozen); review-screen
persistence of confirmed items; search-plan preview (MR1-05) and
post-confirmation execution; first-run flow tests and installed-app
validation (MR1-07).

## Unresolved limitations (reviewer product decisions remain pending)

### L1. No salary-period field exists anywhere

- **Impact:** salary amounts cannot be meaningfully labeled
  annual/hourly/period; presenting raw numbers with a period claim would
  be wrong and inventing a conversion would change match semantics.
- **This round's contract response:** the enabled question sequence
  **omits the salary question for now**; the salary UI is deferred until
  salary-period semantics are resolved; omitting the question **must
  not and does not clear an existing profile salary** (merge null-skip,
  regression-tested); no onboarding surface labels amounts with a period
  or converts them.
- **Proposed next action:** a dedicated task (before any salary screen
  ships) to add an explicit salary-period representation to saved
  profile semantics, provider salary mapping, and scoring. This is not
  marked accepted here; the reviewer decides the product direction.

### L2. Remote "not sure" cannot be persisted in the saved profile

- **Impact:** the saved schema requires one concrete remote value, so an
  unsure user cannot attach a stored "ask me later" state; required
  remote work must be resolved before searching.
- **Proposed next action:** keep uncertainty in draft metadata only;
  if a stored "ask later" is wanted, that is a separate saved-profile
  schema-change task (reviewer decision, not accepted here).

### L3. No automatic suggestions are implemented

- **Impact:** guidance must not promise auto-suggested jobs or
  self-certified facts. Review suggestions come only from existing
  resume extraction and always require confirmation.
- **Proposed next action:** none within MR-1 scope; keep the review
  boundary and copy honest (no acceptance claimed on the reviewer's
  behalf).

### L4. Prefilled salary intent cannot be recovered from a saved null

- **Impact:** a saved `desiredSalary: null` cannot distinguish "never
  considered" from "declined", so `toPreferencesDraft` restores it as
  **`'unanswered'`**. A deliberate skip is recoverable **only** from an
  actual stored snapshot that recorded `'skipped'`.
- **Proposed next action:** MR1-04 restores intent from the stored
  snapshot, not from the saved salary; prefill stays `'unanswered'`
  when no snapshot exists. Contract change complete; the reviewer
  accepts or amends.

### L5. Error wording is not frozen

- **Impact:** UI may reword messages; tests must assert validity and
  error-field location rather than verbatim strings.
- **Proposed next action:** none; existing tests already follow this.

## Alternatives considered

- **Silent `'preferred'` default.** Rejected (D3): invents a
  preference for a new user.
- **All-numeric draft.** Rejected: blank cannot be represented; a `0`
  default changes meaning.
- **Tolerate a single salary amount / interpret as target.** Rejected:
  ambiguous and inconsistent with existing `ProfilePage` save behavior.
- **Accept `Number()` coercion broadly** (hex, scientific, separators).
  Rejected: unintended formats silently reinterpret user input.
- **Validate every question at once always.** Rejected: shown as D5,
  the UI governs the current question and untouched questions stay
  quiet.
- **Merging null over an existing salary.** Rejected (D4/D7): a deferred
  salary question would wipe an existing preference on confirmation;
  merge writes only non-null values and a deliberate future "clear"
  needs its own explicit mechanism.
- **Including salary in the enabled walk now.** Rejected (D4a/L1): the
  question cannot be presented honestly without a period; keeping it
  enabled would force a product lie or a half-finished feature.
- **`validatePreferencesDraft` defaulting to the full contract.**
  Rejected: the wizard's canonical scope is the enabled sequence;
  convert guards the full contract separately so partial salary blocks
  are never mis-applied.
- **Second "wizard profile" storage authority.** Rejected: progress is a
  snapshot for MR1-04 via `app_settings`-style JSON if suitable, not a
  new schema authority.
- **an optional contributor as the scheduled MR1-02 owner.** Replaced (D11): OpenCode
  implements on the schedule; an optional contributor's guide stays as an **optional**
  learning path and does not gate any board row.
- **Frozen user-facing wording.** Rejected (L5/D8): the contract freezes
  shapes and semantics, not copy.
- **Fixture realism.** Rejected: fictional data only; no real candidate
  or employer data anywhere.

## Concrete layout

### Types — `src/models/onboarding.ts` (new)

`OnboardingLocationDraft`, `OnboardingSalaryDraft`, `RemotePreference`,
`OnboardingQuestionState`, `OnboardingAnswerStates`,
`OnboardingPreferencesDraft` (string numerics, nullable remote,
`answers` metadata), `OnboardingValidatedPreferences` (Pick of the
seven profile fields), location/salary/field error shapes,
`OnboardingSaveState`, `OnboardingPreferencesStepProps` (extends
`OnboardingSaveState`, carries `currentQuestion` and the
`onChange`/`onBack`/`onContinue` callbacks) + `OnboardingReviewStepProps`,
`OnboardingReviewStatus`, `OnboardingReviewItem`, `OnboardingStep`,
`OnboardingQuestion`, `OnboardingEnabledQuestion` (contract minus the
deferred salary), `OnboardingProgressSnapshot` (versioned),
`PreferencesConversionResult`.

### Validation and conversion — `src/schemas/onboarding.ts` (new)

Pure, side-effect-free: strict decimal `parseAmountText`; draft/enum
schemas; `onboardingValidatedPreferencesSchema` (reuses
`candidateProfileSchema.shape`); `onboardingProgressSnapshotSchema`;
`ONBOARDING_QUESTION_SEQUENCE` (full), `ONBOARDING_ENABLED_QUESTION_SEQUENCE`
(enabled, salary omitted), `REQUIRED` / `OPTIONAL`;
`validateQuestion`, `validatePreferencesDraft(draft, sequence?)`,
`firstUnresolvedQuestion(draft, sequence?)`,
`getNextOnboardingQuestion` / `getPreviousOnboardingQuestion`,
`createProgressSnapshot`, `convertPreferencesDraft` (discriminated
result; guards the full contract), `pickPreferencesFromProfile`,
`mergePreferencesIntoProfile` (null-safe: skips null-valued fields),
`toPreferencesDraft` (null salary → `'unanswered'`), `createEmptyPreferencesDraft`
(no silent defaults).

### Fixtures — `src/client/fixtures/onboarding.fixture.ts` (new)

Fictional-only with an explicit fiction declaration. States:
enabled-flow complete (salary deferred, unanswered); full-contract
complete (salary answered, for future enablement); first-time user with
no answers; snapshot-recorded deliberate salary skip; resumed partial
session at the current question (+ progress snapshot at
`'travel-distance'`); corrected earlier answer; missing location; empty
roles; empty employment types; invalid radius; invalid salary range;
saving props (current question = final enabled question); save-failure
props with answers preserved; review items spanning
confirmed/suggested/unknown.

### Tests — `tests/onboarding-contract.test.ts` (new)

Validity, error-field and conversion focus: blank-vs-zero and the
strict parsing matrix (hex/scientific/separators/signs/incomplete
decimals); answer-state semantics (no silent remote choice, skipped vs
deferred salary, inconsistent-state errors); enabled-versus-supported
distinction (default validation ignores salary, convert guards the full
contract); required-before-search rule; the question-navigation contract
(current question prop, callback signatures, next/previous walk,
final-question completion); per-question `validateQuestion` scoping;
`firstUnresolvedQuestion`; progress-snapshot round-trip and resume
invariant (given snapshot ⇒ current question equals the first
unresolved enabled question); schema compatibility after merge; the
deferred-salary regression (existing profile salary survives merge);
restore intent (null salary → `'unanswered'`, snapshot-recorded skip
kept); no input mutation (deep-freeze); merge preservation; draft
round-trip; type-level checks with `expectTypeOf`. No verbatim
error-wording assertions.
