# NLP Regression And Upgrade Validation

Status: complete for the current Stage 29 handoff candidate.

## Shadow Regression

`tests/job-nlp-shadow-regression.test.ts` computes the existing deterministic
`scoreJob` recommendation, runs representative segmentation/classification,
strength, skill, evaluation, resume-evidence, and coverage operations, then
computes the deterministic recommendation again. The result and input job are
required to be byte-for-byte unchanged. The shadow coverage result must retain
`productionEffect: 'none'`.

## Verification

- `npm run verify`: full format, lint, strict typecheck, and Vitest gate.
- `npm run privacy:check`: distribution and fresh-install privacy gate.
- `npm run desktop:package`: rebuilds the Windows installer from current source.
- `npm run desktop:smoke:packaged`: validates the rebuilt unpacked package.
- `npm run desktop:smoke:installed`: validates the installed application copy.
- `npm run desktop:smoke:packaged -- --upgrade`: validates preservation of a
  seeded pre-upgrade database through the packaged application.

Focused tests are supporting evidence only; the full project gate and desktop
smoke commands are required for this stage.

## Upgrade Boundary

- NLP remains additive in `job_nlp_enrichments`.
- Existing `jobs` score, recommendation, eligibility, status, active, and
  lifecycle fields remain authoritative.
- Fresh installs begin with no NLP rows.
- Existing data is preserved through migration and packaged upgrade smoke.
- No semantic runtime or model artifact is introduced by the handoff candidate.

## P24 Current-Source Revalidation — 2026-09-11

- npm run verify: 157 files / 1,445 tests passed.
- npm run privacy:check: 3 files / 11 tests passed against the current app.asar.
- npm run nlp:security-audit: 3 tests passed with migrations 031-034 and all three shadow repositories in scope.
- Direct current-source desktop smoke: passed.
- Rebuilt unpacked package smoke: passed.
- Seeded packaged-upgrade smoke through migration 034: passed.
- Installed smoke remains tied to the P28 installer rebuild decision; the existing installer is stale and was not used as evidence for current source.
