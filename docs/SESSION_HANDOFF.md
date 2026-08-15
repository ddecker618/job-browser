# Session Handoff

## Current Phase

Phase 8, Employer Discovery, Manual Lifecycle, and Structured Role Details v1.0.15 are complete and Architect-approved, the 1.0.17 stale role-details invalidation / reconciliation release is complete, and the 1.0.18 geographic-eligibility release is complete. Version is `1.0.18`. Migration head is `028`.

## Current Implementation Checkpoint (2026-08-15 — 1.0.18 Geographic Eligibility)

### What changed in this release
- **New `src/intelligence/geographicEligibility.ts`** replaces the commute gate's dependence on the exact-city heuristic. Worksites are parsed from structured `city`/`state` AND the free-text `location` field (multi-worksite splitting on `;`, `/`, "and"/"or", plus `City, ST` runs), closing the provider location-string-only bypass.
- **Location knowledge is deterministic** with the existing local atlas (no runtime network geocoder): `known_local` (exact distance ≤ radius), `known_distant`, `known_state_eligible` (same-state, no atlas distance), `known_state_ineligible` (out-of-state), and `unknown`. No distance is fabricated.
- **Hard gate** (`evaluateGeographicGate` in `scoringEngine.applyVerification`): a non-remote role hard-blocks (`location_outside_radius`) only when every known worksite is definitively outside the commute boundary. Same-state, unknown-location, and mixed worksite sets never hard-block.
- **Remote region restrictions**: `verificationService.verifyPosting` now returns optional `remoteRegion { restricted, states[], evidence[] }` detected by deterministic regex (full state names and `MD, VA` list runs; nationwide allowances excluded). When a restricted region has no intersection with the candidate's preferred states, the new `remote_region_ineligible` hard rejection fires. `remote_region_ineligible` added to `ELIGIBILITY_REJECTION_REASONS` (`src/domain/verification.ts`) and labelled in `JobDetailPanel.tsx`.
- **Recommendation cap**: `recommend(..., cap)` in `scoringEngine.ts` — `Verified Match` is capped at `Strong Match` whenever location eligibility is unconfirmed (`recommendationCapFor`: remote and confirmed `known_local` → `none`; otherwise `strong`).
- **Scoring semantics**: location score reflects eligibility (`known_local` 100, `known_state_eligible` 60, unknown 30, blocked 0); unknown work arrangement scores 50 for remote preference (was near-perfect 75/40).
- **`SCORING_RULES_VERSION` → `2026-08-15-geographic-eligibility-v1`**; `remoteRegion` added to `createScoreInputHash`, so persisted geographic scores invalidate and recompute at startup via the existing stale-score pipeline.
- **New regression coverage** `tests/geographic-eligibility.test.ts` (50 tests): worksite parsing, knowledge classification, hard-gate matrix, recommendation caps, end-to-end scoring, remote region restrictions, persisted-score invalidation, and a current-ranking integration test (`IntelligenceEngine.analyze` + `JobSearchRepository.search`, the exact Jobs-screen query path) proving geographically impossible jobs never appear in the eligible ranking and unknown-location jobs never rank above viable ones.

### Verified state (2026-08-15)
- Full gate green: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (94 files / 951 tests).
- Smokes passed with isolated temp user-data: development smoke, development upgrade smoke, packaged smoke, packaged upgrade smoke, installed smoke, and installed upgrade smoke (upgrade smoke proves the seeded geographically-invalid high score auto-corrects to `Hard No` / 0).
- Installer: `release/Job-Browser-Setup-1.0.18.exe`, 249,893,167 bytes, SHA-256: `BDD1F4932A1C9C7E4AA6616D922DC68F9981E178B648A1DA6EEB0CECAC1A059D`.

### Prior 1.0.17 content (still current, unchanged)
- **`ROLE_DETAILS_VERSION` → `role-details-v2`** (`src/schemas/role-details.ts`). The extraction contract's determinism semantics changed (negated remote/telework denial handling, provider contradiction by explicit denial, active-clearance classification, general U.S. state normalization), so persisted `role-details-v1` documents are stale by definition.
- **Automatic bounded startup reconciliation**: `IntelligenceEngine.reconcileStaleData(profile, config, roleDetailsBatchSize = 200)` (`src/intelligence/intelligenceEngine.ts`) runs inside `startBackend` (`src/server/backend.ts`) at every startup. It (1) re-extracts role details for active, non-expired jobs whose stored document is missing or carries an older version, in a bounded batch; (2) invalidates the persisted score/recommendation of every active job whose role details remain stale via `IntelligenceRepository.invalidateScore`; (3) runs the existing stale-score pipeline (`reprocessIfStale` → `analyze`) to recompute from the corrected interpretation. Offline (no provider/network), idempotent, restart-safe, no manual CLI. Expired and `user_removed` jobs are excluded and never resurrected. The bounded `backfillRoleDetails` path (`src/db/backfill-role-details.ts`) also invalidates the score of each row it re-extracts.
- **Upgrade regression test**: `tests/role-details-upgrade.test.ts` proves stale detection → re-extraction to v2 → arrangement no longer remote → state/location normalized → active clearance recognized → old score invalidated and recomputed (Hard No / 0 for the default profile) → current-v2 rows skipped → `user_removed` preserved → reruns idempotent → bounded per-startup pass → no network. Uses a generic synthetic fixture (no company/provider-specific hardcoding).
- **Installed upgrade smoke (core acceptance)**: `scripts/desktop-smoke.ts --installed --upgrade` seeds an isolated temp user-data SQLite database (via `scripts/seed-upgrade-database.ts`, a separate process so the native module is not locked before the electron-ABI swap) with a synthetic 1.0.15 stale-v1 job, then launches the installed binary; `src/desktop/main.ts` runs `assertUpgradeReconciliation` to verify the app auto-corrected the interpretation and score at startup and left the `user_removed` job untouched. The real `%APPDATA%\Job Browser\data\jobs.sqlite` is never opened.

### Prior 1.0.15 content (still current, unchanged)
- Deterministic regex/rules engine (`src/intelligence/roleDetailsExtractor.ts`) extracts canonical RoleDetails without AI/LLM/NLP; precedence is structured provider data > labeled description sections > deterministic regex/rules > unknown. Persisted in `jobs.role_details_json` via migration `028_role_details.sql`.
- Provider integration fixes (USAJOBS requirements retention, Greenhouse fallback removal, SmartRecruiters `workplaceType`, Dice employment types).
- Regression hardening: clause-local remote/telework denial detection, explicit-denial-over-provider override (`remoteDenied` flag), generalized active/obtainable/eligible clearance classification, and shared U.S. state normalization via `src/utilities/us-states.ts` (28 regression tests).

## Recommended Next Sprint
- **Next Sprint**: Advanced Discovery Analytics & Alerting Rules.
