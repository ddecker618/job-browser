# Session Handoff

> Current resume point. Concise on purpose. Older session narratives
> are preserved in [`docs/history/`](docs/history/) and identified
> as historical, not current instructions.

## Current verified baseline (recorded evidence — 2026-09-14)

- **HEAD:** `8281609` (`release: 1.1.5 ship P37 shadow job-type taxonomy`).
- **Working tree (as of this handoff, 2026-09-18):** NOT clean.
  MR0-01 made documentation-only changes that were accepted by the
  Codex reviewer on 2026-09-18 but are still left uncommitted for
  the user to review and commit:
  - modified (tracked): `README.md`, `SESSION_HANDOFF.md`,
    `docs/PROJECT_MEMORY.md`;
  - added (untracked): `docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md`,
    `docs/delivery/tasks/MR0-01-release-baseline.md`;
  - updated (untracked planning docs):
    `docs/JOB_BROWSER_DELIVERY_BOARD.md`,
    `docs/JOB_BROWSER_TASK_TEMPLATE.md`,
    `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`.
  All of the above are documentation-only changes from the accepted
  MR0-01 task.
- **MR1-01 work (Done per the delivery board, still uncommitted):**
  accepted by the Codex reviewer on 2026-09-18; claimed files released.
  New onboarding contract files added (untracked):
  `src/models/onboarding.ts`, `src/schemas/onboarding.ts`,
  `src/client/fixtures/onboarding.fixture.ts`,
  `tests/onboarding-contract.test.ts`,
  `docs/delivery/decisions/MR1-01-onboarding-contract.md`,
  `docs/delivery/tasks/MR1-01-onboarding-contract.md`, plus review/status
  updates to `docs/DUSTIN_FIRST_CODING_TASK.md`,
  `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`, this handoff, and the delivery
  board. See the Active Task section below.
- **MR1-02 work (Done per the delivery board, still uncommitted):**
  accepted by the Codex reviewer on 2026-09-19; claimed files released.
  New files added (untracked):
  `src/client/components/onboarding/PreferencesStep.tsx`,
  `src/client/styles/onboarding.css`,
  `tests/onboarding-preferences.test.tsx`,
  `docs/delivery/tasks/MR1-02-preferences-step.md`, plus status updates
  to this handoff and the delivery board. See the Active Task section
  below.
- **MR1-03 work (Done on the delivery board, still
  uncommitted):** transferred from OpenCode to GitHub Copilot on
  2026-09-20 and accepted by the Codex reviewer on 2026-09-20.
  Implemented files are present in the worktree and released back to the
  unclaimed bucket:
  `src/client/components/onboarding/ReviewStep.tsx`,
  `tests/onboarding-review.test.tsx`,
  `docs/delivery/tasks/MR1-03-review-step.md`, plus shared-file updates
  to this task's scope (`src/client/styles/onboarding.css`,
  `src/client/fixtures/onboarding.fixture.ts`) and status updates to
  this handoff and the delivery board. Release status remains **Not
  shipped**. See the Active Task section below.
- **MR1-04 work (In Review on the delivery board, still uncommitted,
  review-corrections pass applied 2026-09-20):** transferred from
  OpenCode to GitHub Copilot on 2026-09-20; implementation complete and
  awaiting Codex acceptance. New files present in the worktree:
  `src/repositories/onboarding-repository.ts`,
  `src/onboarding/onboarding-service.ts`,
  `tests/onboarding-progress-storage.test.ts`, updates to
  `src/schemas/onboarding.ts` (v1/v2 snapshot schemas) and
  `src/models/onboarding.ts` (`OnboardingProgressSnapshot` discriminated
  union), the MR1-04 task card, status updates to this handoff and the
  delivery board, plus narrow `.gitignore` entries and
  doc-hygiene/correction-pass edits across the delivery documents.
  Release status remains **Not shipped**; MR1-05 and MR1-06 still not
  started. See the Active Task section below.
- **Recoverable local checkpoint commit (planned, 2026-09-20, no
  push):** once the MR1-04 correction-pass gates are green, the
  accepted MR0-01, MR1-01, MR1-02, MR1-03 and corrected MR1-04 work
  are staged together as one local commit
  `feat: add onboarding foundation through progress persistence` so the
  onboarding foundation has a recoverable checkpoint in the local
  branch history. The release status remains **Not shipped**. No push
  is performed.
- **Source version:** `1.1.5` in `package.json` and `package-lock.json`
  (root + workspace entry; third-party dependency versions untouched).
- **Locally built / validated installer:** `release\Job-Browser-Setup-1.1.5.exe`
  (253,617,071 bytes, SHA-256
  `14A41C4D53BA930A8574123E383E6FAF9613DD678A59AC36E0FDEEE697131D3A`).
- **Installed version (recorded as part of the 1.1.5 boundary
  validation):** ProductVersion `1.1.5.0` / FileVersion `1.1.5`
  (silent upgrade from the 1.1.4 install, exit 0).
- **Packaged + installed `app.asar`:** identical (74,147,400 bytes,
  SHA-256
  `8205D3D69655D48E3C7E061B2FD9C1D9690FECF19BF862CFB4BA10C001F79A75`).
- **P37 + P36 runtime markers confirmed in the packaged asar** during
  the 1.1.5 boundary validation:
  `job-type-taxonomy-v1`, `job-type-normalization-v1`,
  `JOB_TYPE_TAXONOMY_VERSION`, `JOB_TYPE_NORMALIZATION_VERSION`,
  `deterministic-fallback`, and catalog keys
  `software-engineering`, `devops-platform`, `cybersecurity` (P37,
  `Level 0` shadow); `resume-snapshot-evidence-v2`,
  `coverageContext`, `captureState`, `parsingError`,
  `job-intelligence-abstention-note` (P36).
- **Published / pushed state (rechecked locally for MR0-01):** the
  local branch `main` is **ahead of** the local remote-tracking ref
  `origin/main` by **3 commits** — `39e84c0` (P37 planning),
  `b453ae0` (P37 shadow implementation), `8281609` (1.1.5 release) —
  and **behind by 0**. These commits are absent from the locally
  recorded `origin/main` reference. Current remote-server state was
  not checked. The locally recorded `origin/main` reference is the
  1.1.4 release commit `f05bee9` (whose parent history includes the
  P36 commits `dbd0fdb` and `b4e6256`). This handoff **cannot
  independently verify** the GitHub server state — the count above
  comes from local remote-tracking references only.
- **1.1.5 release-boundary validation — HISTORICAL EVIDENCE
  (recorded 2026-09-14, not re-executed by MR0-01):**
  `npm run verify` 172 files / 1,605 tests PASS,
  `npm run privacy:check` 11/11, `npm run nlp:security-audit` 3/3,
  format / lint / typecheck green. Four smokes passed:
  packaged, packaged seeded-upgrade, installed, installed
  seeded-upgrade. Production DB SHA-256
  `2E4BC539FFACBD88473FF2CB36FCAAAD9E968AAF7AAA88568ED0DE225E197B07`
  / size 493,121,536 bytes recorded unchanged across that
  validation. No orphan Job Browser/Electron processes, port 6783
  free. These results describe the 1.1.5 boundary only; they were
  **not** reproduced during MR0-01. In particular, MR0-01 did not
  re-hash the database, so the historical hash does not prove the
  DB stayed unchanged during this documentation task — MR0-01's DB
  claim is only that it never opened, modified, or queried the
  production database (documentation-only scope).

## Active task

- **MR0-01 — Reconcile release baseline and current documentation**
  (OpenCode, claimed 2026-09-18). **Done** as of 2026-09-18 —
  accepted by the Codex reviewer; docs-only completion; no
  commits/push yet (the user reviews and commits). Status / owner /
  claimed files live on the delivery board:
  [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](docs/JOB_BROWSER_DELIVERY_BOARD.md).
- Task card: [`docs/delivery/tasks/MR0-01-release-baseline.md`](docs/delivery/tasks/MR0-01-release-baseline.md).
- **MR1-01 — Freeze first onboarding contract, fixtures and
  ownership** (OpenCode, claimed 2026-09-18). **Done** as of 2026-09-18
  — **accepted by the Codex reviewer**; three review passes applied:
  answer states + guided sequence + strict parsing + snapshot; then the
  question-navigation contract (`currentQuestion` + callbacks), salary
  deferral (L1) with null-safe merge, restore intent (L4), and
  contributor roles (D11: OpenCode implements, Codex reviews, and an
  optional bounded contribution is allowed but does not gate any board
  row). Claimed files released on acceptance. Validated locally
  (typecheck clean; contract tests 65/65; related
  preference/profile/scoring tests 24/24; eslint + prettier clean).
  Decision record:
  [`docs/delivery/decisions/MR1-01-onboarding-contract.md`](docs/delivery/decisions/MR1-01-onboarding-contract.md);
  task card:
  [`docs/delivery/tasks/MR1-01-onboarding-contract.md`](docs/delivery/tasks/MR1-01-onboarding-contract.md).
  No UI, storage, routes, APIs, or migrations were added. Release
  status remains **Not shipped**.
- **MR1-02 — Build preference form and focused interaction tests**
  (OpenCode, claimed 2026-09-19). **Done** as of 2026-09-19 —
  **accepted by the Codex reviewer** (passed code + interaction
  review); claimed files released back to the unclaimed bucket. The
  guided `PreferencesStep` walks the five enabled questions one at a
  time (progress "Question N of 5") using the frozen MR1-01 contract
  unchanged (no salary question until L1); scoped `onboarding.css`;
  a test-only controlled parent over fictional fixtures covers 22
  interaction scenarios (22/22 PASS; 101/101 combined with the
  `onboarding-contract.test.ts` and existing UI suites;
  typecheck/eslint/prettier clean). A review-corrections round
  (2026-09-19) applied exact employment-type semantics (truthful
  `'unknown'` label stored literally, no implied "any arrangement",
  occupation-neutral full-time guidance), editable blank rows when
  roles/locations are empty, all controls disabled during a pending
  save, first-invalid focus for parents that defer errors until
  Continue, and copy without implementation detail. Task card:
  [`docs/delivery/tasks/MR1-02-preferences-step.md`](docs/delivery/tasks/MR1-02-preferences-step.md).
  The component is **not connected** to any route, first-start flow,
  or real saving (later tasks MR1-04/MR1-06 own that). The outstanding
  visual, narrow-window and 200% zoom checks were **not** performed by
  this task and are preserved as explicit acceptance items for
  **MR1-06** and **MR1-07** — they are **not** described as passed.
  Release status remains **Not shipped**.
- The next task is chosen from the board. `Ready` rows in the board
  (per the board's own definitions) can be picked up; picking up a
  `Backlog` row requires the user to advance it first. **MR1-03 (Build
  review/confirmation screen and tests)** was **accepted by Codex on
  2026-09-20** and moved to **Done** on the board; it implements the
  already-frozen `OnboardingReviewStepProps`/`OnboardingReviewItem`
  contracts and is **not connected** to routes, saving, or resume
  parsing (later tasks MR1-04/MR1-06 own that). The outstanding
  browser, narrow-window and 200% zoom checks remain explicit
  acceptance items for **MR1-06/MR1-07** and are **not** marked as
  passed. Release status remains **Not shipped**.

- **MR1-04 — Persist and restore onboarding progress through existing
  profile services** was transferred from OpenCode to GitHub Copilot on
  2026-09-20 and is **In Review** for Codex (correction pass applied
  2026-09-20; **task remains in Review — not self-approved as Done**).
  The canonical repository and service use the existing SQLite
  `app_settings` and unified profile-preferences authorities:
  profile-scoped snapshots, v1/v2 compatibility, review restoration,
  invalid-version reset, disabled-salary recovery, profile application,
  failure ordering and retry idempotence are covered by the new
  persistence tests, including a real-adapter end-to-end test, v1
  readability, independent read/write/reset failure tests, retry
  idempotence with the explicit `profileId: string` now carried by
  `CompleteOnboardingOptions`, and a conservative profile-application
  test (suggestions/unknown ignored, confirmed blanks ignored, existing
  fields preserved). Generated `vitest-report.json` and
  `vitest-review.json` artifacts were removed and narrowly ignored;
  stale absolute repository paths in the blueprint and the optional
  contributor guide now point to the repository root and acknowledge
  the OneDrive move. Validated: `npm run verify` **1721/1721 PASS**
  across 176 files; `npm run privacy:check` **11/11 PASS** (the D11
  contributor role is preserved while the personal name is no longer
  present in tracked files); `npm run nlp:security-audit` **3/3 PASS**;
  `git diff --check` clean (CRLF-only notices). Task card:
  [`docs/delivery/tasks/MR1-04-progress-storage.md`](docs/delivery/tasks/MR1-04-progress-storage.md).
  Browser, narrow-window and 200% zoom checks remain explicit
  acceptance items for **MR1-06/MR1-07** and are **not** marked as
  passed. Release status remains **Not shipped**; no commits, no push;
  MR1-05 and MR1-06 were not started.

## Important constraints (active)

- **Notifications must remain disabled.**
  `src/client/components/NotificationManager.tsx` must return
  `null`. `src/desktop/main.ts` must continue to deny the
  `notifications` permission checks/requests before the
  BrowserWindow is created. Re-enabling either path is a
  user-visible behaviour change requiring explicit approval.
- **NLP authority boundary (unchanged).** SHADOW (`Level 0`),
  EXPLANATION (`Level 1`), ENRICHMENT (`Level 2`) only. SCORING
  (`Level 3`) and HARD_GATE (`Level 4`) are not authorized in
  this program. Deterministic scoring, eligibility, ranking,
  filtering, lifecycle, status, archive, and removal paths remain
  authoritative. See `docs/NLP_TRUST_LEVELS.md` and
  `docs/NLP_PROMOTION_DESIGN.md`.
- **Production DB is real data.** No task that touches
  `%APPDATA%\Job Browser\data\jobs.sqlite` may run without a
  verified backup on file. The MR0-01 task explicitly did not
  touch production data; if a future task needs to do so, it must
  include the backup in its acceptance criteria.
- **No push without explicit user approval.** Local commits only;
  push is a separate authorization.
- **Notifications / NLP authority restrictions must survive every
  release boundary** (the 1.1.5 boundary evidence is the most
  recent demonstration).

## Remaining manual checks and blockers

These cannot be exercised from a normal local shell; they need a
real packaged Windows session:

- **Windows shutdown / logoff / restart delivery of
  `query-session-end`** on the main BrowserWindow. The controller's
  bounded `onWindowsSessionEnd()` cleanup runs, then `app.exit()`
  is issued. Verify on a packaged build whether Windows actually
  delivers the event before terminating.
- **Tray icon visibility, right-click menu rendering, focus
  behaviour** — fixture tests verify IPC and backend
  coordination; OS-level rendering must be observed on a packaged
  build.
- **5-second shutdown budget** vs real Windows logoff latency —
  requires a real logoff timing on a packaged build.

No code changes required to investigate any of the above.
Investigations are out of scope for MR0-01 (which is docs-only).

## Next action

1. **MR1-03 is Done.** The review/confirmation screen and interaction
   tests were accepted by the Codex reviewer on 2026-09-20 and moved to
   **Done** on the delivery board. The claimed files were released. The
   release status remains **Not shipped** until a separately validated
   release gate. Browser, narrow-window and 200% zoom checks remain
   explicit requirements for **MR1-06/MR1-07** and are not marked as
   passed.
2. **MR1-04 is in Review after the 2026-09-20 correction pass — Codex
   must review before it can move to Done.** Do not start MR1-05 or
   MR1-06 yet; MR1-05 and MR1-06 remain not started. Release status
   remains **Not shipped**. Browser, narrow-window and 200% zoom checks
   remain explicit acceptance items for MR1-06/MR1-07 and were **not**
   performed or claimed here.
3. **Recoverable local checkpoint commit (no push).** The accepted
   MR0-01, MR1-01, MR1-02, MR1-03 and the corrected MR1-04 work are
   staged together in a single local commit
   `feat: add onboarding foundation through progress persistence` so
   the onboarding foundation has a recoverable checkpoint in the local
   branch history. No push is performed; the 1.1.5 release status on
   the board stays **Not shipped**.

## Links to historical evidence

- Past handoff narratives (2026-09-13 / 2026-09-14):
  [`docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md`](docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md)
- Past NLP / intelligence scope:
  `docs/Intelligence_Roadmap.md`,
  `docs/NLP_TRUST_LEVELS.md`,
  `docs/NLP_PROMOTION_DESIGN.md`,
  `docs/NLP_FINAL_HANDOFF.md`,
  `docs/NLP_INTELLIGENCE_UX_PROTOTYPE.md`.
- Past product scope:
  `docs/IMPLEMENTATION_ROADMAP.md`,
  `docs/BETA_READINESS_REPORT.md`,
  `docs/OCCUPATION_EXPANSION_PROPOSAL.md`.
- Past release evidence (P33 / P34 / P35 / 1.1.3 / 1.1.4 /
  1.1.5):
  `docs/CHANGELOG.md`,
  `docs/BETA_IMPLEMENTATION_TRACKER.md`,
  `docs/PROJECT_MEMORY.md`.
- Market-readiness collaboration design (proposed, not yet
  installed): `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`.
- The original market-readiness plan file
  `docs/JOB_BROWSER_MARKET_READINESS_PLAN.md` is **absent** from
  this repository as of MR0-01. Its contents were not invented;
  the related MR-2 through MR-7 packages appear only as a
  roadmap list in §9 of the blueprint. If the plan file later
  appears, treat it as a separate authoritative source for
  market-readiness scope.

---

## Do not start additional work from this section

It records the latest release boundary state, the active task,
constraints, manual checks, and links to historical evidence only.
It is intentionally short.
