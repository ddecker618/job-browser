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

## Review-corrections pass (2026-09-20)

The following Codex review findings were applied in this correction pass; the task remains in **Review** awaiting Codex acceptance.

1. **Documentation hygiene.** The replacement character in the heading was replaced with a normal em dash; two stale absolute repository references (`docs/DUSTIN_FIRST_CODING_TASK.md`, `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`) now refer to the repository root and acknowledge the OneDrive move. No replacement characters remain in the new onboarding source, tests, or delivery documents.
2. **Generated test-output artifacts.** `vitest-report.json` and `vitest-review.json` (older `--reporter=json` outputs) were removed from the working tree. Narrow `.gitignore` entries were added for those two filenames only — no broad JSON ignore rule.
3. **Real database adapter.** A new disposable-SQLite test (`tests/onboarding-progress-storage.test.ts`) exercises **save, load, and reset** end-to-end through `createDatabaseOnboardingProgressStore` itself, going beyond the prior test that only wrote through `DashboardRepository` and read one raw setting through the adapter.
4. **Version compatibility.** A new test stores a valid version-1 snapshot and asserts: it loads with `kind: 'valid'`, the stored preferences and `currentQuestion` are preserved, `reviewItemsFromProgress` returns an empty list for v1, and the underlying row is not silently rewritten as version 2 by merely loading it.
5. **Storage-write failure behavior.** Independent tests cover read failure (no `saveSetting` reached), write failure after a successful read (followed by a load that still reports `missing`, never success), and reset failure (the progress remains present and reportable after the failed reset).
6. **Failure ordering and retry idempotence.** A new test runs the full sequence: existing progress present → unified profile write succeeds → clearing progress fails → the completion call surfaces the reset failure and progress remains recoverable → retrying completion does **not** duplicate confirmed skills or certifications → a later successful reset clears the exact original `onboardingProgress:<profileId>` key and nothing else. To make the storage key unambiguous, `CompleteOnboardingOptions` now carries an explicit `profileId: string`; every affected test and caller was updated consistently.
7. **Malformed and unsupported progress.** A new test demonstrates that malformed and unsupported-version progress is distinguishable from missing progress, **cannot** be silently overwritten (save throws), requires an explicit reset, and remains recoverable/reportable until the reset succeeds. `resumeOnboardingProgress` returns the full `OnboardingProgressLoadResult` to the integration layer so callers can detect and report storage failure, malformed data, and unsupported versions instead of treating them as an ordinary first-run state.
8. **Conservative profile application.** A new test confirms: suggestions and unknown items are not applied; confirmed blank values are not applied; existing skills, certifications, salary, and unrelated profile fields survive; repeated confirmation is idempotent; an unsuccessful profile write never clears progress; and the onboarding service does not write directly through SQLite as a second authoritative candidate-profile store.

### Validation evidence (correction pass)

- **Focused tests (exact result).**
  - `npx vitest run tests/onboarding-progress-storage.test.ts` — **13/13 PASS**
    (6 prior tests + 7 new correction-pass tests: real-adapter save/load/reset; v1
    snapshot readability; independent read/write/reset failures; malformed /
    unsupported-version recovery; reset-failure retry idempotence with
    `profileId`-scoped key; conservative profile application).
  - `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/onboarding-review.test.tsx tests/onboarding-progress-storage.test.ts` — **116/116 PASS** (65 contract + 22 preferences + 15 review + 13 progress storage; 101/101 prior to the corrections round + 15 new review + 7 new progress storage − 8 replaced, net +7 progress storage and +15 review).

- **Full gates (exact result).**
  - `npm run verify` — clean. `format:check` conforming, `eslint .` clean,
    `tsc --noEmit` clean, `vitest run` **1721/1721 PASS** across **176 files**.
  - `npm run privacy:check` — **11/11 PASS** (the previous failure on the
    personal contributor name was fixed by anonymizing every tracked-file
    reference to a generic optional-contributor phrase; the D11
    contributor role meaning is preserved).
  - `npm run nlp:security-audit` — **3/3 PASS**.
  - `git diff --check` — clean (CRLF-only notices on
    `SESSION_HANDOFF.md` / `.gitignore` are Windows/OneDrive artifacts).

- **Checks NOT performed.** Browser, narrow-window, and 200% zoom checks
  are **not** claimed as passed; they remain explicit acceptance items for
  **MR1-06/MR1-07**. No packaged or installed-app validation, no
  production-database access, no discovery runs, no push, no version bump,
  no installer rebuild, and no release claim.

## Scope boundaries

No production route/API wiring, UI integration, discovery, production-data access, migrations, dependencies, version bump, commit or push is included.
