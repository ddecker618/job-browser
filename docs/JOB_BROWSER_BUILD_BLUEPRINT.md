# Job Browser: a practical plan for building together

**Prepared:** September 18, 2026  
**Based on:** this repository, version 1.1.5 / commit `8281609` inspected in this conversation. Recheck Git state before implementation.  
**Status:** Proposed collaboration design and file blueprint. The new source files below have not been added to the application.

## The recommended approach

Build one small, working user journey at a time. Agree on the information a screen receives and the actions it can request, then build its appearance separately from its database/network connections.

**Roles (decision D11 in the MR1-01 record):** **OpenCode handles
scheduled implementation** of board tasks; **Codex reviews**;
**an optional contributor may optionally claim a small, clearly bounded contribution**
(such as a single sub-component or a focused test slice) and his
companion learning guide is **optional** — planned implementation never
depends on it. This lets everyone contribute real production components,
and contributors first agree on a small screen contract before wiring
the backend.

For example, the preference form is implemented by OpenCode against the
frozen props contract; an optional contributor can optionally take a bounded slice of
it. The integration/code owner connects callbacks to the existing
profile service, and code is reviewed together with the reviewer. This
avoids two people editing the same large files at once (one owner per
file at a time) and avoids throwing away a standalone mockup later.

Use the existing React, TypeScript, Vitest and CSS setup. Do not introduce a new UI framework, task-management app or architecture rewrite just to organize this work.

## 1. Where progress lives

Use one editable task board for **current task status**. Keep long-term strategy in the market-readiness plan. Keep the existing project memory and handoff as short entry points linking to the current board, not additional independently maintained copies of its statuses.

Recommended project locations:

```text
job-browser/
├── SESSION_HANDOFF.md                    EXISTING: current resume point + board link
├── docs/
│   ├── PROJECT_MEMORY.md                 EXISTING: durable decisions + board link
│   ├── Intelligence_Roadmap.md            EXISTING: intelligence scope/authority
│   ├── BETA_IMPLEMENTATION_TRACKER.md     EXISTING: historical release evidence
│   └── delivery/                         NEW: market-release execution documents
│       ├── BOARD.md                      ONE authority for task status and owner
│       ├── WORKING_AGREEMENT.md           file ownership and completion rules
│       ├── FILE_MAP.md                    this blueprint's source-file map
│       ├── decisions/                    only decisions that affect implementation
│       │   └── MR-1-onboarding-contract.md
│       └── tasks/
│           ├── _TEMPLATE.md
│           ├── MR0-01-release-baseline.md
│           ├── MR1-01-onboarding-contract.md
│           ├── MR1-02-preferences-step.md
│           ├── MR1-03-review-step.md
│           ├── MR1-04-progress-storage.md
│           ├── MR1-05-search-plan.md
│           ├── MR1-06-wizard-integration.md
│           └── MR1-07-acceptance.md
└── ...existing application...
```

The companion files delivered here are starter documents, not installed project infrastructure. Place them under `docs/delivery/` when adopting this workflow. Do not create all future feature directories or empty placeholder files now; create a source file when its task starts.

> **Adoption note (2026-09-18).** The proposed tree above is **not** yet installed. As of MR0-01 the four companion files (`BOARD.md`, `WORKING_AGREEMENT.md`, `FILE_MAP.md`, `_TEMPLATE.md` and the four task cards in `tasks/`) live at the repository root under `docs/` with explicit filenames:
>
> - Board: [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](JOB_BROWSER_DELIVERY_BOARD.md)
> - Blueprint: [`docs/JOB_BROWSER_BUILD_BLUEPRINT.md`](JOB_BROWSER_BUILD_BLUEPRINT.md) (this document)
> - Task template: [`docs/JOB_BROWSER_TASK_TEMPLATE.md`](JOB_BROWSER_TASK_TEMPLATE.md)
> - an optional contributor's optional learning guide: [`docs/DUSTIN_FIRST_CODING_TASK.md`](DUSTIN_FIRST_CODING_TASK.md)
> - MR0-01 task card: [`docs/delivery/tasks/MR0-01-release-baseline.md`](delivery/tasks/MR0-01-release-baseline.md)
>
> Renaming or relocating these into the proposed `docs/delivery/` tree is out of scope for MR0-01 (docs only, no file moves) and is recorded as an unresolved question for whoever owns the workflow-adoption follow-up task.

### Board layout

```text
JOB BROWSER DELIVERY                        Latest inspected release: 1.1.5
Current milestone: candidate-first onboarding

BACKLOG        READY          IN PROGRESS     REVIEW          DONE
Later work     Defined task   Owner + files   Code + evidence Accepted code
Dependencies   Can start now  Next action    Awaiting review Release tag separate

Task detail:
MR1-02  Build preference form
Owner: OpenCode (implement)   Reviewer: Codex
an optional contributor: optional bounded slice (coordinate files first)
Depends on: MR1-01
Files: PreferencesStep.tsx, onboarding.css, onboarding-preferences.test.tsx
Done means: accessible form, working validation, callbacks, tests reviewed
Release: not shipped
```

Use these states precisely:

| State       | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| Backlog     | Proposed work; not sufficiently defined or dependencies incomplete.           |
| Ready       | Outcome, contract, files, dependencies and acceptance checks are clear.       |
| In progress | A named contributor is actively working on it. Record the next action.        |
| Blocked     | Work cannot proceed; record reason, responsible person and unblocking action. |
| Review      | Implementation exists and evidence is attached; reviewer must verify it.      |
| Done        | Acceptance checks passed and the reviewer accepted the integrated change.     |

Keep a separate **release** column: `not shipped`, `release candidate`, or an actual verified version. Code merged into a branch is not automatically in the installed app. Do not use invented percentages such as “90% done.” Counts of tasks are a workload view, not a reliable estimate of engineering effort.

## 2. Split the work by clear boundaries

### Optional good first contributions for an optional contributor

an optional contributor is **not restricted** to these areas, and nothing below is
assigned or required — they are optional slices to take when a board
task allows. Start here because a mistake is easier to isolate and the
results are visible. Increase scope as confidence grows. Before taking
one, check the board for what the implementation owner (OpenCode) has
already claimed or started and coordinate overlapping files first.

| Work                            | Why it fits                                            | Support available                                                    |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Preference form                 | Visible, useful and bounded; no direct database access | Typed props, sample input, callback contract and validation examples |
| Review-and-confirm screen       | Mostly presentation and correction controls            | Fixtures covering normal, missing and conflicting information        |
| Empty, loading and error states | Small changes with clear behavior                      | Existing `States.tsx`, UI tests and product copy                     |
| Accessibility and layout fixes  | Immediate feedback using keyboard/zoom                 | Explicit review checklist and existing CSS conventions               |
| Tests for user interactions     | Teaches the product while preventing regressions       | Existing React Testing Library/Vitest examples                       |
| Help text and onboarding copy   | You know what ordinary users will find confusing       | File-specific scope and a word/behavior guide                        |

an optional contributor is not restricted to these areas. Start here because a mistake is easier to isolate and the results are visible. Increase scope as confidence grows.

### Work to keep with the implementation owner initially

Database migrations, snapshots, backups, profile persistence, discovery scheduling, security boundaries, native dependencies and packaging. These affect existing user data or several components at once. They still get explained and reviewed; they are not a separate mystery system.

One person owns integration files during a feature: `src/client/App.tsx`, `src/client/api.ts`, `src/server/app.ts`, shared schemas, migrations, `package.json` and release configuration. Contributors request changes through the task card instead of editing these files simultaneously.

## 3. Build the first feature in slices

Start with **candidate-first onboarding**, using the existing profile, resume and discovery services.

```text
1. EXPERIENCE          2. PREFERENCES       3. REVIEW          4. FIND JOBS
Upload or enter        Work/location       Confirm facts     Preview sources
Resume parse status    Salary/roles        Fix unknowns      Run approved plan
Manual fallback        Schedule limits     Save profile      View shortlist
```

Each screen must have loading, empty, error and success behavior. Back navigation preserves the draft. A failed source run must not erase a confirmed profile. The UI must never call SQLite or provider modules directly.

### First two useful implementation slices

**Slice A:** Preferences form → save through existing profile service → reload retains values. This is a small end-to-end feature that can be reviewed before the whole wizard exists.

**Slice B:** Resume import → review suggested facts → confirm selected changes → reload preserves the confirmed profile. Reuse existing resume extraction and proposals; do not build another parser.

After those work, add search-plan preview and discovery progress. Do not spend several weeks polishing every wizard screen before testing persistence and the real workflow.

## 4. Exact source-file blueprint

Paths are relative to the repository root. **Existing** means verified in the inspected repository. **New** means proposed. Final names become stable when the contract task is accepted.

```text
src/
├── models/
│   └── onboarding.ts                     NEW: public request/result/step types
├── schemas/
│   ├── candidate-profile.ts              EXISTING: reuse for saved profile validation
│   └── onboarding.ts                     NEW: draft/plan API input validation
├── onboarding/
│   ├── onboardingService.ts              NEW: coordinate steps, no UI logic
│   ├── onboardingRepository.ts           NEW: wizard progress, not a second profile
│   └── searchPlanService.ts              NEW: preview bounded existing-source choices
├── preferences/                          EXISTING: actual profile persistence authority
├── resumes/
│   └── resumeService.ts                  EXISTING: parsing + proposed profile additions
├── discovery/
│   ├── discoveryCoordinator.ts           EXISTING: all discovery execution enters here
│   └── employerDiscoveryService.ts       EXISTING: reuse employer/career-site discovery
├── server/
│   ├── app.ts                            EXISTING: integration owner mounts routes
│   └── routes/
│       └── onboarding.ts                 NEW: validated request -> service -> response
├── client/
│   ├── App.tsx                           EXISTING: integration owner adds /onboarding
│   ├── api.ts                            EXISTING: integration owner adds typed calls
│   ├── pages/
│   │   └── OnboardingPage.tsx             NEW: route, data fetching, wizard coordination
│   ├── components/
│   │   ├── FirstRunPanel.tsx              EXISTING: link to wizard
│   │   ├── States.tsx                    EXISTING: reuse common states
│   │   └── onboarding/
│   │       ├── OnboardingStepper.tsx     NEW: current/completed step navigation
│   │       ├── ExperienceStep.tsx        NEW: import/manual-entry presentation
│   │       ├── PreferencesStep.tsx       NEW: MR1-02 (OpenCode implement; an optional contributor optional slice)
│   │       ├── ReviewStep.tsx            NEW: MR1-03 (OpenCode implement; an optional contributor optional slice)
│   │       └── SearchPlanStep.tsx        NEW: sources, constraints and run confirmation
│   ├── fixtures/
│   │   └── onboarding.fixture.ts         NEW: fictional preview/test data only
│   └── styles/
│       └── onboarding.css               NEW: feature-scoped styles; imported by page
└── db/
    └── migrations/
        └── <next>_onboarding_progress.sql CONDITIONAL: only if app_settings is insufficient

tests/
├── onboarding-preferences.test.tsx       NEW: validation, callback and keyboard behavior
├── onboarding-review.test.tsx            NEW: confirm/correct/unknown states
├── onboarding-service.test.ts            NEW: restart/resume/version-conflict behavior
├── onboarding-api.test.ts                NEW: validation + consistent failure responses
└── onboarding-flow.test.tsx              NEW: connected UI success/failure/back navigation

scripts/
└── desktop-smoke.ts                      EXISTING: extend fixture-owned smoke only if needed
```

Do not add a migration just to satisfy the diagram. First examine the existing `app_settings` storage conventions. Wizard draft/progress belongs there if it can be stored safely with a version. Confirmed career facts remain in the existing profile/resume systems. Allocate the next migration number from current Git state, not this document.

### Responsibilities by file

| File/group                | Allowed responsibility                                        | Must not do                                            |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `PreferencesStep.tsx`     | Show/edit draft, display errors, emit callbacks               | Fetch providers, write files or choose profile storage |
| `ReviewStep.tsx`          | Show facts, evidence and uncertainty; emit edits/confirmation | Treat a suggestion as a confirmed credential           |
| `OnboardingPage.tsx`      | Fetch/save, transition screens, expose progress/errors        | Reimplement scoring or direct database queries         |
| `onboardingService.ts`    | Validate transitions, coordinate existing profile services    | Run a second discovery scheduler                       |
| `searchPlanService.ts`    | Build a versioned bounded preview from permitted sources      | Promise internet-wide coverage or execute on preview   |
| `onboardingRepository.ts` | Save wizard draft/progress with schema version                | Become another authoritative candidate profile         |
| Route module              | Validate inputs, call services, return typed errors           | Contain provider extraction or matching logic          |

## 5. Agree on a small contract before coding

The first contract should reuse existing names and types wherever possible. Below is the **illustrative** component contract kept here for historical context; it is **superseded by the frozen contract published in MR1-01**. The authoritative types now live in `src/models/onboarding.ts`, the pure validation/conversion helpers in `src/schemas/onboarding.ts`, the fictional fixtures in `src/client/fixtures/onboarding.fixture.ts`, the contract tests in `tests/onboarding-contract.test.ts`, and the decision record in `docs/delivery/decisions/MR1-01-onboarding-contract.md`. Differences that matter: drafts keep the numeric inputs as strings with a strict decimal syntax (blank = not provided, never `0`); `remotePreference` starts `null` with explicit `answers` (`unanswered`/`answered`/`skipped`) metadata instead of a silent default; the step props carry **`currentQuestion`** plus the navigation callbacks (`onChange` updates without advancing, `onContinue` validates the current question then advances, `onBack` goes backward preserving answers, and the final enabled question requests final validation + saving); questions follow a fixed **enabled** order (`ONBOARDING_ENABLED_QUESTION_SEQUENCE`) that **omits the deferred salary question** (L1) — the full sequence still supports salary for future enablement; `convertPreferencesDraft` guards the full contract while default validation ignores the deferred salary; `mergePreferencesIntoProfile` never overwrites an existing field with a null, so a deferred salary question cannot clear saved salary data; a saved null salary restores as `'unanswered'` unless a snapshot recorded a deliberate skip (L4); both step prop contracts extend `OnboardingSaveState` (`saving`/`saveError`); and `OnboardingProgressSnapshot` (version 1: step + current question + the full draft) is the format MR1-04 will persist — no storage exists yet.

```ts
type PreferencesDraft = Pick<
  CandidateProfile,
  | 'desiredJobTitles'
  | 'preferredLocations'
  | 'searchRadiusMiles'
  | 'secondarySearchRadiusMiles'
  | 'remotePreference'
  | 'desiredSalary'
  | 'desiredEmploymentTypes'
>;

type PreferencesStepProps = {
  value: PreferencesDraft;
  errors: Partial<Record<keyof PreferencesDraft, string>>;
  saving: boolean;
  onChange: (next: PreferencesDraft) => void;
  onBack: () => void;
  onContinue: () => void;
};
```

The parent owns the draft and save request; the component does not keep a competing authoritative copy. A callback prop is the agreed connection point. Both the UI and backend use the existing meaning of remote preferences, salaries and locations. Do not invent incompatible enums in the mockup.

The companion preference card maps to MR1-02 and the fictional
examples are already provided by the contract fixtures (enabled-flow
complete, first-time user, resumed session, save failure). Preview
components through tests initially; if a visual preview route is
useful, the implementation owner can add a development-only route
excluded from production. Do not introduce Storybook unless repeated
component-preview work justifies it.

## 6. Your first screen wireframe

```text
Find work that fits you
Experience  ✓   Preferences  2   Review  3   Find jobs  4

What roles interest you?
[ IT Support Specialist                     ] [+ Add role]

Where would you like to work?
[ Highland          ] [ Illinois            ]
Preferred distance  [ 25 ] miles
Wider search limit  [ 50 ] miles

Remote work
(●) Prefer remote  ( ) Remote is OK  ( ) Prefer in person

Employment types
[✓] Full-time   [ ] Part-time   [ ] Contract   [ ] Internship

Salary preference (optional)
Minimum annual pay [           ]  Target [           ]
Currency           [ USD       ]

Your choices will be used to prepare a search plan.
No search runs until you review that plan.

[ Back ]                                  [ Save and continue ]
                          Save error appears here; draft stays intact.
```

These labels are provisional. Explain how salary is interpreted before connecting it to existing salary filtering. Preserve other profile preferences that this starter screen does not edit. The full settings page remains available for advanced constraints.

## 7. How we avoid overwriting each other's work

- Start a task by claiming its board row and listing the files being edited. One owner per file at a time, including CSS and shared types.
- For simultaneous local development, use separate Git worktrees/branches, such as `mr1/preferences-ui` and `mr1/progress-storage`, created from the agreed contract baseline. A worktree is a separate working folder, not just another editor window.
- Each worktree uses its own disposable database, resume directory, browser profile and development port. Do not launch competing desktop builds against the real installed app data.
- If worktrees are inconvenient initially, take turns on the same checkout. This is more reliable than simultaneous edits without isolation.
- Keep dependencies stable. A new package, shared-type change or migration is an integration decision recorded before others build against it.
- Codex reviews implementation; the implementation owner combines small changes, runs the joined workflow, and updates the board. Do not make two independent status boards in different worktrees authoritative; consolidate board edits during integration.
- Use short checkpoints: changed files, passing checks, remaining issue, next action. No need to rewrite every roadmap after a small button change.

Suggested session rhythm: choose one Ready task → agree on files → code a small increment → demonstrate it → review/tests → update board → next task. Prefer tasks small enough to complete in one or two focused sessions; split tasks that repeatedly span several sessions.

## 8. What counts as done

A source file existing is not completion. For a task to reach Done:

1. The promised user behavior works with real service integration where applicable.
2. Empty, invalid, interrupted and retry states behave as specified.
3. Meaningful tests pass, and the reviewer has checked the change.
4. No unexpected profile/data mutation or change to scoring/privacy boundaries occurred.
5. Evidence and the integrated commit/reference are recorded on the board.
6. Release status remains `not shipped` until the packaged/installed artifact is verified.

For simple copy/style changes, a focused visual/keyboard review can be sufficient; do not write tests that merely assert the text you just typed. For state/persistence behavior, test the failure mode, not only the happy path. Run full verification at integration/release boundaries, rather than rebuilding the installer after every small UI edit.

## 9. Map the later features without scaffolding them prematurely

| Market-plan package     | Future source area                                                   | What to preserve/reuse                                                |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| MR-2 career evidence    | `src/careerEvidence/` (proposed), existing NLP modules               | Existing resume snapshots, requirement coverage and trust controls    |
| MR-3 source reliability | Existing `src/providers/`, `src/discovery/`, lifecycle repositories  | One coordinator/scheduler; source provenance and partial-run handling |
| MR-4 packets            | `src/applicationPreparation/` and packet UI (proposed)               | Existing resume library, immutable snapshots and application ledger   |
| MR-5 workflow           | Existing Jobs/Applications pages; follow-up service if needed        | Existing event-derived status, corrections and analytics              |
| MR-6 releases           | Existing `src/desktop/`, packaging scripts and release configuration | Local data isolation, privacy gates, native dependency restoration    |
| MR-7 pilot              | Existing local adoption markers + consented exports                  | No silent telemetry or resume uploads                                 |

Estimate and break down each package when it reaches the front of the queue. A detailed file plan for every future feature now would become stale and constrain better implementation choices.

## Recommended starting assignment

**First agree on MR1-01, then OpenCode implements MR1-02: the
preference form** (an optional contributor may optionally take a bounded slice). The
implementation owner handles progress storage and the existing profile
connection. Review a working save/reload slice together before moving
on to search-plan generation.

The attached board shows all new implementation tasks as unstarted. Completed version 1.1.5 capabilities are listed separately so existing work is recognized without falsely marking new release work done.
