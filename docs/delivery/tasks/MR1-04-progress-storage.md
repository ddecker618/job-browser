## Status

- **Done** — accepted by the Codex reviewer on **2026-09-24**.
- **Accepted commits:** `877c31f` (`feat: add onboarding foundation
through progress persistence`) and `c00c224` (`fix: preserve
onboarding resume failure states`).
- **Independent reviewer validation:** TypeScript PASS; 4-file
  onboarding focused suite (`tests/onboarding-contract.test.ts` +
  `tests/onboarding-preferences.test.tsx` +
  `tests/onboarding-review.test.tsx` +
  `tests/onboarding-progress-storage.test.ts`) — **122/122 PASS**; the
  discriminated `OnboardingResumeResult` / `OnboardingResumeQuestion`
  contract preserves valid / missing / malformed / unsupported-version /
  storage-failure states correctly.
- **Claimed files released** back to the unclaimed bucket; onboarding
  remains **Not shipped**; MR1-05 is the next authorized task; MR1-06
  remains not started; no push, version bump, installer build, or
  production-data access occurred.

# MR1-04 — Save and restore onboarding progress

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md).
**Dependencies:** MR0-01, MR1-01, MR1-02, MR1-03
**Implementation owner:** GitHub Copilot
**Reviewer:** Codex

## Outcome

MR1-04 persists profile-scoped `OnboardingProgressSnapshot` data through the existing `app_settings` SQLite authority and applies validated preferences and explicitly confirmed review facts through the existing unified profile-preferences service. Profile writes happen before progress is cleared, so a failed write leaves recoverable progress for retry.

## Implementation

- Canonical repository: `src/repositories/onboarding-repository.ts`.
- Canonical service: `src/onboarding/onboarding-service.ts`.
- Profile-scoped keys use `onboardingProgress:<profileId>` to prevent cross-profile restoration.
- Load results distinguish `missing`, `valid`, `malformed`, `unsupported-version`, and `storage-failure`.
- Invalid or newer stored progress cannot be silently replaced; callers must explicitly reset it first.
- Snapshot version 1 remains readable with no review items. Version 2 stores review items, stable IDs, edited values, reasons and confirmation states.
- A stored disabled `salary` position is recovered to the first enabled unresolved question without changing stored answers.
- Confirmed review facts are unioned idempotently into existing skills/certifications. Suggestions, unknown items and removals do not erase existing profile facts.
- `CompleteOnboardingOptions` carries an explicit `profileId` so the storage key is never inferred from a possibly replaced or stale `CandidateProfile`.

## Resume contract (discriminated)

`resumeOnboardingProgress` returns `OnboardingResumeResult`, a discriminated
union the integration layer can switch on exhaustively:

- `kind: 'ready', source: 'stored'` — the stored snapshot is returned
  verbatim and a stored disabled `salary` currentQuestion is recovered to
  the first enabled unresolved question. The stored row is not rewritten
  merely by loading or resuming it.
- `kind: 'ready', source: 'fresh'` — **the only** state allowed to mint a
  new version-2 snapshot from the supplied draft (arises from a
  `missing` load). Sets `currentQuestion` to `firstUnresolvedQuestion(draft)`
  and leaves `reviewItems` empty.
- `kind: 'blocked-malformed'` — preserves the original `Error` returned
  by `loadOnboardingProgress`; no fabricated snapshot.
- `kind: 'blocked-unsupported-version'` — preserves the unsupported
  `version` number; no fabricated snapshot; an explicit reset or
  migration is required to replace it.
- `kind: 'blocked-storage-failure'` — preserves the original `Error`;
  the integration layer must never describe it as a missing first-run
  session.

`currentOnboardingQuestion` returns `OnboardingResumeQuestion`, which
collapses the same blocked/error variants but only emits a nullable
`question` on the `ready` branch. A plain `null` is reserved for a
legitimate completed step and never stands in for a blocked state.

## Review-corrections passes

### 2026-09-20 — first review pass

The following Codex review findings were applied in this correction pass;
the task remains in **Review** awaiting Codex acceptance.

1. **Documentation hygiene.** The replacement character in the heading was replaced with a normal em dash; two stale absolute repository references (`docs/DUSTIN_FIRST_CODING_TASK.md`, `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`) now refer to the repository root and acknowledge the OneDrive move. No replacement characters remain in the new onboarding source, tests, or delivery documents.
2. **Generated test-output artifacts.** `vitest-report.json` and `vitest-review.json` (older `--reporter=json` outputs) were removed from the working tree. Narrow `.gitignore` entries were added for those two filenames only — no broad JSON ignore rule.
3. **Real database adapter.** A new disposable-SQLite test (`tests/onboarding-progress-storage.test.ts`) exercises **save, load, and reset** end-to-end through `createDatabaseOnboardingProgressStore` itself, going beyond the prior test that only wrote through `DashboardRepository` and read one raw setting through the adapter.
4. **Version compatibility.** A new test stores a valid version-1 snapshot and asserts: it loads with `kind: 'valid'`, the stored preferences and `currentQuestion` are preserved, `reviewItemsFromProgress` returns an empty list for v1, and the underlying row is not silently rewritten as version 2 by merely loading it.
5. **Storage-write failure behavior.** Independent tests cover read failure (no `saveSetting` reached), write failure after a successful read (followed by a load that still reports `missing`, never success), and reset failure (the progress remains present and reportable after the failed reset).
6. **Failure ordering and retry idempotence.** A new test runs the full sequence: existing progress present → unified profile write succeeds → clearing progress fails → the completion call surfaces the reset failure and progress remains recoverable → retrying completion does **not** duplicate confirmed skills or certifications → a later successful reset clears the exact original `onboardingProgress:<profileId>` key and nothing else. To make the storage key unambiguous, `CompleteOnboardingOptions` now carries an explicit `profileId: string`; every affected test and caller was updated consistently.
7. **Malformed and unsupported progress.** A new test demonstrates that malformed and unsupported-version progress is distinguishable from missing progress, **cannot** be silently overwritten (save throws), requires an explicit reset, and remains recoverable/reportable until the reset succeeds.
8. **Conservative profile application.** A new test confirms: suggestions and unknown items are not applied; confirmed blank values are not applied; existing skills, certifications, salary, and unrelated profile fields survive; repeated confirmation is idempotent; an unsuccessful profile write never clears progress; and the onboarding service does not write directly through SQLite as a second authoritative candidate-profile store.

### 2026-09-24 — resume-contract fix (Codex P1 blocker)

`resumeOnboardingProgress` previously collapsed every non-`valid`
load result into a fresh version-2 snapshot, which contradicted the
MR1-04 task-card claim that malformed / unsupported / storage-failure
states remain visible to the integration layer. That fix is preserved
in the local commit `feat: add onboarding foundation through progress
persistence` (`877c31f`) and is followed by this second correction
pass:

9. **Resume is now a discriminated result.** `resumeOnboardingProgress`
   returns `OnboardingResumeResult`; `currentOnboardingQuestion` returns
   `OnboardingResumeQuestion`. Both preserve the original
   `error`/`version` for the three blocked variants. Only a `missing`
   load can produce a fresh snapshot (`source: 'fresh'`). The stored
   snapshot is returned verbatim for `valid` loads and the stored row
   is not rewritten by resuming it.

### Validation evidence (correction passes)

- **Focused tests (exact result).**
  - `npx vitest run tests/onboarding-progress-storage.test.ts` —
    **19/19 PASS** (6 prior MR1-04 tests + 7 first-pass correction
    tests + 6 second-pass resume-contract tests covering each of the
    five load kinds and an exhaustive-switching assertion across all
    five).
  - `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/onboarding-review.test.tsx tests/onboarding-progress-storage.test.ts` —
    **122/122 PASS** (65 contract + 22 preferences + 15 review + 20
    progress storage).

- **Full gates (exact result).**
  - `npm run verify` — clean. `format:check` conforming, `eslint .`
    clean, `tsc --noEmit` clean, `vitest run` green.
  - `npm run privacy:check` — clean (every tracked-file contributor
    reference is anonymized).
  - `npm run nlp:security-audit` — clean.
  - `git diff --check` — clean.

- **Checks NOT performed.** Browser, narrow-window, and 200% zoom
  checks are **not** claimed as passed; they remain explicit
  acceptance items for **MR1-06/MR1-07**. No packaged or installed-app
  validation, no production-database access, no discovery runs, no push,
  no version bump, no installer rebuild, and no release claim.

## Scope boundaries

No production route/API wiring, UI integration, discovery, production-data access, migrations, dependencies, version bump, installer build, or release is included. The MR0-01 → MR1-04 onboarding foundation work has already been recorded in the local commit `877c31f` (`feat: add onboarding foundation through progress persistence`) and this correction pass adds one additional local commit on top of it; no push, no installer rebuild, and no release claim is made here.
