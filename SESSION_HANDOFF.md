# Session Handoff

## Recovery checkpoint — P31 FTS provisioning startup fix verified (2026-09-11)

P31 is complete, the installed app is version 1.1.1, and live startup timing is now verified against a copy of the user's real database with the launch freeze removed. Do not restart P0-P31. Next: loop back to the next bounded NLP module (recommended candidate: enable Job Intelligence explanations; audit then integrate existing NLP, do not rebuild stages 0-29).

- On a disposable copy of the real 478 MB database, `creating-api-application` took 43,863 ms on every cold start because `JobSearchRepository.provisionFts()` re-ran a full FTS5 reconcile on every construction even when the index was in sync (each membership probe scans the whole UNINDEXED `job_id` FTS5 column).
- Fix: `src/repositories/job-search-repository.ts` now short-circuits with a cheap `ftsSynchronized()` guard (3 triggers present + `EXCEPT` set equality between `jobs` and `job_search_fts`), preserving the deterministic repair path when the index is stale.
- Verified on a fresh copy of the real database: `createApp` 43,863 ms -> 45 ms; `new JobSearchRepository` 38,964 ms -> 34 ms; second in-sync construction 34 ms. No real data touched; temp copies deleted.
- Also committed minimal P30 lint repairs in `src/intelligence/nlp/compensation.ts` and refreshed the stale P24-era assertions in `tests/job-nlp-final-handoff.test.ts`; behavior unchanged.
- Full `npm run verify` passed: format + eslint + `tsc --noEmit` + 158 files / 1453 tests. Focused `tests/job-search-repository.test.ts tests/backend-lifecycle.test.ts tests/scoring-reprocessing.test.ts` = 3 files / 18 tests PASS. No installer/version bump; still 1.1.1. Nothing pushed; local checkpoint commit only.

## Recovery checkpoint — P31 desktop startup performance release complete (2026-09-11)

P31 is complete and the installed app is version 1.1.1. Do not restart P0-P31. Resume at live launch timing verification on the user's real database, then loop back to the next bounded NLP module.

- Startup fix: `src/server/backend.ts` now starts the local service before non-critical maintenance runs.
- Deferred after backend start: known-closure reconciliation, matched role-family refresh, stale intelligence reconciliation, discovery alert evaluation, scheduler startup, and the NLP background worker.
- Default deferred-maintenance delay: 10 seconds.
- Deterministic scoring, eligibility, lifecycle rules, database verification/migrations, NLP extraction output, and trust boundaries remain unchanged.
- Focused validation: Prettier check, ESLint, `tsc --noEmit`, and `vitest run tests/backend-lifecycle.test.ts tests/scoring-reprocessing.test.ts` passed 2 files / 11 tests. Final privacy/NLP security validation passed 4 files / 14 tests.
- Final installer: `release\Job-Browser-Setup-1.1.1.exe`, 253,596,928 bytes, SHA-256 `1101A3795CCB930C9966DC02198B60EFCF757221496B61728C2B9C9E8886C815`.
- Packaged and installed `app.asar`: 74,041,483 bytes, SHA-256 `CEE52B0E0F625F25B26970ECCFF8637C27CFA2E0C243484FF3E76930613BB35F`.
- Installed executable version: ProductVersion `1.1.1.0`, FileVersion `1.1.1`.
- Validation passed: packaged smoke, seeded packaged-upgrade smoke, silent install exit 0, installed smoke.

## Recovery checkpoint — P30 compensation NLP module complete (2026-09-11)

P30 is complete and the installed app includes it. Do not restart P0-P30. Resume at review or the next bounded NLP module.

- Compensation module: `src/intelligence/nlp/compensation.ts`, version `compensation-intelligence-v1`.
- Document integration: compensation facts emit normalized amount entities and optional `meta.compensation`; strength remains informational and shadow-only.
- Evaluator integration: compensation salary/bonus entities are counted in the synthetic report.
- Focused validation: `npx vitest run tests/job-nlp-compensation.test.ts tests/job-nlp-document.test.ts tests/job-nlp-evaluation.test.ts` passed 3 files / 18 tests.
- Final installer: `release\Job-Browser-Setup-1.1.0.exe`, 253,596,385 bytes, SHA-256 `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251`.
- Packaged and installed `app.asar`: 74,036,910 bytes, SHA-256 `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`.
- Final validation: packaged smoke, silent install exit 0, installed smoke, seeded upgrade smoke, privacy 11/11, NLP security 3/3, matching installed/package asar hashes, installed exe ProductVersion 1.1.0.0/FileVersion 1.1.0, no leftover process or port 6783 listener.

## Recovery checkpoint — promotion P28-P29 complete (2026-09-11)

P28-P29 are complete. The user explicitly approved rebuilding the stale 1.1.0 installer, and the rebuilt artifact has been validated. Resume next at additional NLP module planning/implementation; do not repeat P24-P29 unless source changes require a new release build. Nothing has been pushed.

- Installer: `release\Job-Browser-Setup-1.1.0.exe`, 253,596,385 bytes, SHA-256 `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251`.
- Packaged and installed `app.asar`: 74,036,910 bytes, SHA-256 `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`.
- Installed executable version: ProductVersion `1.1.0.0`, FileVersion `1.1.0`.
- Validation passed: `npm run desktop:package`, `npm run desktop:smoke:packaged`, silent install exit 0, `npm run desktop:smoke:installed`, `npm run desktop:smoke:packaged -- --upgrade`, `npm run privacy:check` (11/11), and `npm run nlp:security-audit` (3/3).
- No Job Browser/Electron/Playwright process or port 6783 listener remained after validation.
- Final promotion state: Job Intelligence, role-family suggestions, search-profile feedback, and target-role supporting evidence are EXPLANATION; exact-tie search relevance is ENRICHMENT; comparison remains SHADOW; SCORING and HARD_GATE remain unimplemented and unauthorized.

## Recovery checkpoint — promotion P24-P27 complete (2026-09-11)

P24-P27 are complete in checkpoint 45a51b0. This historical checkpoint is superseded by the P28-P29 checkpoint above. Current-source gates: verify 157/1,445, privacy 11/11, security 3/3, direct desktop smoke, rebuilt unpacked-package smoke, and packaged-upgrade smoke all pass. Real-copy desktop smoke passed through migration 034, produced 205 rows per shadow table before exit, grew the disposable database set by 13,619,200 bytes, and left zero Job Browser/Electron processes. P27 reconciled every promotion document. At that point the installer was intentionally stale pending P28; P28 later rebuilt and validated it.

# Session Handoff

## Recovery checkpoint — promotion P18-P23 complete and verified (2026-09-11)

P18-P23 implementation is complete; focused validation passed 17 files / 96 tests and full verification passed 157 files / 1,445 tests. The corpus has 66 cases and zero critical failures. Comparison persistence, off-by-default per-capability flags, deterministic fallback status, and the read-only Settings status are wired. P23 processed 500 of 3,662 real jobs in a disposable database copy: 0 failures, 2,079 event-loop ticks, and identical full jobs-table fingerprints before/after. The copy was deleted. Checkpoint b89cea1 contains the verified group. Start P24. The installer remains the stale 2026-09-10 20:07:47 build; P28 requires an explicit user release decision. No production data or remote push was touched.

## Recovery checkpoint — P13 complete

P13 is complete and verified (151 files / 1430 tests). The P12 formula exists only as an offline shadow calculator. Safety tests cover the cap, threshold guard, fail-closed inputs, monotonic qualifying evidence, unchanged baselines, and source isolation from both production scoring engines. Next: P14 tie-break explainability. No installer, production data, or remote push was touched.

## Active recovery checkpoint — P13 in progress

P12 design committed as 32d6550. P13 adds an offline-only shadow contribution calculator plus invariants for the 3-point cap, threshold guard, zero on absent/untrusted evidence, monotonic qualifying evidence, unchanged baseline objects, and source-level isolation from production scoring engines. No runtime consumer or production flag.

## Recovery checkpoint — P12 complete (design only)

P12 is documented in NLP_PROMOTION_DESIGN.md. It proposes a separate non-persisted metric with a 0–3 point cap, a next-threshold guard, eligibility-pass prerequisite, current evidence, >=0.90 confidence, dual-side agreement, and a fail-closed shadow diff gate. No runtime scoring path or flag was added. Next: P13 executable safety invariants. Latest code checkpoint: 031b3d8.

## Recovery checkpoint — P11 complete

P11 is complete and verified (150 files / 1426 tests). Job Intelligence displays diagnostic requirement coverage from the submitted immutable snapshot, including modality, source evidence, provenance, and parser version. The connected test confirms the job score remains unchanged. Next: P12 design-only bounded scoring proposal. Installer remains the stale 2026-09-10 20:07:47 build; no production data or remote push was touched.

## Active recovery checkpoint — P11 in progress

P10 committed as 36fbffc. P11 is wiring supported requirement coverage into the Job Intelligence API and UI from the application’s immutable submitted-resume snapshot. The ratio is explicitly diagnostic and has no score, eligibility, rank, filter, or lifecycle authority. No installer or production-data changes.

## Recovery checkpoint — P10 complete

P10 is complete and verified (147 files / 1422 tests). Snapshot evidence adapters now cover skills, certifications, experience, education, and clearance with parser provenance. Unparsed structural data produces UNKNOWN; normalized resume text remains internal and public snapshot responses do not expose it. Next: P11 diagnostic requirement coverage in Job Intelligence. No installer, production data, or remote push was touched.

## Active recovery checkpoint — P10 in progress

P9 committed as e21e898. P10 adds internal snapshot evidence retrieval and typed skill, certification, experience, education, and clearance adapters. Null or unparsed structured values must produce UNKNOWN, and every result remains evidence-only with parser provenance. No installer or production-data changes.

## Recovery checkpoint — P9 complete

P9 is complete and verified: reviewed canonical skills now drive relevance and skill coverage, source phrases remain unchanged, unknown terms abstain, and stale relevance indexes rebuild. Full verification passed 146 files / 1419 tests. Next: P10 resume evidence adapters for experience, education, and clearance. No installer, production data, or remote push was touched.

## Active recovery checkpoint — P9 in progress

P8 committed as e0eadf5. P9 connects reviewed canonical skills to relevance and coverage; raw text remains unchanged, unknown terms abstain. Run targeted normalized-consumer/search tests, then full verify. Continue P10 onward after P9; no checkpoint is a request to stop. No installer or production data changes.

# Session Handoff

## Recovery checkpoint — P14-P17 complete (2026-09-11)

P13 baseline is 6c0b766. P14-P17 implementation is complete; npm run verify
passed 154 files / 1436 tests. P14 explains only validated current
NLP tie-breaks and preserves deterministic score/eligibility/primary-sort authority.
P15 adds a read-only profile vocabulary projection. P16 measured 500 real local job
descriptions from a temporary database copy with 0 failures, 0 network requests, and
0 source-database writes. P17 adds relevance source hashes, strict version/hash joins,
and migration 033 change-only cache invalidation. Checkpoint ba674cb contains the verified implementation. Resume at P18
regression-corpus expansion. The installer remains
the stale 2026-09-10 20:07:47 build; no production data or remote push was touched.


## Current recovery checkpoint — P8 complete (2026-09-11)

P7 baseline is e99c80e. P8 is complete: explicit target-role selection and exact
structured-family membership; current P6 indexed skill evidence supplements title
evidence without widening the result set. Missing/stale/corrupt derived evidence
falls back safely. Production scores, eligibility, lifecycle, and default ordering
are preserved. Full verification: 145 files / 1416 tests; production build PASS.
No installer rebuilt, no version bumped, no data migration, nothing pushed.
The next implementation task is P9 in docs/Intelligence_Roadmap.md. Resolve the P8
checkpoint hash with git log. Historical shadow/beta resume instructions below
are retained as history and do not supersede this checkpoint.


Status as of the completed NLP shadow program (2026-09-10). HEAD: see `git log`.

## Where we are

Job Browser `1.1.0` is built, validated, and ready for external beta. The full
beta-readiness track in `docs/BETA_IMPLEMENTATION_TRACKER.md` is complete and
fully reconciled (every proceeding/in-progress/deferred/blocked marker is
`[x]`; OVERALL STATUS = BETA READINESS IMPLEMENTATION COMPLETE); the final
recommendation is **READY FOR EXTERNAL BETA**. Working tree is clean.
The full phase-18 report is persisted at `docs/BETA_READINESS_REPORT.md`
(31-point evidence, linked from the README).

The NLP program Stages 0-29 is complete in additive shadow mode. Final status is
**NLP SHADOW MODE VALIDATED; NLP PRODUCTION PROMOTION NOT YET VALIDATED**. See
`docs/NLP_FINAL_HANDOFF.md`, `docs/NLP_PROMOTION_DESIGN.md`, and
`docs/Intelligence_Roadmap.md`. No NLP result changes production scoring,
eligibility, ranking, filtering, lifecycle, or removal behavior.

## Final commits (local only, NONE pushed)

- `48f08ed` — docs: tracker final reconciliation (deferred rows flipped to [x]).
- `a63632d` — docs: tracker records release commit hash.
- `449aada` — release: version bump 1.0.28 → 1.1.0 + full artifact validation + docs.
- `117018e` / `bec8644` — Phase 16 completion + tracker phases 13/15.
- `97dbf23` through `705e286` — NLP Stages 23-29: coverage, audits, UX,
  promotion design, regression/upgrade validation, and final handoff.

## What is done

- All 18 tracked beta phases complete (see the tracker's Phase Progress and
  Verification Ledger). Final full gate: `npm run verify` 108 files / 1101
  tests green; `npm run privacy:check` 3 files / 11 tests green.
- Browser reliability: DEF-001 (Dice detail-page stall) fixed via bounded
  session close + run-deadline watchdog + interruptive abort.
- Performance: fixed sleeps → bounded content/card-count waits.
- UX: first-run onboarding, quick-add chips, sign-in/verification callouts,
  contextual empty/error states.
- Privacy: no-telemetry transmission policy documented; distribution scans of
  tracked files, `dist/`, and packaged asar are all green; local-only adoption
  markers (SQLite) exposed read-only in Settings.
- Docs: `docs/KNOWN_QUIRKS.md`, `docs/BETA_PLAN.md`, `docs/BETA_TESTING.md`,
  `docs/CHANGELOG.md` (1.1.0 entry), `docs/privacy.md` (Transmission section).
- NLP: Stages 0-29 complete; full verification is 136 files / 1344 tests after
  final handoff coverage; the shadow plane, audit evidence, and future
  promotion gate are documented in `docs/NLP_FINAL_HANDOFF.md`.

## Release artifact (exact)

- Path: `release\Job-Browser-Setup-1.1.0.exe`
- Size: 253,596,385 B
- SHA-256: `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251`
- Packaged `app.asar`: 74,036,910 B, SHA-256
  `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`
- Installed copy verified identical to the packaged asar; installed exe
  reports ProductVersion 1.1.0.0 and FileVersion 1.1.0.

## Validation run (1.1.0)

- `npm run verify` (format + lint + typecheck + vitest): 108/1101 green.
- `npm run privacy:check`: 11/11 green (tracked, `dist/`, packaged asar, fresh
  install, existing-data preservation).
- Packaged smoke (`desktop:smoke:packaged`): passed.
- Installed smoke (`desktop:smoke:installed` after silent upgrade install):
  passed.
- Upgrade-preservation smoke (`--packaged --upgrade` with seeded synthetic
  DB): passed.
- No orphan Job Browser / Electron / Playwright-Chromium process remains;
  backend port 6783 free after smoke runs.
- Installer contents inspected: no test/script/docs/DB artifacts inside the
  asar; only third-party `node_modules` sourcemaps ship.

## Blockers / notes for the next session

- Commits are local only; nothing pushed (user rule until the user says
  otherwise). Branch is ahead of `origin/main`.
- The installed machine copy is now 1.1.0 (upgraded over 1.0.28 as part of
  validation). Reinstalling a future build requires the app to be closed first.
- Cross-source discovery parallelization is intentionally waived for 1.1.0
  (decision D-010 in the tracker); revisit post-beta with a concurrency cap.
- If a future build changes source code: the installer is stale — rebuild and
  re-run the artifact validation sequence (see the tracker's Verification
  Ledger for the exact sequence).
- `SESSION_HANDOFF.md` is gitignored by project convention (`.gitignore` line
  21) — it is a local working note and intentionally not committed.
- Recovery if a model fails mid-task: re-read `docs/BETA_IMPLEMENTATION_TRACKER.md`
  first, audit `git status`/`git diff`, restore only bounded broken units, never
  `git reset --hard`, accept no unverified scope reductions, and resume at the
  first genuinely incomplete tracked item.

## Resume path

Re-read `docs/BETA_IMPLEMENTATION_TRACKER.md` (it is the canonical queue), then
continue from the first incomplete item there. Update the tracker's ledger with
the exact hash/results after any new work.
