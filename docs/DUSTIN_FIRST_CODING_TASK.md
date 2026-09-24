# MR1-02 — Build the onboarding preference screen (OPTIONAL learning guide)

**For:** an optional contributor. This is an **optional learning guide**, not a required
assignment and not a gating dependency for any board task.
**Implementation:** MR1-02 is implemented on the schedule by **OpenCode**
and reviewed by **Codex** (roles per decision D11 in the MR1-01 decision
record). an optional contributor may optionally claim a small, clearly bounded slice of
it — for example a single sub-component or a focused test group. Before
starting anything, check the delivery board for what OpenCode has
already claimed or started and **coordinate overlapping files first**
(one owner per file at a time). Never overwrite work already in
progress.

**Status/owner authority:** Companion delivery board
([`docs/JOB_BROWSER_DELIVERY_BOARD.md`](JOB_BROWSER_DELIVERY_BOARD.md)).
**Dependency:** MR1-01 accepted out of Review — the contract types,
validation helpers, and fictional fixtures are already frozen and
available.
**Goal (if you take the slice):** create a real reusable application
component, not a throwaway HTML mockup.

## What the preferences flow will do

A preferences flow that guides the user **one clear decision at a
time** in the contract-defined enabled order: desired work → location →
travel distance → remote work → employment types. Plain-language copy,
examples, optional help, and Back/Continue navigation. **The salary
question is NOT presented** until salary-period semantics are resolved
(L1 in the decision record). The parent owns saving, navigation and the
current question; the component never saves, navigates, or invents a
preference on its own.

## Your files (coordinate with the current owner)

All paths below are relative to the repository root.

| File                                                   | Your work (if claimed)                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/client/components/onboarding/PreferencesStep.tsx` | New React component, labeled inputs, add/remove role controls/buttons |
| `src/client/styles/onboarding.css`                     | Feature-scoped styles; claim this file while editing it               |
| `tests/onboarding-preferences.test.tsx`                | Tests for meaningful form behavior                                    |

The frozen contract is already published and owned by MR1-01: types in
`src/models/onboarding.ts`, pure validation/conversion helpers in
`src/schemas/onboarding.ts`, and fictional fixtures to drive your
development in `src/client/fixtures/onboarding.fixture.ts`. Import
`OnboardingPreferencesDraft`, `OnboardingPreferencesStepProps`,
`ONBOARDING_ENABLED_QUESTION_SEQUENCE` and `validateQuestion` from the
onboarding modules (never redefine them), and build editor views from
the fixtures (`fictionalPreferencesDraftComplete`,
`fictionalFirstTimeUserDraft`, `fictionalResumedProgressDraft`,
`fictionalCorrectedLocationDraft`, and the save-state props fixture).
The integration owner imports the stylesheet and connects your
component in `OnboardingPage.tsx`. Ask for a contract correction on the
MR1-01 decision record if a required field is missing rather than
defining a second incompatible type.

Useful existing examples: `src/client/components/OccurrenceFields.tsx`,
`States.tsx`, `src/client/pages/ProfilePage.tsx`, and
`tests/applications-ui.test.tsx`. These are reference files, not
automatically part of your edit scope.

## Work in small steps

1. Render headings, field labels and the Back/Continue buttons using the
   agreed props and a fictional fixture.
2. Walk one question at a time in `ONBOARDING_ENABLED_QUESTION_SEQUENCE`
   order. Validate only the current question with
   `validateQuestion(draft, currentQuestion)` so untouched questions
   never show errors; the parent tracks `currentQuestion` and the next
   transition.
3. Wire each input to `onChange` without mutating the supplied `value`
   object; keep the parent draft as the source of truth, including
   `answers` state updates (e.g., set `remotePreference` to `answered`
   when chosen).
4. Add/remove desired roles; preserve useful entries and show the
   contract empty-state error.
5. Show errors next to the relevant fields and connect them with
   `aria-describedby`. Keep typed values visible when saving fails.
6. Disable duplicate Continue actions while `saving`; label the action
   “Saving…” and expose status accessibly.
7. Test the core interactions. Then demonstrate the screen and ask for
   a review before expanding scope.

## Important details

- The empty draft has **no remote-work choice**: `remotePreference` is
  `null` and `answers.remotePreference` is `'unanswered'`. Do not
  default it; the user must explicitly answer before continuing past
  that question.
- Questions carry explicit `answers` state (`unanswered`/`answered`/
  `skipped`). All enabled questions (work, location, distance, remote,
  employment types) must reach `'answered'`.
- **There is no salary question in the current flow** (L1). The draft
  still has a salary field and `answers.desiredSalary` (supported
  contract for future use), but the UI must not present it, must not
  label amounts with a period (annual/hourly), and must never clear an
  existing saved salary. `convertPreferencesDraft` maps the untouched
  salary to null and the merge step preserves existing data.
- Numeric inputs (radii) stay **strings in the draft** and obey the
  strict decimal syntax (`digits with optional decimal part`). Hex,
  commas, signs, and scientific notation are rejected; blank is
  distinct from zero.
- Wider search distance cannot be smaller than preferred distance. The
  rule comes from `src/schemas/onboarding.ts` (and the candidate
  schema); render the returned per-field messages rather than inventing
  your own wording.
- Remote options map to existing values: `preferred`, `accepted`,
  `not-preferred`. Friendly labels can differ; stored meanings must
  not.
- Do not discard existing profile fields that this screen does not edit.
- Guidance copy must be honest: no automatic job suggestions or
  certified-fact claims are promised (only resume-derived review items
  later, which still need confirmation). Optional help/examples are
  welcome; keep them accurate.
- Every input needs a visible label. The form must work with Tab,
  Shift+Tab, Space and Enter; validation must not trap keyboard focus.
- No database calls, file access, discovery runs, new packages or
  scoring changes in this component. Progress persistence is MR1-04,
  not this task.
- Coordinate with OpenCode on the delivery board before claiming any
  file; do not edit a file another task already owns.

## Acceptance checklist (for the slice, if claimed)

- [ ] Editing a field produces the correct updated draft (value +
      `answers` state) through `onChange`.
- [ ] Questions appear one at a time in the enabled order; untouched
      questions show no errors; salary is not presented.
- [ ] The empty draft never defaults remote work; an unanswered
      mandatory question blocks Continue with an associated error.
- [ ] Numeric fields reject unintended formats and keep blank distinct
      from zero.
- [ ] Field validation errors are visible and associated with inputs.
- [ ] While saving, repeated clicks cannot trigger duplicate requests.
- [ ] Back/Continue callbacks fire as specified; the component does not
      navigate on its own.
- [ ] Labels, focus order and 200% zoom are usable; guidance copy never
      promises auto-suggested jobs or a salary period.
- [ ] Fictional examples cover an enabled-complete draft, a first-time
      user, a resumed session and a save failure.
- [ ] Reviewer accepts the integrated save/reload behavior before this
      is marked Done.

## Suggested focused checks

From your isolated working copy, after dependencies are already
available:

```powershell
npm run typecheck
npm run test -- tests/onboarding-preferences.test.tsx
```

These commands are proposed for when the test exists; they were not run
as part of preparing this guide. The integration owner handles the
broader checks and release build. Use a disposable development
profile/database for previews, never your installed application's live
data.

## If you get stuck

Share the exact error, the file you are editing and what you expected
to happen. For a design question, show the smallest component/field
involved. Good checkpoints are "all fields render," "change callbacks
work," and "validation tests pass," rather than finishing the entire
page before asking for feedback.

Your contribution (if you claim a slice) will be part of the actual
preference component used by the app; integration should connect it,
not replace it.
