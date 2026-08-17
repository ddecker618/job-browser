# Session Handoff

## Current Phase

Phase 8, Employer Discovery, Manual Lifecycle, and Structured Role Details v1.0.15, stale role-details invalidation/reconciliation 1.0.17, geographic-eligibility 1.0.18, advanced discovery alerting/analytics 1.0.19, operational-state + timestamp bugfixes 1.0.20, versioned employer seed manifest import 1.0.21, health-audit remediation 1.0.22, discovery-alert reconciliation / imported-source remediation 1.0.23, and discovery error remediation (failure categorization + zero-yield fix) 1.0.24 are complete and Architect-approved. Current version is `1.0.24`. Migration head is `030`.

## Current Implementation Checkpoint (2026-08-17 — 1.0.24 Discovery Error Remediation: Failure Categorization & Zero-Yield Fix)

### What changed in this release
- **BambooHR failure categorization**: `BambooHrProvider.validateConfiguration` now returns a structured `failureCategory` (`'unreachable'`, `'timeout'`, `'blocked'`) instead of a generic message.
- **ProviderHttpClient error detail passthrough**: The generic catch now includes the original error message, so downstream string matching can classify the root cause.
- **DNS-specific translateError branch**: "could not be resolved" errors produce `"Provider unavailable: DNS resolution failed for host"` instead of the generic catch-all.
- **Zero-yield healthy source skip**: Sources with `health_status = 'healthy'` are excluded from zero-yield evaluation. Exhausted job pools are not malfunctions.

### Verified state (2026-08-17)
- Full gate green: `npm run verify` (format, lint, typecheck, vitest — 99 files / 1011 tests).
- Desktop smoke green: `npm run desktop:smoke`.
- Installer: `release/Job-Browser-Setup-1.0.24.exe`.

## Prior 1.0.23 content (Discovery Alert Rule Reconciliation & Imported Source Remediation)
- **Zero-yield streak rule corrected**: `zero-yield-streak` requires completed, non-truncated runs (`complete_snapshot = 1 AND fetch_truncated = 0`), groups sub-query runs within 60s into a discovery cycle, and fires only after 3 distinct complete zero-yield cycles on a source with historical yield. Clears 15 of 17 production alerts (only PaloAltoNetworks, ZipRecruiter genuinely fire).
- **Career-site-broken rule narrowed**: fires CRITICAL only for `health_status = 'broken'`, WARNING only for `warning AND health_failure_count > 0`. Clears 18 of 22 production alerts.
- **Discovery-stale rule corrected**: excludes terminal `unsupported` discovery states and sites whose Source schedule is disabled/manual. Clears all 8 production false positives.
- **DNS classification fix**: `boundedPublicFetch` rethrows `Public host could not be resolved`; `atsDetector` maps it to `unreachable` (transient) instead of `invalid_url` (broken). Datadog/GitHub no longer misreport as CRITICAL.
- **CrowdStrike fingerprint boundary unified**: `.myworkdayjobs.com` is uniformly the `workday` provider with `{origin, tenant, site}`; `crowdstrike` remains a valid registered provider.
- **Operations Console triage**: alerts panel sorts CRITICAL-first, groups by rule with counts, shows full local date-time strings.
- **Never-detected support state**: never-fingerprinted career sites now report `never-detected` instead of `unsupported`, fixing the desktop smoke failure where the candidate-backlog filter hid every seeded employer.
- **Etsy triage (documentation only)**: Etsy's ATS is Clinch Talent at `careers.etsy.com` (not Greenhouse/BambooHR); greenhouse board probes 404. Source `b83378ba-e621-4eb2-a23e-ad51257ccae9` left as-is; no config swap.

### Verified state (2026-08-16)
- Full gate green: `npm run verify` (format, lint, typecheck, and vitest 99 files / 1004 tests all pass).
- Desktop smoke green: `npm run desktop:smoke` passes all `asserting-*` stages.
- Installer: `release/Job-Browser-Setup-1.0.23.exe`, size: 249,939,874 bytes, SHA-256: `8F4277D548840AB52C816C18EEEB3416C3BBD22214CD7A9469A0A4DF2D26517F`.

## Prior 1.0.22 content (Health Audit Remediation & Rebuilt Installer)

### What changed in this release
- **Health Audit Remediation**: Resolved and cleared remaining ESLint errors, warnings, type-casting issues, and code style formatting check issues across the codebase, allowing `npm run verify` check to pass completely clean.
- **Rebuilt Installer**: Packaged and generated the NSIS installer at `release/Job-Browser-Setup-1.0.22.exe` (SHA-256 and size detailed below).

### Verified state (2026-08-16)
- Full gate green: `npm run verify` (format, lint, typecheck, and vitest 99 files / 993 tests all pass).
- Installer: `release/Job-Browser-Setup-1.0.22.exe`, size: 249,936,380 bytes.

## Prior 1.0.21 content (Employer Seed Manifest Import)

### What changed in this release
- **Versioned manifest import**: JSON/CSV manifests (`employer-seed-manifest-v1`) of employer names, root domains, and careers URLs import idempotently with no duplicate Employers/CareerSites/Sources. Identity resolution is deterministic (domain → alias → normalized name; exact URL → URL identity → ATS family+tenant → effective URL → evidence), batched in transactions of ≤25 with full-batch rollback on database errors.
- **Dry-run + surfaces**: `npm run employers:import -- <file> [--dry-run]` CLI and `POST /api/employer-discovery/import` (`{format, contents, dryRun}`) both report the full summary plus `rowsByStatus`; dry-run performs no writes while mirroring live counts.
- **Evidence & lifecycle**: imported sites are URL-fingerprinted (no network); importer evidence is written AFTER verification so it survives the evidence wipe; retired sites are reused as-is with no evidence/Source; disabled/archived Sources are reused and never auto-re-enabled.
- **Schema**: migration `030_employer_aliases.sql` (unique `normalized_alias` global identity); `src/domain/urlIdentity.ts` (canonical URL/domain/name/config/ATS-tenant identities); `src/models/employer-manifest.ts` + `src/schemas/employer-manifest.ts` (zod JSON + CSV parsers).
- **Bugfixes**: `normalizeUrlIdentity` was dropping all query params (URLSearchParams live-binding); CSV column matching was case-sensitive against a lowercased header; JSON arrays were not rejected as non-object manifests.
- **Testing**: `tests/url-identity.test.ts`, `tests/employer-manifest.test.ts`, `tests/employer-seed-importer.test.ts` (14 tests incl. rollback via injected trigger, aliases, ATS-tenant reuse, curated-starter stability), `tests/employer-import-api.test.ts`; migration-list tests updated for `030`.

### Verified state (2026-08-16)
- Full gate green: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (99 files / 1005 tests).
- CLI smoke-tested against an isolated `JOB_BROWSER_DB_PATH` database: dry-run, live import, and an idempotent second import all correct.
- No installer was produced for 1.0.21 (code + docs only); the 1.0.20 installer remains the packaged release.

## Prior 1.0.20 content (Discovery State & Timestamp Bugfixes)
- **Operational State Clarification**: Added explicit subsystem running states (`employerDiscoveryRunning`, `careerSiteHealthRunning`, and `alertEvaluationRunning`) to `/api/sources/control-center` and the `SourceControlCenter` type definition, letting the frontend know when background processes are active. Exposes `isRunning()` on `EmployerDiscoveryService` and `CareerSiteHealthService`.
- **UI Running Pill**: Replaced the ambiguous aggregate "Running" status in `EmployersPage.tsx` with dynamic subsystem checking, displaying specific statuses like "Employer discovery running" or "Idle".
- **Alert Timestamps normalizer**: Introduced `ensureIsoUtc()` in `timestamps.ts` to normalize database datetime strings consistently (handling SQLite defaults vs app-created timestamps) into canonical UTC strings with Z suffix. Applied it on retrieval/mapping boundaries.
- **Removed system clock dependency**: Replaced `Date.now()` / `new Date()` with `this.now()` inside `DiscoveryAlertService.evaluateRules()` to ensure deterministic evaluations in testing and production.
- **Testing**: Added unit/integration and UI/API regression tests in `tests/discovery-alerts.test.ts`, `tests/employers-ui.test.tsx`, and `tests/source-api.test.ts`.

### Verified state (2026-08-16)
- Full gate green: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (95 files / 961 tests).
- Installer: `release/Job-Browser-Setup-1.0.20.exe`, 249,911,168 bytes, SHA-256: `8A4196B0834A4233EE08D8190DCA8297C02006F65DB75B0C94C1A0FF2DCB7776`.
- Packaged smoke test passed successfully.

## Prior 1.0.19 content (Advanced Discovery Analytics & Alerting)
- **Database Migration**: Schema migration `029_discovery_alerts.sql` sets up the `discovery_alerts` table.
- **Analytics Read Model**: `DiscoveryAnalyticsService` queries windowed stats and rollups.
- **Alerting Rules Engine**: `DiscoveryAlertService` tracks 6 conditions (failure-streak, source-overdue, career-site-broken, zero-yield-streak, discovery-stale, provider-degraded) with suppression.
- **REST Endpoints & Dashboard Console**: Wire up endpoints and console panels inside the employers control page and dashboard.

## Recommended Next Sprint
- **Next Sprint**: Advanced Resume Tailoring & Matching Feedback Loop.

## Remaining Manual Attention (from 1.0.23 alert triage)
- **PaloAltoNetworks** (source `84dc256a`) and **ZipRecruiter** are the two genuinely zero-yield sources; investigate their career portals, then decide whether to repair, pause, or retire them.
- **Etsy** careers (Clinch Talent) is unsupported — no action in app; external follow-up only.
- The four CRITICAL/WARNING sites still alerting after the rule fixes (MongoDB broken, Datadog/GitHub DNS transient, Intel warning) should be re-checked after the next discovery cycle to confirm they clear.
