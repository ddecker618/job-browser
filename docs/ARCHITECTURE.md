# Job Browser System Architecture

> **Document responsibility:** Describe the implemented system structure,
> component responsibilities, runtime data flow, security boundaries, and
> supported extension seams. Product requirements, persistence specifications,
> feature behavior, and delivery sequencing belong in their dedicated
> documents.

## System Overview

> **Section purpose:** Establish the deployed shape of Job Browser and the major
> trust and process boundaries.

Job Browser is a desktop Electron application that discovers job listings from
multiple ATS, employer, government, structured-data, and job-board sources.
Users configure sources that run manually or on in-app schedules. Discovered
records pass through provider normalization and are stored in a local SQLite
database for the React application to browse.

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process                          │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  Backend.ts   │───>│ Source Repository     │  │
│  │  (Express)    │    │  (SQLite via          │  │
│  │               │    │   better-sqlite3)     │  │
│  │  /api/sources │    └───────────────────────┘  │
│  │  /api/jobs    │    ┌───────────────────────┐  │
│  │  /api/...     │───>│ Discovery Coordinator  │  │
│  └──────────────┘    │  (runs sources)        │  │
│         │            └────────┬──────────────┘  │
│         │                     │                  │
│  ┌──────┴──────────┐  ┌──────┴──────────────┐  │
│  │  Renderer (SPA) │  │  Discovery Engine    │  │
│  │  React + Router │  │  -> Provider.search()│  │
│  │  REST API       │  │  -> Provider.fetch() │  │
│  └─────────────────┘  │  -> Provider.normalize│  │
│                        └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## High-Level Components

> **Section purpose:** Inventory the major runtime and build components without
> duplicating their detailed responsibilities.

- **Runtime:** Electron 42 with Chromium and Node.js 24 provides the desktop
  shell and owns the backend lifecycle.
- **Backend:** Express runs with the desktop process and serves the REST API and
  static React assets.
- **Frontend:** React and React Router provide the sandboxed renderer SPA.
- **Persistence:** SQLite through `better-sqlite3` and repositories provides
  local durable storage; schema details belong in the database documentation.
- **Discovery:** The `DiscoveryCoordinator`, `DiscoveryEngine`, source
  repositories, and provider implementations perform bounded source runs.
- **Provider transport:** A shared HTTP client applies concurrency, retry,
  redirect, response, and network-address controls. Playwright provides visible
  Chromium sessions for approved browser-backed connectors.
- **Validation:** Zod schemas validate provider configuration, search criteria,
  normalized records, and API inputs.
- **Build:** TypeScript compiles to ESM and electron-builder produces the Windows
  NSIS installer and unpacked application.

## Responsibilities

> **Section purpose:** Assign one primary responsibility to each high-level
> component so later work does not blur boundaries.

- The Electron main process owns application startup, the backend lifecycle,
  desktop integration, the narrow preload bridge, and graceful shutdown.
- Express exposes loopback-only application services and serves the renderer;
  it does not own provider-specific extraction logic.
- The React renderer owns user interaction and calls validated backend or
  preload capabilities; it does not access Node.js or SQLite directly.
- Repositories own persistent reads and writes and isolate SQLite from UI and
  provider code.
- The `DiscoveryCoordinator` is the entry point for manual, scheduled, CLI, and
  fixture discovery and serializes source execution.
- The `DiscoveryEngine` executes the provider lifecycle and persists normalized
  discovery results through repository boundaries.
- Providers own source-specific configuration, search construction, fetching,
  raw-record validation, filtering, and normalization.
- The scheduler identifies due enabled sources while the desktop process is
  running; it does not run after application exit or catch up missed runs on
  startup.

Each source retains a `providerId`, provider-specific `configuration`,
`searchCriteria`, `schedule`, and `healthStatus`. Source management and runtime
health are exposed through the backend rather than coupled to provider modules.

## Data Flow

> **Section purpose:** Describe how a user action or schedule becomes persisted
> discovery data and then visible UI state.

1. A user creates or updates a source with provider configuration, search
   criteria, enablement, and scheduling information.
2. Manual execution or the in-app scheduler sends the source to the
   `DiscoveryCoordinator`.
3. The coordinator validates the source and invokes the `DiscoveryEngine` under
   the single-flight execution boundary.
4. The engine calls the provider contract in order: configuration validation,
   search construction, fetch, raw-record validation, and normalization.
5. Repositories persist run accounting, normalized jobs, source provenance,
   observations, lifecycle changes, and diagnostics.
6. The backend returns query results and operational state to the renderer.

Job availability is a retained projection, not deletion or Application state:

1. Each source membership retains current evidence and a lifecycle reason. Only
   complete snapshots count misses, and two consecutive misses are required.
2. Trusted date-only closing evidence expires after the full UTC date; trusted
   exact timestamps expire at the supplied instant. Posting age is never proof.
3. Canonical availability is recomputed from all memberships; any active
   membership keeps the canonical Job current.
4. A bounded offline pass reconciles trusted evidence at startup and on the
   existing scheduler tick, with no network call or second timer owner.
5. Current reads exclude inactive/expired rows; explicit history and detail reads
   retain provenance and Application-linked evidence.

Employer Discovery adds a deterministic operational read path without changing
provider contracts or scheduler ownership:

1. `EmployerDiscoveryIntelligenceService` reads retained CareerSite health and
   fingerprint state, append-only verification/discovery attempts, linked Source
   state, provider/run history, and source-attributed Job memberships.
2. `employer-discovery-intelligence-v1` evaluates that evidence at an explicit
   UTC timestamp. Identical evidence and timestamp produce identical class,
   priority, eligibility, cadence, ordering, and reasons.
3. Safety restrictions are evaluated independently and override priority. A
   retired, broken, backed-off, unsupported, invalid, credential-required,
   disabled, or failed-Source target cannot become executable from a high score.
4. `EmployerDiscoveryService.runEligible()` consumes the ordered eligible IDs;
   the existing `DiscoveryScheduler` remains the only scheduled-execution owner,
   retains its default-off setting, skips startup catch-up, and runs at most 25
   CareerSites through its existing single-flight path. It re-evaluates safety
   immediately before Source execution so a site that becomes blocked while a
   prior site is running is skipped.
5. Metrics are calculated on demand from raw retained evidence. No generalized
   cache, persisted score, provider-specific scheduler branch, or migration was
   introduced.

Policy v1 classes and cadences are: high-priority/recently active (6 hours),
normal (24 hours), stable with known zero recent activity (72 hours), and
degraded (24 hours subject to stronger health/backoff gates). Unsupported,
credential-required, and retired classes have no automatic cadence. The bounded
priority components are activity, ATS confidence, provider recent success,
staleness, and health/failure penalty; ties resolve by next-eligible timestamp,
Employer name, and CareerSite ID.

```
Source Created -> validateConfiguration(config)
                      |
                 search(request, options) -> ProviderSearch
                      |
                 fetch(search) -> ProviderFetchResult
                      |
                 normalize(raw, discoveredAt) -> NormalizedJob
                      |
                 DiscoveryEngine -> repositories -> SQLite
```

The implemented Application Management flow is separate from discovery:

1. Job detail or the dedicated `/applications` and
   `/applications/:applicationId` workflows send validated commands through the
   loopback REST API.
2. `ApplicationService` provides exactly six list, detail, timeline, Applied
   creation, event-union, and summary-note operations. It returns stable bounded
   `400`, `404`, and `409` errors and adds no IPC surface.
3. Applied-only creation and lifecycle, Note, replacement, and Void commands use
   a retry-safe opaque Event ID and canonical payload. Event append,
   `ApplicationRepository.reproject()`, and post-fold Job compatibility complete
   in one SQLite transaction. A Legacy State Imported winner does not auto-map
   to Job status.
4. Summary-note writes update only the Application aggregate and never
   synchronize Job status or append Job history.
5. The existing `JobRepository.changeStatus()` compatibility path remains
   transactional and uses the same canonical Application projection fold.

Milestones 8.2 and 8.3 retain one persistence model beneath both flows:

- Untouched migration `016_application_event_foundation.sql` establishes
  `application_history` as the physical append-only audit ledger and
  `application_effective_events` as the canonical effective-event boundary.
- Migration `017_application_management_indexes.sql` replaces the Application
  list, status, Company, and timeline query indexes with their exact access paths
  and adds copied-context/identity immutability plus user-event
  metadata-definition triggers.
- `applications`, `application_history`, and `application_effective_events`
  remain canonical; no parallel ledger, projection, or command bus was added.
- The UI provides status and Company filters, opaque cursor pagination,
  copied-context detail, mutable summary notes, and a complete
  correction-aware timeline. External Application URLs use the existing
  approved external-link boundary.

Phase 8 Milestones 8.1 through 8.8 are complete and Architect-approved.
ResumeSnapshot material coordination, coordinated backup and restore, Company
identity, outcome analytics, and integrated release certification are
implemented within their approved boundaries.

## Runtime Design

> **Section purpose:** Document startup, data locations, scheduling, diagnostics,
> packaging, and shutdown behavior that shapes the running system.

- Production state lives under Electron's `userData` directory for Job Browser;
  development state uses `data/desktop-dev`.
- Runtime subdirectories separate the SQLite database, resumes, logs, backups,
  diagnostics, and settings.
- Express binds to `127.0.0.1` on an operating-system-assigned port. The desktop
  window loads the loopback origin only after backend health succeeds.
- Database startup delegates schema upgrades and pre-upgrade backup behavior to
  the migration subsystem documented in `DATABASE_V2.md`.
- The current application-managed backup uses SQLite online backup only. It does
  not copy Resume or preference files and has no coordinated restore operation.
- Database startup preserves the main SQLite file and any `-wal`/`-shm`
  sidecars as one database set; startup cleanup does not delete them. SQLite is
  allowed to perform normal recovery. Integrity is verified before migration
  backup or migration, and incoherent or corrupt sets are quarantined with the
  originals preserved.
- Editable CandidateProfile and scoring preferences remain file-authoritative.
  Validated API routes use the shared unified-preference resolver, but startup
  stale-score and post-discovery analysis currently omit that resolver path and
  can load legacy files. Phase 8 must align those entry points; SQLite
  CandidateProfile rows anchor analysis history rather than replacing editable
  authority.
- Discovery schedules run only while the desktop backend owns the scheduler and
  are disabled by default.
- Shutdown stops scheduled work, closes Express and SQLite, and then exits the
  Electron process.
- Packaged providers remain inside `app.asar`; Electron's virtual filesystem
  supports registry enumeration and relative ESM imports without `asarUnpack`.

Operational diagnostics retained from the existing architecture:

1. Logs: `%APPDATA%\Job Browser\logs\job-browser-YYYY-MM-DD.log`
2. Source control-center health: `GET http://127.0.0.1:{port}/api/sources/control-center`
3. Registered providers: `GET http://127.0.0.1:{port}/api/providers`
4. Manual source run: `POST http://127.0.0.1:{port}/api/sources/{sourceId}/run`
5. Browser diagnostics: set `debugMode: true` in source configuration to retain
   the visible browser and diagnostic screenshots.
6. Discovery Intelligence summary:
   `GET http://127.0.0.1:{port}/api/employer-discovery/intelligence`
7. One CareerSite decision:
   `GET http://127.0.0.1:{port}/api/career-sites/{id}/intelligence`

## Component Boundaries

> **Section purpose:** Define communication rules and prohibited coupling
> between components.

- The renderer communicates through the loopback backend and a minimal,
  validated preload bridge; direct filesystem, process, provider, and database
  access is outside its boundary.
- Provider modules implement the shared provider contract and return normalized
  domain records. They do not schedule themselves or write directly to the UI.
- Repositories mediate SQLite access. Persistence schema and migration policy
  remain the responsibility of `DATABASE_V2.md`.
- HTTP-backed providers use the shared bounded transport. Browser-backed
  providers use visible, persistent, provider-isolated profiles only where that
  connector is explicitly supported.

The following existing runtime decisions are retained because they define
provider and packaging boundaries:

- Provider modules and their relative imports stay inside `app.asar` so Node.js
  ESM resolution remains intact.
- Browser cleanup closes both the persistent context and underlying browser so
  profiles are not left locked.
- Browser navigation failures are not silently swallowed; failed navigation
  must not leave login polling on `about:blank`.
- Browser sessions use isolated `profileDir` values to prevent one provider
  from reusing another provider's session.
- LinkedIn's launch uses `--no-proxy-server`, a 45-second navigation timeout, a
  two-second stale-session probe, and a query fallback to
  `search.request.query` before the schema default.
- Provider schemas accept documented nullable fields such as BambooHR's
  `isRemote: null` rather than rejecting otherwise valid records.

## Security

> **Section purpose:** Describe trust boundaries and established controls. This
> section records architecture, not a complete threat model.

- The renderer is sandboxed with context isolation and no Node.js integration.
- The backend listens on loopback only and applies Host, Origin, and request-rate
  protections appropriate to the desktop HTTP boundary.
- The provider HTTP client validates public destinations, pins DNS resolution,
  bounds redirects, time, response size, concurrency, and retry behavior, and
  sanitizes errors.
- Protected provider credentials remain outside SQLite and use Electron
  `safeStorage` where the existing credential flow requires them.
- New windows and permission requests are denied by default; approved external
  HTTP or HTTPS links open through the operating system.
- Browser-backed connectors never solve CAPTCHAs, evade anti-bot systems,
  submit applications, or collect passwords.

Built In is an HTTP connector. Current visible-browser connectors include
LinkedIn, Dice, Wellfound, ZipRecruiter, Handshake, Indeed, and USAJOBS because
their supported flows are dynamic or require user interaction. The provider
registry remains the live inventory. Dice is subject to its published terms and
robots policy and must remain disabled without explicit authorization.

## Extension Points

> **Section purpose:** Identify supported ways to add source-specific behavior
> without changing established component responsibilities.

Providers are auto-discovered through `src/providers/providerRegistry.ts`:

1. `loadProviders()` enumerates the provider directory.
2. Files matching `*.provider.{js,ts}` are dynamically imported.
3. Each module supplies a default provider export.
4. The registry keys the provider instance by `provider.id`.
5. The coordinator and engine consume the shared contract without
   provider-specific branches.

New providers must preserve configuration validation, bounded transport,
deterministic fixture coverage, normalization, provenance, and the security
boundary appropriate to their connector type. A general third-party plug-in
system is only an unscheduled roadmap idea, not an implemented extension API.

### Historical Provider Inventory Snapshot

> **Subsection purpose:** Retain the original v1.0.0-era operational snapshot as
> historical context. It is not a live health dashboard; current source health
> is reported by the running application and later changes belong in the
> changelog.

| Provider        | Type       | Status      | Last Run   | Jobs | Notes                                                                                               |
| --------------- | ---------- | ----------- | ---------- | ---- | --------------------------------------------------------------------------------------------------- |
| Ashby           | ATS        | Healthy     | 2026-07-24 | 26   | Source Mux board                                                                                    |
| BambooHR        | ATS        | Healthy     | 2026-07-25 | 5    | Source Etsy; fixed `isRemote: null` schema bug                                                      |
| Dice            | Job Board  | Needs login | Never      | -    | Headed browser, user must log in                                                                    |
| Greenhouse      | ATS        | Healthy     | 2026-07-24 | 139  | Stripe, Figma, Coinbase boards                                                                      |
| iCIMS           | ATS        | Healthy     | 2026-07-25 | 11   | encyclis portal (hosted v1)                                                                         |
| Lever           | ATS        | Healthy     | 2026-07-25 | 17   | Wealthfront board                                                                                   |
| LinkedIn Jobs   | Job Board  | Healthy     | 2026-07-25 | 7    | Headed browser, 7 jobs imported                                                                     |
| Recruitee       | ATS        | Healthy     | 2026-07-25 | 2    | bunq board                                                                                          |
| Remote OK       | Job Board  | Removed     | -          | -    | Source deleted per user request; provider code removed and legacy sources disabled by migration 014 |
| SmartRecruiters | ATS        | Healthy     | 2026-07-25 | 7    | Bosch board                                                                                         |
| Structured Data | Generic    | Never run   | -          | -    | Needs a URL with JSON-LD (e.g. Stripe careers)                                                      |
| Teamtailor      | ATS        | Never run   | -          | -    | Needs RSS feed URL                                                                                  |
| USAJOBS         | Government | Needs creds | -          | -    | Requires email + API key credentials                                                                |
| Workable        | ATS        | Never run   | -          | -    | Needs company subdomain                                                                             |
| Workday         | ATS        | Healthy     | 2026-07-24 | 69   | NVIDIA, Boeing boards                                                                               |
| Built In        | Job Board  | Never run   | -          | -    | Public HTML/JSON-LD connector                                                                       |
| Wellfound       | Job Board  | Never run   | -          | -    | Visible browser; security checks may require manual action                                          |
| ZipRecruiter    | Job Board  | Never run   | -          | -    | Visible browser; security checks may require manual action                                          |

Handshake was added after this snapshot with a dedicated persistent visible
browser profile and user-managed school, SSO, or MFA login. Release history and
verification status remain in `CHANGELOG.md`.
