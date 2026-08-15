# Session Handoff

## Current Phase

Phase 8, Employer Discovery, Manual Lifecycle, and Structured Role Details v1.0.15 are complete and Architect-approved, and the 1.0.17 stale role-details invalidation / reconciliation release is complete. Version is `1.0.17`. Migration head is `028`.

## Current Implementation Checkpoint (2026-08-14 — 1.0.17 Stale Role-Details Invalidation & Reconciliation)

### What changed in this release
- **`ROLE_DETAILS_VERSION` → `role-details-v2`** (`src/schemas/role-details.ts`). The extraction contract's determinism semantics changed (negated remote/telework denial handling, provider contradiction by explicit denial, active-clearance classification, general U.S. state normalization), so persisted `role-details-v1` documents are stale by definition.
- **`SCORING_RULES_VERSION` → `2026-08-14-role-details-v2-invalidation-v1`** (`src/intelligence/scoringVersion.ts`).
- **Automatic bounded startup reconciliation**: `IntelligenceEngine.reconcileStaleData(profile, config, roleDetailsBatchSize = 200)` (`src/intelligence/intelligenceEngine.ts`) runs inside `startBackend` (`src/server/backend.ts`) at every startup. It (1) re-extracts role details for active, non-expired jobs whose stored document is missing or carries an older version, in a bounded batch; (2) invalidates the persisted score/recommendation of every active job whose role details remain stale via `IntelligenceRepository.invalidateScore`; (3) runs the existing stale-score pipeline (`reprocessIfStale` → `analyze`) to recompute from the corrected interpretation. Offline (no provider/network), idempotent, restart-safe, no manual CLI. Expired and `user_removed` jobs are excluded and never resurrected. The bounded `backfillRoleDetails` path (`src/db/backfill-role-details.ts`) also invalidates the score of each row it re-extracts.
- **Upgrade regression test**: `tests/role-details-upgrade.test.ts` proves stale detection → re-extraction to v2 → arrangement no longer remote → state/location normalized → active clearance recognized → old score invalidated and recomputed (Hard No / 0 for the default profile) → current-v2 rows skipped → `user_removed` preserved → reruns idempotent → bounded per-startup pass → no network. Uses a generic synthetic fixture (no company/provider-specific hardcoding).
- **Installed upgrade smoke (core acceptance)**: `scripts/desktop-smoke.ts --installed --upgrade` seeds an isolated temp user-data SQLite database (via `scripts/seed-upgrade-database.ts`, a separate process so the native module is not locked before the electron-ABI swap) with a synthetic 1.0.15 stale-v1 job, then launches the installed binary; `src/desktop/main.ts` runs `assertUpgradeReconciliation` to verify the app auto-corrected the interpretation and score at startup and left the `user_removed` job untouched. The real `%APPDATA%\Job Browser\data\jobs.sqlite` is never opened.

### Verified state (2026-08-14)
- Full gate green: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (93 files / 901 tests).
- Smokes passed with isolated temp user-data: development smoke, development upgrade smoke, packaged smoke, packaged upgrade smoke, installed smoke, and installed upgrade smoke.
- Installer: `release/Job-Browser-Setup-1.0.17.exe`, 249,884,580 bytes, SHA-256: `8E3E578826B48993730614B9F9E06119C1EF59B2325E7A6D8B2405831E2F924C`.

### Prior 1.0.15 content (still current, unchanged)
- Deterministic regex/rules engine (`src/intelligence/roleDetailsExtractor.ts`) extracts canonical RoleDetails without AI/LLM/NLP; precedence is structured provider data > labeled description sections > deterministic regex/rules > unknown. Persisted in `jobs.role_details_json` via migration `028_role_details.sql`.
- Provider integration fixes (USAJOBS requirements retention, Greenhouse fallback removal, SmartRecruiters `workplaceType`, Dice employment types).
- Regression hardening: clause-local remote/telework denial detection, explicit-denial-over-provider override (`remoteDenied` flag), generalized active/obtainable/eligible clearance classification, and shared U.S. state normalization via `src/utilities/us-states.ts` (28 regression tests).

## Recommended Next Sprint
- **Next Sprint**: Advanced Discovery Analytics & Alerting Rules.
