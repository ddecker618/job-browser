# MR0-01 — Reconcile release baseline and current documentation

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md); do not duplicate state here.
**Parent package:** MR-0 release-baseline cleanup
**Dependencies:** none
**Expected size:** one focused session (this task)

## Outcome

A future contributor can land on this repository and identify the
current release state, the active task, and the constraints that
must survive any future change — without wading through session
narratives that describe a different release boundary.

## Starting point

- **Baseline commit:** `8281609` (`release: 1.1.5 ship P37 shadow job-type taxonomy`; absent from the locally recorded `origin/main` reference — current remote-server state was not checked).
- **Existing modules to reuse:** none — this task touched only
  documentation and tracker artifacts. No `src/` files were
  created, removed, or modified.
- **Sample data and expected behavior:** not applicable; this task is
  documentation-only.

## Files owned by this task

| File                                                                  | Existing/new                          | Intended change                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_HANDOFF.md`                                                  | existing                              | Restructured into a concise current handoff with a link to the historical archive.                                                                                                           |
| `docs/PROJECT_MEMORY.md`                                              | existing                              | Reconciled stale `1.1.4` reference; added a board link in the current-status block.                                                                                                          |
| `README.md`                                                           | existing                              | Replaced the "1.1.2 / through P35" release-status line with the 1.1.5 / P37 status, and labeled the 1.1.2 installer line as historical evidence.                                             |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`                                  | existing (untracked at start of task) | Recorded MR0-01 ownership/claim with OpenCode; added 2026-09-18 session-log rows. Board row status (presently **Done**) is owned by the board itself, not this card.                         |
| `docs/JOB_BROWSER_TASK_TEMPLATE.md`                                   | existing (untracked at start of task) | Fixed the board reference from the proposed `docs/delivery/BOARD.md` to the actual location.                                                                                                 |
| `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`                                 | existing (untracked at start of task) | Added an adoption note explaining that the four companion files currently live at `docs/` (not `docs/delivery/`); explicitly distinguished the proposed tree from the actual file locations. |
| `docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md` | new                                   | Archive of the superseded SESSION_HANDOFF narrative sections from the 2026-09-13 → 2026-09-14 release cycle, marked historical and excluded from the `docs/delivery/` proposal.              |
| `docs/delivery/tasks/MR0-01-release-baseline.md`                      | new                                   | This task card.                                                                                                                                                                              |

## Shared files — integration owner only

None. This task did not touch any application source, configuration,
schema, migration, or CSS file.

## Contract

This task is **documentation-only**. No code or contract was added or
changed. The persistent trackers now agree on:

- **Source version:** `1.1.5` (`package.json` + `package-lock.json`
  root + workspace entry; third-party dependency versions untouched).
- **Latest locally validated installer:**
  `release\Job-Browser-Setup-1.1.5.exe`
  (253,617,071 bytes,
  SHA-256 `14A41C4D53BA930A8574123E383E6FAF9613DD678A59AC36E0FDEEE697131D3A`).
- **Packaged + installed `app.asar`:** identical (74,147,400 bytes,
  SHA-256 `8205D3D69655D48E3C7E061B2FD9C1D9690FECF19BF862CFB4BA10C001F79A75`).
- **Installed version (recorded during the 1.1.5 boundary
  validation):** ProductVersion `1.1.5.0` / FileVersion `1.1.5`
  (silent upgrade from the 1.1.4 install, exit 0).
- **Active task queue:**
  [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md)
  is the single authority.

## In scope / out of scope

- In scope: documentation reconciliation, handoff restructure +
  archive, board claim + adoption note, README release-status
  reconciliation, PROJECT_MEMORY.md stale `1.1.4` reference, board
  reference fix in the task template, archived handoff creation,
  task card creation, local validation (link resolution,
  prettier check on changed docs only).
- Out of scope: any application source change; any package /
  lockfile / database change; launching the app, running
  discovery, rebuilding/installing the desktop app, or touching
  production data; commits; pushes; publishing; re-enabling
  notifications; promoting NLP; implementation of MR1-01 or
  any other board row; moving the four planning companion files
  into the proposed `docs/delivery/` tree.

## Acceptance checks

- [x] Happy-path behavior: a future contributor can read
      `SESSION_HANDOFF.md` and identify (a) current HEAD, (b)
      current package version, (c) latest locally validated
      installer + size + SHA-256, (d) installed version, (e)
      active task pointer, (f) constraints, (g) outstanding manual
      checks, (h) where to find historical evidence.
- [x] Invalid/empty input: not applicable — no user input flows.
- [x] Failure/retry behavior: not applicable — no runtime behavior.
- [x] Accessibility/keyboard behavior: not applicable — no UI.
- [x] Existing data/preferences preserved: yes — the production
      database was not opened, modified, or queried during this
      task (guaranteed by scope, not by re-checking it). The
      recorded production DB hash / size is historical evidence
      from the 1.1.5 boundary validation and was **not** re-
      verified during MR0-01; it does **not** prove the database
      was unchanged during this task.

## Review evidence

- **Changed files:** the eight listed under "Files owned by this
  task" — three tracked (`README.md`, `SESSION_HANDOFF.md`,
  `docs/PROJECT_MEMORY.md`) and five untracked
  (`docs/JOB_BROWSER_DELIVERY_BOARD.md`,
  `docs/JOB_BROWSER_TASK_TEMPLATE.md`,
  `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`, the new archive under
  `docs/history/`, and this task card). No other tracked or
  untracked file was modified — in particular
  `docs/DUSTIN_FIRST_CODING_TASK.md` is untouched, and the
  board-reference correction (task template) and adoption-note
  addition (blueprint) are the only edits to those two docs.
- **Focused tests run and exact result:** none executed. This
  task is documentation-only. The most recently recorded gates
  (during the 1.1.5 boundary validation) were: `npm run verify`
  172 files / 1,605 tests PASS; `npm run privacy:check` 11/11;
  `npm run nlp:security-audit` 3/3; format / lint / typecheck
  green; four smokes (packaged, packaged seeded-upgrade,
  installed, installed seeded-upgrade) all PASS. These were
  recorded before MR0-01 started and were **not** re-executed
  during MR0-01.
- **Checks run during MR0-01 (all green at completion):**
  - `git diff --check` on the whole working tree: clean (exit 0).
  - Prettier `--check` passed on every changed document:
    `SESSION_HANDOFF.md`, `README.md`, `docs/PROJECT_MEMORY.md`,
    `docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md`,
    `docs/delivery/tasks/MR0-01-release-baseline.md`,
    `docs/JOB_BROWSER_DELIVERY_BOARD.md`,
    `docs/JOB_BROWSER_TASK_TEMPLATE.md`,
    `docs/JOB_BROWSER_BUILD_BLUEPRINT.md`. (`--write` was applied
    to those docs first to make them conform.)
  - Link resolution: every Markdown link in the changed documents
    resolves to an existing path when interpreted relative to the
    source file's directory.
  - Manual review: diff scope is exactly the eight files listed
    under "Files owned by this task"; `docs/DUSTIN_FIRST_CODING_TASK.md`
    is untouched; the historical archive preserves the superseded
    SESSION_HANDOFF narrative sections and identifies them as
    historical; active constraints and outstanding manual Windows
    acceptance items remain easy to find in the current handoff.
- **Checks NOT run during MR0-01 (and why):**
  - No `npm` gate (`verify`, `privacy:check`, `nlp:security-audit`,
    format, lint, typecheck, smokes, lifecycle harness) was
    executed. The gate result recorded in the handoff is
    **historical evidence from the 1.1.5 release-boundary
    validation (2026-09-14)**, not a fresh execution.
  - No release artifact was rebuilt or repackaged. The recorded
    installer/asar hashes are historical; they were not re-computed
    during MR0-01.
  - No production data was touched and the recorded production DB
    hash was **not** re-verified; see the acceptance item above.
- **Integrated commit/reference:** none — the task boundary
  forbids commits and pushes. The user will commit and push
  after review.
- **Reviewer and acceptance date:** Codex reviewer, 2026-09-18
  (accepted out of Review). Status is tracked on the delivery
  board; as of 2026-09-18 the row is **Done** and the claimed
  files have been released.

## Handoff

- **What works:** the current SESSION_HANDOFF.md points at the
  current release (1.1.5 / `8281609`), the delivery board, the
  task card, and the historical archive. PROJECT_MEMORY.md and
  README.md describe the same current release. MR0-01 was
  accepted by the Codex reviewer on 2026-09-18 and the board lists
  it as **Done**; the claimed files below are released.
- **What remains:**
  - **Unresolved questions** (no code change recommended):
    1. `docs/IMPLEMENTATION_ROADMAP.md` and
       `docs/NLP_FINAL_HANDOFF.md` still contain `1.1.4`-era
       current-state language (e.g., "Reconciled against source
       checkpoint `f05bee9` (1.1.4 / P36)"). The user's task
       scope explicitly named `PROJECT_MEMORY.md` and `README.md`;
       these two were left untouched to avoid scope creep. A
       future doc-only task (e.g., MR0-02) could reconcile them.
    2. The proposed `docs/delivery/` directory tree (board,
       working agreement, file map, decisions, task templates
       and cards) is **not** installed. The four companion files
       live at `docs/` with explicit filenames. Renaming /
       relocating them is a separate workflow-adoption task;
       MR0-01 intentionally did not move files.
    3. Publication status of the local `main` branch: `main` is
       ahead of the locally recorded `origin/main` reference by
       three commits — `39e84c0` (P37 planning), `b453ae0` (P37
       shadow implementation), `8281609` (1.1.5 release). These
       commits are absent from the locally recorded `origin/main`
       reference. Current remote-server state was not checked. The
       P36 commits `dbd0fdb` / `b4e6256` and the 1.1.4 release
       commit `f05bee9` are present in the locally recorded
       `origin/main` reference. The user has not yet authorized
       push of these commits.
    4. `docs/JOB_BROWSER_MARKET_READINESS_PLAN.md` is **absent**.
       The user's task explicitly told us to record the absence
       without inventing content or blocking the task. MR-2
       through MR-7 packages appear only as the roadmap list in
       §9 of the blueprint.
    5. The 2026-09-13/2026-09-14 SESSION_HANDOFF narrative
       sections (lifecycle-continuation, Package A recovery,
       Package B+C continuation, the pre-Package-B/C status
       block, release evidence, requested follow-up) are
       preserved (marked historical) in
       `docs/history/SESSION_HANDOFF-HISTORICAL-2026-09-13-to-2026-09-14.md`.
       If any of those narratives should be split further, or
       if earlier 1.1.x era archives should be added
       (e.g., 1.1.0 / 1.1.2 release notes), that is a future
       docs-only task.

- **File ownership to release:** released. All eight files listed in
  the "Files owned by this task" table were returned to the
  unclaimed bucket when MR0-01 was accepted (2026-09-18).
- **Next concrete action:** the user reviews the diff and
  decides whether to commit (locally only) and whether to push
  (with explicit approval). MR0-01 is **Done** on the board; the
  next task is chosen from the board, and per the board's own
  `Next choice` note that is MR1-01 (`Freeze first onboarding
contract, fixtures and ownership`).

## What this task did **not** do

- Did not run any `npm` gate (verify, privacy, security,
  format, lint, typecheck, smoke, lifecycle harness, package).
- Did not commit, push, install, build, or publish.
- Did not touch production data, the installer, the asar,
  the package manifest, the lockfile, or any application source.
- Did not re-enable notifications, change the NLP authority
  boundary, or start any other board row.
- Did not move the four untracked planning companion files into
  the proposed `docs/delivery/` tree.

## Release status reminder

This task does not ship an application release. Release status
remains tracked on the delivery board, not on this card.
