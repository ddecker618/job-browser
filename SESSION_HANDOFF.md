# Session Handoff

> Current resume point. Concise on purpose. Older session narratives
> are preserved in [`docs/history/`](docs/history/) and identified
> as historical, not current instructions.

## Current verified baseline (recorded evidence — 2026-09-24)

- **HEAD:** `050651d` (`docs: record MR1-06 review boundary`) on top of
  the accepted foundation commits `877c31f` (`feat: add onboarding
  foundation through progress persistence`), `c00c224` (`fix:
  preserve onboarding resume failure states`), `0120b4f` (`docs:
  accept MR1-04 onboarding persistence`), the MR1-05 implementation
  commit `f3a1ec2` (`feat: add onboarding search plan preview`), the
  MR1-05 correction commit `2656795` (`fix: make onboarding search
  plan preview explicit and safe`), and the MR1-06 implementation
  commit `22c81e3` (`feat: add onboarding API and completion
  boundary`). MR1-04 was **accepted by the Codex reviewer on
  2026-09-24** and moved to **Done**; MR1-05 was **accepted by the
  Codex reviewer on 2026-09-24** (independent reviewer validation:
  TypeScript PASS, 5-file onboarding focused suite **164/164 PASS**)
  and moved to **Done**. MR1-06 is the next authorized task and is
  **In Review** (claimed by OpenCode 2026-09-24; implementation
  complete; a Codex review correction pass is in progress).
- **Working tree (as of 2026-09-24):** clean at the MR1-05
  implementation commit `f3a1ec2`. A Codex review correction pass is
  being applied on top of `f3a1ec2`; it will produce one additional
  local recoverable commit; no push, version bump, installer rebuild,
  or release claim is involved.
- **Local main is ahead of the locally recorded `origin/main` by 11
  commits** — `39e84c0` (P37 planning), `b453ae0` (P37 shadow
  implementation), `8281609` (1.1.5 release), `877c31f` (onboarding
  foundation), `c00c224` (resume-contract fix), `0120b4f` (MR1-04
  acceptance docs), `f3a1ec2` (MR1-05 implementation), `2656795`
  (MR1-05 correction pass), `95e0586` (MR1-05 acceptance docs),
  `22c81e3` (MR1-06 implementation), and `050651d` (MR1-06 docs
  boundary) — and **behind by 0**. The first three commits are
  absent from the locally recorded `origin/main` reference; the
  onboarding commits are local-only. Current remote-server state was
  not checked. The locally recorded `origin/main` reference is the
  1.1.4 release commit `f05bee9` (whose parent history includes the
  P36 commits `dbd0fdb` and `b4e6256`). This handoff **cannot
  independently verify** the GitHub server state — the count above
  comes from local remote-tracking references only.
- **MR0-01 work (Done per the delivery board, committed at `877c31f`):**
  accepted by the Codex reviewer on 2026-09-18. Documentation-only
  changes — modified (tracked): `README.md`, `SESSION_HANDOFF.md`,
  `docs/PROJECT_MEMORY.md`; added: `docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md`,
  `docs/delivery/tasks/MR0-01-release-baseline.md`; updated planning
  docs: `docs/JOB_BROWSER_DELIVERY_BOARD.md`,
  `docs/JOB_BROWSER_TASK_TEMPLATE.md`,
  `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`. See the Active Task section
  below.
- **MR1-01 work (Done per the delivery board, committed at `877c31f`):**
  accepted by the Codex reviewer on 2026-09-18 after three review
  passes. Contract types in `src/models/onboarding.ts`, pure validation
  in `src/schemas/onboarding.ts`, fictional fixtures in
  `src/client/fixtures/onboarding.fixture.ts`, contract tests in
  `tests/onboarding-contract.test.ts`, the decision record
  `docs/delivery/decisions/MR1-01-onboarding-contract.md`, the task card
  `docs/delivery/tasks/MR1-01-onboarding-contract.md`, and review/status
  updates to `docs/DUSTIN_FIRST_CODING_TASK.md`,
  `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`, this handoff, and the
  delivery board. See the Active Task section below.
- **MR1-02 work (Done per the delivery board, committed at `877c31f`):**
  accepted by the Codex reviewer on 2026-09-19 after the review
  corrections round. `src/client/components/onboarding/PreferencesStep.tsx`,
  `src/client/styles/onboarding.css`,
  `tests/onboarding-preferences.test.tsx`,
  `docs/delivery/tasks/MR1-02-preferences-step.md`, plus status updates
  to this handoff and the delivery board. See the Active Task section
  below.
- **MR1-03 work (Done per the delivery board, committed at `877c31f`):**
  transferred from OpenCode to GitHub Copilot on 2026-09-20 and
  accepted by the Codex reviewer on 2026-09-20.
  `src/client/components/onboarding/ReviewStep.tsx`,
  `tests/onboarding-review.test.tsx`,
  `docs/delivery/tasks/MR1-03-review-step.md`, plus shared-file updates
  (`src/client/styles/onboarding.css`,
  `src/client/fixtures/onboarding.fixture.ts`) and status updates to
  this handoff and the delivery board. Release status remains **Not
  shipped**. See the Active Task section below.
- **MR1-04 work (Done per the delivery board; foundation at `877c31f`,
  resume-contract fix at `c00c224`, accepted by Codex reviewer
  2026-09-24):** transferred from OpenCode to GitHub Copilot on
  2026-09-20; implementation complete and accepted by Codex.
  `src/repositories/onboarding-repository.ts`,
  `src/onboarding/onboarding-service.ts`,
  `tests/onboarding-progress-storage.test.ts`, updates to
  `src/schemas/onboarding.ts` (v1/v2 snapshot schemas) and
  `src/models/onboarding.ts` (`OnboardingProgressSnapshot` discriminated
  union), the MR1-04 task card, status updates to this handoff and the
  delivery board, narrow `.gitignore` entries, doc-hygiene and
  correction-pass edits, and a discriminated `OnboardingResumeResult`
  / `OnboardingResumeQuestion` contract so malformed / unsupported /
  storage-failure states cannot be presented as a fresh first-run
  onboarding session. **Done** as of 2026-09-24; claimed files
  released; release status remains **Not shipped**; MR1-05 is the next
  authorized task; MR1-06 still not started.
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
- **Onboarding code is not present in the 1.1.5 installer.** The
  onboarding foundation lives only in commit `877c31f` (and any later
  local correction commits), and the release status remains **Not
  shipped** until a separately validated release gate re-bundles the
  app.
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
  accepted by the Codex reviewer; docs-only completion; committed at
  `877c31f`. Status / owner / claimed files live on the delivery
  board:
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
  row). Committed at `877c31f`. Validated locally (typecheck clean;
  contract tests 65/65; related preference/profile/scoring tests 24/24;
  eslint + prettier clean). Decision record:
  [`docs/delivery/decisions/MR1-01-onboarding-contract.md`](docs/delivery/decisions/MR1-01-onboarding-contract.md);
  task card:
  [`docs/delivery/tasks/MR1-01-onboarding-contract.md`](docs/delivery/tasks/MR1-01-onboarding-contract.md).
  No UI, storage, routes, APIs, or migrations were added. Release
  status remains **Not shipped**.
- **MR1-02 — Build preference form and focused interaction tests**
  (OpenCode, claimed 2026-09-19). **Done** as of 2026-09-19 —
  **accepted by the Codex reviewer** (passed code + interaction
  review). Committed at `877c31f`. The guided `PreferencesStep` walks
  the five enabled questions one at a time (progress "Question N of 5")
  using the frozen MR1-01 contract unchanged (no salary question until
  L1); scoped `onboarding.css`; a test-only controlled parent over
  fictional fixtures covers 22 interaction scenarios (22/22 PASS;
  101/101 combined with the `onboarding-contract.test.ts` and existing
  UI suites; typecheck/eslint/prettier clean). A review-corrections
  round (2026-09-19) applied exact employment-type semantics (truthful
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
- **MR1-03 (Build review/confirmation screen and tests)** was
  **accepted by Codex on 2026-09-20** and moved to **Done** on the
  board; it implements the already-frozen
  `OnboardingReviewStepProps`/`OnboardingReviewItem` contracts and is
  **not connected** to routes, saving, or resume parsing (later tasks
  MR1-04/MR1-06 own that). Committed at `877c31f`. The outstanding
  browser, narrow-window and 200% zoom checks remain explicit
  acceptance items for **MR1-06/MR1-07** and are **not** marked as
  passed. Release status remains **Not shipped**.

- **MR1-04 — Persist and restore onboarding progress through existing
  profile services** was transferred from OpenCode to GitHub Copilot on
  2026-09-20 and is **Done** as of 2026-09-24 (foundation at `877c31f`;
  resume-contract correction at `c00c224`; **accepted by the Codex
  reviewer on 2026-09-24** with independent validation: TypeScript
  PASS, 4-file onboarding focused suite 122/122 PASS, discriminated
  resume contract preserves valid / missing / malformed /
  unsupported-version / storage-failure states correctly). Claimed files
  released. Task card:
  [`docs/delivery/tasks/MR1-04-progress-storage.md`](docs/delivery/tasks/MR1-04-progress-storage.md).
  Browser, narrow-window and 200% zoom checks remain explicit
  acceptance items for **MR1-06/MR1-07** and are **not** marked as
  passed. Release status remains **Not shipped**; MR1-06 still not
  started.
- **MR1-06 — Connect the onboarding wizard to saved preferences and
   real discovery** is the next authorized task (claimed by OpenCode
   2026-09-24 after Codex accepted MR1-05; implementation complete
   and moved to **Review**; a Codex review correction pass is in
   progress on top of `050651d`). The slice wires the accepted
   `PreferencesStep`, `ReviewStep`, and `SearchPlanStep` components
   into one working flow that prepares and starts a real Job Browser
   search through the existing `DiscoveryCoordinator`. A narrow
   versioned API is mounted at `/api/onboarding` (`GET /status`,
   `POST /preview`, `POST /draft-from-profile`, `POST /save`,
   `POST /reset`, `POST /edit/start`, `POST /edit/end`,
   `POST /complete`, `POST /discovery/retry`); strict request
   validation through `onboardingProgressSnapshotSchema`,
   `onboardingValidatedPreferencesSchema`, and the newly exported
   `onboardingReviewItemSchema`; safe client errors without raw
   diagnostics; plan preview is always rebuilt from the current
   draft via `POST /api/onboarding/preview` and returns a SHA-256
   `planToken`; completion compares the `planToken` and rejects stale
   plans with 409 + refreshed plan; credentials are resolved through
   `credentialResolver.status` instead of being fabricated;
   profile-derived `OnboardingPreferencesDraft` via
   `POST /api/onboarding/draft-from-profile`; completion-marker
   persistence in `app_settings.onboardingCompletion:<profileId>`.
   Confirmation ordering: validate → rebuild+compare token →
   confirmationAllowed → persist → cascade → completion marker →
   clear progress → edit session → invoke `coordinator.runAll()`
   once. Persistence failure never runs discovery, keeps draft and
   review state, and surfaces a retryable error. Cascade failure
   never writes the completion marker and returns a retryable
   `onboarding_complete_cascade_failed`. Discovery failure keeps
   completion and progress clearing, persists a bounded translated
   `discoveryError`, and supports search-only retry through
   `/api/onboarding/discovery/retry`. Completion is idempotent via a
   client-generated `attemptId` stored as
   `onboardingAttempt:<profileId>:<attemptId>` with the stored
   outcome that a repeated request returns without rewriting,
   cascading, or re-running discovery. A durable discovery outcome
   is persisted as
   `app_settings.onboardingDiscoveryOutcome:<profileId>` with state
   `not-started` \| `running` \| `succeeded` \| `failed` \| `unavailable`
   and is returned through `/api/onboarding/status` so the
   CompletedView renders truthful wording after reload. Concurrent
   discovery retry is blocked with 409 `onboarding_retry_already_running`.
   The new `src/client/pages/OnboardingPage.tsx` parent wizard wires
   the accepted child components with a `/onboarding` route in
   `App.tsx`; visible `Start onboarding`/`Review search setup` entry
   points are exposed through `FirstRunPanel`, `SearchProfilePage`,
   and a `Search Setup` nav entry; no forced redirect; distinct
   blocked screens for malformed/unsupported-version/storage-failure
   with Retry+Leave for storage-failure (no destructive reset);
   transitions persist the destination snapshot before advancing;
   `Cancel and leave` saves valid progress via `endOnboardingEdit(true)`
   and never calls the destructive reset endpoint; existing completion
   markers are preserved when a later editing session ends with
   `keepProgress:false`. Validated: typecheck clean;
   `tests/onboarding-api.test.ts` 20/20 PASS;
   `tests/onboarding-flow.test.tsx` 13/13 PASS; combined onboarding
   focused suite **197/197 PASS** across 7 files (was 164 before
   MR1-06; **+33** new tests); `npm run verify` **1802/1802 PASS**
   across 179 files (was 1769/1769 across 177 before MR1-06; **+33**
   tests, same file count); `npm run privacy:check` 11/11 PASS;
   `npm run nlp:security-audit` 3/3 PASS; `git diff --check` clean.
   Browser, narrow-window and 200% zoom checks remain explicit
   acceptance items for **MR1-07** and were **not** performed or
   claimed here. Release status remains **Not shipped**; MR1-07 still
   not started.
- **MR1-05 — Preview bounded search/source plan** was authorized by
  the user on 2026-09-24 (after Codex accepted MR1-04) and is now
  **Done**. The slice is preview-only and never executes discovery: a
  pure deterministic `buildOnboardingSearchPlan` service builds a
  versioned `OnboardingSearchPlan` (`ONBOARDING_SEARCH_PLAN_VERSION = 1`)
  from `OnboardingValidatedPreferences`, the user-confirmed desired job
  titles, `SearchProfile.maxQueriesPerRun`, the existing
  `ConfiguredSource[]`, and the existing `ProviderDescriptor[]`; the
  plan never touches SQLite, the filesystem, providers, credentials,
  or the network. Each source is classified as
  `'ready' \| 'needs-attention' \| 'excluded'` with bounded
  user-facing reasons (no credentials, no `careersUrl` secrets, no
  stack traces); unknown provider references cannot be ready;
  archived, disabled, missing-provider, unvalidated, and
  invalid-configuration sources are excluded; credential-required
  sources are needs-attention; failed-health sources are
  needs-attention with a safe generic reason (`The last source check
  failed. Review this source before searching.`), never the raw
  `healthMessage`. The query list is trimmed, case-insensitively
  deduped (first spelling wins), preserved in user order, and bounded
  by `SearchProfile.maxQueriesPerRun`; overflow titles are recorded in
  `omittedTitles` with a bounded warning. `confirmationAllowed` is
  `false` when there are no usable queries or no ready sources. The
  parent-controlled `SearchPlanStep` component renders
  `appliedQueries` as the executable query list and `omittedTitles` as
  a separate list, location/remote/distance constraints, bounded
  counts, source groups with reasons, no-search-yet status, and
  accessible Back + Confirm buttons; Confirm is disabled when saving
  or not confirmable; duplicate confirmation is blocked; a
  confirmation error is shown as `role="alert"` without erasing the
  plan. The UI copy is plan-specific and does not describe profile
  qualification review. Validated: typecheck clean;
  `tests/onboarding-search-plan.test.tsx` 42/42 PASS (was 35; +7
  covering the correction pass); combined onboarding suite 164/164
  PASS (was 157); `npm run verify` 1769/1769 PASS across 177 files
  (was 1762/1762 across 176); `npm run privacy:check` 11/11 PASS;
  `npm run nlp:security-audit` 3/3 PASS; `git diff --check` clean.
  Accepted by the Codex reviewer 2026-09-24 with independent
  TypeScript validation and the 164/164 onboarding focused suite.
  Task card:
  [`docs/delivery/tasks/MR1-05-search-plan.md`](docs/delivery/tasks/MR1-05-search-plan.md).
  Browser, narrow-window and 200% zoom checks remain explicit
  acceptance items for **MR1-06/MR1-07** and are **not** marked as
  passed. Release status remains **Not shipped**; MR1-06 is now the
  next authorized task.

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

1. **MR1-06 is in Review for Codex** (claimed by OpenCode 2026-09-24
   after Codex accepted MR1-05; implementation complete; a Codex
   review correction pass is being applied on top of `050651d`).
   The pass makes the plan preview authoritative (rebuilt from the
   current draft via `POST /api/onboarding/preview` with a SHA-256
   `planToken` matched by completion), resolves credentials through
   `credentialResolver.status`, derives the initial draft from the
   candidate profile via `POST /api/onboarding/draft-from-profile`,
   persists the destination snapshot before every transition, makes
   `Cancel and leave` save progress without destructive reset, makes
   cascade failure non-completion, makes completion idempotent via
   `attemptId`, persists a durable discovery outcome so CompletedView
   can render truthful succeeded/failed/unavailable/running wording,
   exposes visible first-run/dashboard entry points (`FirstRunPanel`,
   `SearchProfilePage`, and a `Search Setup` nav entry), and shows
   distinct blocked screens for malformed/unsupported-version/
   storage-failure with Retry+Leave for storage-failure. Do not start
   MR1-07 yet; MR1-07 remains not started. Release status remains
   **Not shipped**. Browser, narrow-window and 200% zoom checks
   remain explicit acceptance items for MR1-07 and were **not**
   performed or claimed here.
2. **Local commits (no push).** The accepted MR0-01 → MR1-05 onboarding
   work is recorded at local commits `877c31f`, `c00c224`, `0120b4f`,
   `f3a1ec2`, and `2656795`. MR1-06 is recorded at local commits
   `22c81e3` (`feat: add onboarding API and completion boundary`) and
   `050651d` (`docs: record MR1-06 review boundary`). The correction
   pass will produce one further local recoverable commit on top of
   `050651d`. No push is performed; the 1.1.5 release status on the
   board stays **Not shipped**.

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
