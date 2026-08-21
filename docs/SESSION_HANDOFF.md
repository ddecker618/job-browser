# Session Handoff

## Current Phase

Phase 8, Employer Discovery, Manual Lifecycle, and Structured Role Details v1.0.15, stale role-details invalidation/reconciliation 1.0.17, geographic-eligibility 1.0.18, advanced discovery alerting/analytics 1.0.19, operational-state + timestamp bugfixes 1.0.20, versioned employer seed manifest import 1.0.21, health-audit remediation 1.0.22, discovery-alert reconciliation / imported-source remediation 1.0.23, discovery error remediation (failure categorization + zero-yield fix) 1.0.24, controlled source remediation, source-health alert classification, and validated source additions are complete. Current version is `1.0.25`. Migration head is `030`.

Controlled source remediation is COMPLETED AND COMMITTED at `986681c feat:
add controlled source remediation` on `main` (live run applied and verified
2026-08-21).

Milestone "Source Health Reconciliation and Alert Classification" is
IMPLEMENTED, VERIFIED (101 files / 1041 tests; desktop smoke green), and
DRY-RUN COMPLETE against a production snapshot copy; it awaits its scoped
commit — see the newest session checkpoint below, the only authoritative
resume point.

Production source creation for Datadog, MongoDB, Intel, and AMD is NOT yet
applied; those validated configurations remain pending a separate user
approval after this milestone.

## Session Checkpoint (2026-08-21 — Validated Source Additions and Legacy-Source Review: COMPLETE; version 1.0.25 release preparation)

Starting point: commit `cedc01b` atop `bfe22d0`. Production changes were
performed through the established controlled process (verified backup →
manifest dry-run → idempotent import → post-verification).

### Controlled source additions (applied to production)

Fresh verified backup BEFORE changes:
`%APPDATA%\Job Browser\backups\pre-source-addition-2026-08-21T18-54-50-758Z.sqlite`
(209,895,424 bytes, created 2026-08-21T18:54:51.730Z, integrity_check ok,
baseline counts matched: sources 34, jobs 2597).

Manifest `data/employer-seeds/validated-sources-2026-08-21.json`
(copy of record; imported via `npm run employers:import`). Dry-run and live
run produced identical counts: employers reused 4, career sites created 4,
sources created 3, unsupported candidates 1, invalid 0, ambiguous 0.

| Employer | Provider | Configuration | Source ID | State |
| --- | --- | --- | --- | --- |
| Datadog | greenhouse | `{boardToken:"datadog"}` | `1023cd71…` | enabled, never-run |
| MongoDB | greenhouse | `{boardToken:"mongodb"}` | `96c1d582…` | enabled, never-run |
| Intel | workday | `{origin:"https://intel.wd1.myworkdayjobs.com",tenant:"intel",site:"Intel_External"}` | `445f1b99…` | enabled, never-run |
| AMD | — | — | none | **STOPPED: blocker documented** |

AMD blocker: its careers portal is a custom-domain iCIMS instance
(`careers.amd.com`, `/api/jobs` confirmed working manually), but URL
fingerprinting only recognizes iCIMS on `*.icims.com` hosts, so the
supported manifest-import architecture cannot derive a Source configuration
for it. A career-site row was recorded as unsupported evidence. Adding AMD
requires either manual creation through the Sources UI with
`{portalUrl:"https://careers.amd.com"}` or a future approved extension for
explicit-config manifests. No fabrication was attempted.

Production totals after additions: **37 sources, 31 enabled**. Preserved
counts unchanged (jobs 2597, applications 2, observations 14458, status
history 2620). All seven protected sources remain enabled. New sources are
persisted in SQLite and survive application restart.

### Legacy demo-source review (evidence-based retention; zero disables)

Inspection disproved the "demo/legacy" classification for every candidate:
each points at a real company's live board with nonzero recent yield, and
each is the ONLY source covering that employer. Disabling them would remove
real coverage, so all seven were retained per the rule "disable only entries
proven to be obsolete demo, duplicate, or legacy rows."

| Source ID | Display name | Actual board | Jobs (recent 30d) | Disposition |
| --- | --- | --- | --- | --- |
| `6ae3f2f4…` | smartrecruiters | SanDisk (`Sandisk`) | 16 (16) | Retained |
| `b8c93993…` | smartrecruiters | Anexinet (`Anexinet1`) | 1 (1) | Retained |
| `d785aa69…` | smartrecruiters | Wix (`wix2`) | 2 (2) | Retained |
| `b457325c…` | smartrecruiters | Netcompany (`Netcompany1`) | 6 (6) | Retained |
| `1772613c…` | smartrecruiters | Bosch Group (`boschgroup`) | 6 (6) | Retained |
| `5a333069…` | Recruitee | bunq (`bunq.recruitee.com`) | 2 (2) | Retained |
| `98c90f61…` | mux | Mux (Ashby `mux`) | 27 (3) | Retained |

Recommended follow-up (requires separate approval): rename these sources'
display names/employers to the real companies they cover so the placeholder
labels stop reading as demo rows. No rows were modified during this review.

## Session Checkpoint (2026-08-21 — Source Health Reconciliation and Alert Classification: IMPLEMENTED AND VERIFIED; DRY RUN COMPLETE; UNCOMMITTED)

Starting point: commit `986681c` (remediation checkpoint) atop `dc91fd7`.
This is the authoritative resume point. Do not rely on chat history.

### Status buckets

- **Completed this milestone:** repository/production evidence collection;
  bounded career-site validation probes; alert-classification implementation
  (`discovery-alert-rules-v2`); ATS-tenant identity fix closing the
  cisco/crowdstrike duplicate-recreation gap; 16 new regression tests; full
  verification suites; production-safe dry run against a SQLite-backup
  snapshot copy.
- **Pending user decision:** review of this milestone and approval to commit
  it; approval of any live actions from the dry-run action table.
- **Deferred scope:** profile-preferences UI stages beyond Stage 0B remain
  deferred pending approval; file authority unchanged.
- **Prohibited scope (unchanged):** restoring Remote OK; disabling any
  protected source (Wellfound, ZipRecruiter, USAJOBS, LinkedIn, Dice, Indeed,
  Handshake); CAPTCHA/auth/anti-bot bypass; automatic applications;
  directory consolidations; god-file refactors; embeddings; notifications/
  exports; cross-platform packaging; Playwright changes; unrelated UI;
  scoring/resume/application-tracking changes; version bumps; commits or
  pushes without explicit instruction; ANY writes to the production database
  during this milestone.

### Files changed in this milestone (uncommitted)

- Added `src/discovery/alertClassification.ts`: shared taxonomy
  (`unsupported-platform`, `pending-credentials`, `browser-session`,
  `anti-bot`, `transient-network`, `invalid-url`,
  `chronic-provider-failure`, `legitimate-zero-openings`,
  `zero-yield-regression`, `scheduler-downtime`, `overdue-run`, `broken`),
  browser-session provider set, and deterministic failure/site-health
  classifiers with recommended actions.
- Modified `src/discovery/discoveryAlertService.ts`: rule version bumped to
  `discovery-alert-rules-v2`; every alert message now ends with
  "Classification: … Action: …" and evidence carries `classification`;
  browser-session/pending-credential/anti-bot/transient failures cap at
  WARNING (never CRITICAL); unsupported-platform and invalid-url career sites
  downgrade from CRITICAL to WARNING; scheduler-downtime detection suppresses
  per-source overdue/stale when no run of ANY source occurred within 3×
  cadence and emits one aggregate INFO `scheduler-inactive` instead;
  zero-yield-streak skips browser-session providers entirely.
- Modified `src/domain/urlIdentity.ts`: `atsTenantIdentity` now maps the
  `cisco` and `crowdstrike` identifiers onto their fixed Workday tenants
  (`workday:cisco:Cisco_Careers`,
  `workday:crowdstrike:crowdstrikecareers`), so employer-seed import and
  employer-discovery dedup can no longer recreate the duplicate Sources that
  controlled remediation disabled.
- Added `tests/alert-classification.test.ts` (16 tests) covering every
  classification; updated `tests/discovery-alerts.test.ts` (message-format
  assertion); extended `tests/url-identity.test.ts` (tenant-identity
  mapping).
- No migration was created or needed: classification lives in
  `evidence_json` under the bumped rule version.

### Repository and database evidence (read-only)

- Production snapshot taken via SQLite backup API into temp
  (`milestone-snapshot.sqlite`); production never opened read-write this
  milestone; no WAL/SHM touched; desktop app state unchanged.
- Employers registry is clean: single canonical rows for Cisco/CrowdStrike/
  Workday; case variants exist only in legacy Source display names
  (`cisco`, `crowdstrike`, `workday`, `greenhouse`, `icims`, `linkedin`,
  `mux`, five lowercase `smartrecruiters` demo sources). Three legitimate
  aliases exist (aws→Amazon, google cloud→Google, wgu→WGU). No duplicate
  ATS-tenant groups remain among enabled sources after remediation.
- Bounded public probes (hardened client, ~17 requests total):
  - GitHub: `www.github.careers` AND apex both DNS-unresolvable; Greenhouse
    board/API 404 → dead stored URL, no supported ATS found.
  - Datadog: `careers.datadoghq.com` DNS-dead; official board CONFIRMED at
    Greenhouse token `datadog` (API 200, 448 live jobs).
  - MongoDB: stored URL 404s; Greenhouse token `mongodb` CONFIRMED (API 200,
    411 live jobs); boards.greenhouse.io/mongodb redirects to MongoDB's own
    custom careers site.
  - Intel: `jobs.intel.com` root 403 via anti-bot redirector; Workday CXS
    tenant CONFIRMED at `intel.wd1.myworkdayjobs.com/Intel_External` (200).
  - AMD: modern iCIMS endpoint CONFIRMED at `careers.amd.com/api/jobs`
    (200, ~343 KB JSON) — future Source creation candidate.
  - One transient local-DNS failure observed for boards.greenhouse.io mid-run
    (same host resolved seconds earlier/later) — reinforces transient-network
    classification.

### Implemented behavior (summary)

Alerts now distinguish unsupported platform vs pending credentials vs
browser-session vs anti-bot vs transient network vs invalid URL vs chronic
provider failure vs legitimate zero openings vs zero-yield regression vs
scheduler downtime vs overdue-run vs genuinely broken. Pending-credential and
browser-session sources can never appear CRITICAL/broken; HTTP 403/429 stays
visible as anti-bot; DNS/transient failures are retry-aware; healthy
zero-opening results never alert; zero-yield regression still requires ≥3
complete non-truncated cycles plus historical yield; stale/overdue alerts do
not fire while the desktop-local scheduler was inactive (aggregate INFO
notice instead). Resolution continues to flow exclusively through
`evaluateRules()`; history and audit columns untouched; APIs/UI consume the
same fields (messages are richer strings), so compatibility is preserved
without migration.

### Verification results

- Targeted: `alert-classification`, `discovery-alerts`, `url-identity`,
  `remediate-sources` — 60/60 green during development.
- `npm run verify` fully green: format, lint, strict typecheck, Vitest
  **101 files / 1041 tests** (was 100/1025 at checkpoint `986681c`).
- `npm run desktop:smoke` passed.

### Production-safe dry run (snapshot copy only)

Ran `discovery-alert-rules-v2` evaluation against a writable temp copy of the
production snapshot:

| Before (unresolved) | After (unresolved) |
| --- | --- |
| CRITICAL career-site-broken ×3; WARNING career-site-broken ×1; WARNING discovery-stale ×14; WARNING source-overdue ×14 (32 total) | INFO scheduler-inactive (scheduler-downtime) ×1; WARNING invalid-url ×2 (GitHub, Datadog); WARNING unsupported-platform ×1 (MongoDB); WARNING anti-bot ×1 (Intel) — 5 total, 0 CRITICAL |

Proposed live actions (NOT applied; require separate approval):

| Employer | Proposed action | Evidence | Rows affected | Rollback |
| --- | --- | --- | --- | --- |
| Datadog | Create enabled greenhouse Source `{boardToken:"datadog"}`; correct career-site URL to `https://boards.greenhouse.io/datadog`; re-run health check | API 200 / 448 jobs | 1 new source row; 1 career-site row URL/health update | Delete created source; restore prior site values from snapshot |
| MongoDB | Same with `{boardToken:"mongodb"}` and current official careers URL | API 200 / 411 jobs | same shape | same |
| Intel | Create workday Source `{origin:"https://intel.wd1.myworkdayjobs.com",tenant:"intel",site:"Intel_External"}` | CXS 200 | same shape | same |
| AMD | Candidate icims Source `{portalUrl:"https://careers.amd.com"}` after user confirms interest | `/api/jobs` 200 | 1 new source row | delete created source |
| GitHub | Manual follow-up: official careers domain does not resolve; no supported ATS detected | DNS + 404 probes | none | n/a |
| Legacy demo sources (five lowercase `smartrecruiters`, demo `Recruitee`, `mux`) | Optional future Disable-with-reason pass pending user yield review | 68–206 runs, ≤27 lifetime jobs | source rows only | re-enable rows |

No jobs, applications, observations, or history would be deleted by any
proposed action; protected sources stay enabled in every proposed state.

### Remaining unresolved items

- GitHub disposition (manual external follow-up).
- User decisions on proposed Datadog/MongoDB/Intel/AMD source creation.
- Optional legacy-demo-source disable pass.
- USAJOBS browser login may occasionally reject a known device through
  login.gov. Retry in the visible browser or re-authenticate manually. This
  is a site-side authentication issue, not automatically evidence of a
  connector defect.
- Career-site warnings for reachable-but-unsupported custom platforms
  (Adobe, Airbnb, Amazon, Atlassian, Cloudflare, IBM, ServiceNow, Spotify,
  Dell, Apple, Meta, Microsoft, Salesforce, Stripe, Uber, Oracle) remain
  informational registry context; Oracle Recruiting Cloud stays documented
  unsupported.

### Exact next action

User reviews this milestone. On approval: commit the milestone (scoped files
only), then optionally approve specific live actions from the dry-run table
as a separate controlled step with its own backup. Do not start live actions
or further milestones without approval.

## Historical Checkpoint (2026-08-21 — Controlled Source Remediation: COMPLETED, LIVE RUN APPLIED AND VERIFIED, COMMITTED AT `986681c`)

Superseded as a resume point by the newest checkpoint above; retained for
evidence, backup paths, rollback instructions, and historical results.

### Status buckets

- **Completed this session:** bounded `sources:remediate` CLI, its test suite,
  the npm script wiring, a production dry-run, mandatory preflight (path,
  process-lock, integrity, baselines, protected/Remote OK checks), verified
  backups, the approved LIVE remediation (six disables), full post-run
  verification, alert re-evaluation through the supported service path, and
  all verification suites.
- **Completed documentation:** CHANGELOG `[Unreleased] - 2026-08-21` entry;
  README migration-head correction (`026` → `030_employer_aliases.sql`) and
  provider-inventory rows for Cisco/CrowdStrike; this checkpoint.
- **Pending user decision:** approval or rejection of the proposed
  next-stage cleanup plan (presented as classification-only recommendations;
  NOT implemented — see "Exact next action"). Reconciliation evidence for the
  live run was reviewed and ACCEPTED on 2026-08-21; no further production
  investigation is authorized or required.
- **Prohibited scope (user-mandated):** restoring Remote OK in any form;
  automatic disabling of Wellfound, ZipRecruiter, USAJOBS, or any
  browser-session provider; CAPTCHA/authentication/anti-bot bypass; automatic
  job applications; consolidating src/database with src/db; utility/model/
  domain/schema directory consolidation; god-file refactoring; embeddings or
  new matching systems; macOS/Linux packaging; lazy Playwright installation;
  notifications/digests; export features; unrelated UI redesign; broad
  security redesign; version bumps; commits or pushes without explicit
  instruction. Version remains `1.0.24`; no migration was created.

### Controlled remediation scope and user decisions (2026-08-21)

Goal: separate active from expired listings (already shipped via migration
`026` lifecycle + JobsPage Opportunity view — verification only, no changes),
preserve application history/workflow status across expiry (verified: one
inactive `applied` job retains its Application row), investigate unhealthy
sources using real health evidence, repair what is reliable, disable what is
not with documented reasons, verify Cisco/CrowdStrike behavior, and confirm
Remote OK stays removed.

User decisions recorded:

1. Wellfound remains enabled; browser-session failures are expected and
   require manual login/intervention; never auto-disabled.
2. ZipRecruiter remains enabled for the same reason; preserve its
   browser-session configuration; continue reporting health without disabling.
3. USAJOBS remains enabled pending credential configuration; its zero-job
   yield must not be treated as evidence of an unsupported or broken source.
4. These three are report-only exceptions in the remediation CLI, in both
   dry-run and live modes.
5. Protected browser-session set hard-coded in the CLI:
   `wellfound`, `ziprecruiter`, `usajobs`, `linkedin`, `dice`, `indeed`,
   `handshake`. Applying an action against any of them throws.
6. Conditions: dry-run is the default; no records deleted; verified backup
   before live changes; live results reviewed before further work; jobs,
   applications, observations, history, and inactive-listing records remain
   unchanged; do not bump version; do not commit or push.

Remote OK confirmation (reconciled 2026-08-21): Remote OK is absent from the
production database entirely — no `remote-ok` row exists there. It is absent
from the provider registry: no provider file exists, ARCHITECTURE.md marks it
Removed, and `tests/provider-registration.test.ts` asserts the exact
21-provider list with no `remote-ok`, guarding against reintroduction.
Disabled migration-014 remnant rows (`provider:remote-ok`, health_message
"Remote OK is no longer supported") exist ONLY in identified non-production
databases: the repository's stale default `data/job-browser.sqlite`
(migration head 14) and `data/desktop-dev/data/jobs.sqlite`. Nothing to
change.

Cisco/CrowdStrike verification: both providers are hardcoded Workday-tenant
subclasses (`cisco.wd5.myworkdayjobs.com`, `crowdstrike.wd5...`), consistent
with the 1.0.23 fingerprint unification. Production held duplicate Sources per
tenant; the planner keeps the canonical career-site-linked Workday-path
source and disables the duplicate.

### Files added or modified this session

- Added: `src/discovery/cli/remediate-sources.ts` — exported pure core
  (`planRemediation`, `applyRemediationActions`, `createVerifiedBackup`,
  `assertRequiredSchema`, `PROTECTED_PROVIDER_IDS`) plus CLI main. Rules:
  `chronic-categorical-failure` (>=3 consecutive failed runs AND latest
  failure message matches /is unreachable or inactive/i), `duplicate-ats-
  tenant` (workday-family tenant identity via `atsTenantIdentity` + hardcoded
  cisco/crowdstrike endpoints + normalized icims portalUrl; keeper preference:
  career-site-linked > most job_sources links > lexicographic id),
  `retired-career-site` (enabled source whose career_sites link is retired).
  Apply is transactional disable-only (`enabled=0` + reason into
  `health_message`), refuses protected providers, never deletes. Live mode
  requires `--live` and creates an integrity-checked, count-verified backup at
  `<db-root>/backups/pre-source-remediation-<timestamp>.sqlite` first.
- Added: `tests/remediate-sources.test.ts` — 14 tests covering every rule,
  the threshold boundary, DNS-transient exclusion, protected-source refusal
  and report-only behavior, idempotent re-planning, no-deletion preservation
  with an application row intact, icims URL-identity dedup, and backup
  verification.
- Modified: `package.json` — added `"sources:remediate": "tsx
  src/discovery/cli/remediate-sources.ts"`.
- Pre-existing worktree state (predates this session, untouched):
  `_query_db.mts` deleted (uncommitted); untracked
  `scripts/_tmp_diag_*.mjs` diagnostics, `react-router-8.3.0.tgz`,
  `data/employer-candidates/`, `data/employer-seeds/`.

### Dry-run results (presented 2026-08-21)

Executed against a coherent better-sqlite3 backup snapshot of the installed
database copied to temp (`prod-copy/jobs.sqlite`). The original production
database was opened read-only to build the snapshot; nothing else touched it.

Six planned disables (dry-run output reviewed by user):

| Source | Rule | Evidence |
| --- | --- | --- |
| encyclis `9eab76b2-f1ff-42c1-aa88-b40bb9b0d735` (icims legacy portal) | chronic-categorical-failure | 3 consecutive failed runs; "iCIMS careers site is unreachable or inactive" |
| Etsy `b83378ba-e621-4eb2-a23e-ad51257ccae9` (bamboohr) | chronic-categorical-failure | 10 recent consecutive failures; "BambooHR subdomain is unreachable or inactive"; actual ATS is Clinch Talent (unsupported) |
| cisco `8634ed3c-fb6e-40ed-9f7c-c2d1cde71c93` | duplicate-ats-tenant | same `workday:cisco:cisco_careers` as retained `36ba46c2` (career-site-linked) |
| crowdstrike `002178d1-6ca9-4743-8c8a-651c0a1b3749` | duplicate-ats-tenant | same `workday:crowdstrike:crowdstrikecareers` as retained `78d039c1` (Workday connector) |
| icims `ea5eb992-f569-4f6b-95cf-ae7519415955` | duplicate-ats-tenant | same portal URL careers.costco.com as retained `821fc5ff` (Costco) |
| Hooli `576e2667-0b71-423b-a150-287040e49d7a` (smartrecruiters) | retired-career-site | linked site retired ("Retired legacy fictional starter fixture") |

Report-only entries: 7 protected sources (Wellfound, ZipRecruiter, LinkedIn,
Dice, Indeed, USAJOBS, Handshake — all currently healthy) and 20 broken/
warning career-site notes (GitHub, Datadog, MongoDB broken; Intel HTTP 403;
redirect/no-ATS warnings). Zero actions touch protected providers or any
broken/warning site.

### Verification status

- `npm run verify` fully green after changes: format:check, ESLint, strict
  typecheck, Vitest **100 files / 1025 tests passed** (was 99/1011; +14 new
  remediation tests).
- One transient 5000 ms timeout in `tests/provider-registration.test.ts`
  during the first full run; retested clean in isolation and in the second
  full gate. Flaky dynamic-import timing, unrelated to these changes.

### Live run execution and evidence (2026-08-21)

Preflight (all gates passed): `JOB_BROWSER_DB_PATH` resolved to
`%APPDATA%\Job Browser\data\jobs.sqlite`; exclusive file-open proved no
process held the database; no Electron/Job Browser processes existed;
`integrity_check` and `quick_check` both `ok`; migration head 30; baselines
recorded. Preflight found NO remote-ok row in production — an earlier session
note claiming one was a cross-database mix-up (the disabled migration-014
remnant exists only in the repo's stale default DB and the desktop-dev DB);
the dry-run snapshot and live database agreed exactly (34 sources, all
enabled), so no material discrepancy existed.

iCIMS/Costco duplication proven before disabling: `ea5eb992…` (employer
"icims", created 2026-07-31T15:19Z, 9 hours AFTER canonical Costco source
`821fc5ff…` at 06:33Z) stores the identical portal URL
`https://careers.costco.com` with placeholder company "icims", has no
career-site link, fewer linked jobs (50 vs 53), and zero failures in 70 runs
— a true duplicate endpoint, not an unsupported source.

Backups (both verified: integrity_check ok + matching table counts):
1. Standalone Phase-2 backup:
   `%APPDATA%\Job Browser\backups\pre-source-remediation-2026-08-21T17-01-40-513Z.sqlite`
   (209,866,752 bytes, created 2026-08-21T17:01:40.941Z, integrity_check ok)
2. CLI-created immediately before apply:
   `%APPDATA%\Job Browser\backups\pre-source-remediation-2026-08-21T17-01-55-782Z.sqlite`
   (209,866,752 bytes, mtime 2026-08-21T17:01:56.245Z, integrity_check ok)

Applied via `npx tsx src/discovery/cli/remediate-sources.ts --live`:
exactly six disables, zero deletions, six reasons written to
`health_message`. Disabled rows: encyclis `9eab76b2-f1ff-42c1-aa88-b40bb9b0d735`,
Etsy `b83378ba-e621-4eb2-a23e-ad51257ccae9`, cisco duplicate
`8634ed3c-fb6e-40ed-9f7c-c2d1cde71c93` (retained `36ba46c2…`),
crowdstrike duplicate `002178d1-6ca9-4743-8c8a-651c0a1b3749` (retained
workday-path `78d039c1-7453-4b07-a81d-5a216fdf5d03`), icims/Costco duplicate
`ea5eb992-f569-4f6b-95cf-ae7519415955` (retained `821fc5ff…`), Hooli
`576e2667-0b71-423b-a150-287040e49d7a`.

Post-run verification: every preserved count identical before/after (jobs
2597 = 1841 active + 756 inactive; applications 2; application_history 2;
job_observations 14458; job_status_history 2620; career_sites 36); row-level
diff against the backup shows ONLY the six approved rows changed (no inserts,
deletes, or other updates); exactly one canonical source remains enabled per
remediated tenant; all seven protected sources remain enabled; USAJOBS is
healthy with its pending-credentials recommendation unchanged; the inactive
`applied` job retains status `applied`, its Application row, and its event.

Alert re-evaluation used the application's supported path
(`new DiscoveryAlertService(database).evaluateRules()`, same as backend
startup). Both `source-failure-streak` CRITICAL alerts (Etsy ×16, encyclis ×3)
resolved. Still unresolved after evaluation:

- CRITICAL career-site-broken ×3: GitHub and Datadog ("careers site URL is
  invalid or not allowed"), MongoDB ("reachable, but no supported ATS signals").
  No Sources exist for these employers; they are career-site-level problems.
- WARNING career-site-broken ×1: Intel HTTP 403 (anti-bot block).
- WARNING discovery-stale ×14 / source-overdue ×14: time-based artifacts of
  the application not running since 2026-08-18 (85–87 h against 24 h cadence);
  expected to clear on the next scheduled cycle once the app runs again.

Verification suites after the live change: targeted
`tests/remediate-sources.test.ts` 14/14; `npm run verify` green (format,
lint, strict typecheck, Vitest **100 files / 1025 tests**);
`npm run desktop:smoke` passed ("Desktop smoke test passed"; dev-only
database, production untouched by smoke).

### Authoritative post-remediation project state (single source of truth)

Controlled source remediation was completed and verified on 2026-08-21.

- Production database
  `C:\Users\dusti\AppData\Roaming\Job Browser\data\jobs.sqlite` (migration
  head 30): 34 sources total — 28 enabled, 6 disabled with documented
  reasons in `health_message`.
- Exactly the six approved source rows changed (`enabled` 1→0 plus reason
  and timestamp); a full row-level diff against the verified backup proves no
  seventh or unrelated row changed anywhere in `sources`.
- All preserved counts are unchanged before/after: jobs 2597 (1841 active +
  756 inactive), applications 2, application_history 2, job_observations
  14458, job_status_history 2620, career_sites 36, discovery_runs 2405.
- Both verified backups exist under `%APPDATA%\Job Browser\backups\`
  (paths, sizes, timestamps, and integrity results in "Live run execution
  and evidence" above).
- All seven protected sources remain enabled: Wellfound, ZipRecruiter,
  USAJOBS (pending credentials, not unsupported), LinkedIn, Dice, Indeed,
  Handshake. Remote OK remains absent from production and from the provider
  registry.
- Version remains `1.0.24`; migration head remains `030`; no migration was
  created; nothing has been committed or pushed; no stashes exist.
- Worktree: HEAD `dc91fd7 fix: finish discovery error remediation`; modified
  `package.json`, `docs/SESSION_HANDOFF.md`, `docs/CHANGELOG.md`, `README.md`;
  untracked new files `src/discovery/cli/remediate-sources.ts` and
  `tests/remediate-sources.test.ts`; pre-existing `_query_db.mts` deletion,
  `_tmp_*` scripts, and untracked data artifacts untouched.

### Exact next action

User review of this consolidated checkpoint. If approved, the proposed
NEXT-STAGE cleanup plan (classification-only recommendations; NOT
implemented) would be converted into a bounded phase plan before any work:
GitHub/Datadog/MongoDB broken-site repair-or-retire decisions, Intel warning
disposition, alias/case-variant employer dedup, zero-yield source review, and
an alert-taxonomy review separating unsupported vs credential-pending vs
browser-session vs anti-bot vs transient vs genuinely-broken. Do not start it
without approval.

### Rollback procedure (corrected 2026-08-21 after reconciliation)

**Authoritative method:** close the Job Browser desktop application, restore
either verified backup listed above over
`%APPDATA%\Job Browser\data\jobs.sqlite`, and delete the stale
`-wal`/`-shm` sidecars of the restored database before relaunching (SQLite
recreates them). Both backups pre-date the remediation transaction, so a
restore returns every row — including all six changed sources — to its exact
prior state.

**Surgical per-row reversal** (only if a targeted revert is required): each
changed row had a NON-NULL prior `health_message` and its own prior
`updated_at`; setting `health_message = NULL` would NOT restore prior state.
Restore `enabled = 1` together with these exact values captured from backup
`pre-source-remediation-2026-08-21T17-01-40-513Z.sqlite`
(`health_status` was not modified by the remediation):

| Source id | Employer | Prior health_status | Prior health_message | Prior updated_at (UTC) |
| --- | --- | --- | --- | --- |
| `9eab76b2-f1ff-42c1-aa88-b40bb9b0d735` | encyclis | failed | Provider unavailable: iCIMS careers site is unreachable or inactive | 2026-08-18T02:20:10.964Z |
| `b83378ba-e621-4eb2-a23e-ad51257ccae9` | Etsy | failed | Provider unavailable: BambooHR subdomain is unreachable or inactive | 2026-08-18T02:20:42.450Z |
| `8634ed3c-fb6e-40ed-9f7c-c2d1cde71c93` | cisco | healthy | No jobs matched current filters | 2026-08-18T03:42:04.982Z |
| `002178d1-6ca9-4743-8c8a-651c0a1b3749` | crowdstrike | healthy | No jobs matched current filters | 2026-08-18T03:42:14.108Z |
| `ea5eb992-f569-4f6b-95cf-ae7519415955` | icims | healthy | No jobs matched current filters | 2026-08-18T05:26:44.059Z |
| `576e2667-0b71-423b-a150-287040e49d7a` | Hooli | healthy | No open positions found | 2026-08-18T05:29:01.875Z |

Reconciliation note: the earlier completion report omitted Hooli from its
change table; database evidence confirms Hooli WAS disabled in the same
transaction (`enabled 1→0`, reason written, `updated_at
2026-08-21T17:01:57.017Z`, identical to the other five rows). A full row-level
diff against the verified backup shows exactly six changed source rows and no
other modification anywhere in the `sources` table.

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
