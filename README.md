# Job Browser

Job Browser is a local application for discovering, deduplicating, analyzing, and tracking realistic job opportunities. It runs as a Windows desktop application or as a local Node.js/Express dashboard over the same SQLite-backed services.

Discovery supports Greenhouse, Lever, Ashby, Workday, USAJOBS, SmartRecruiters, BambooHR, Recruitee, Teamtailor, Workable, iCIMS/Jibe, Built In, LinkedIn Jobs, Dice, Wellfound, ZipRecruiter, and structured JSON-LD/JSON/RSS/Atom sources. Built In uses bounded public HTTP/HTML and JSON-LD parsing. LinkedIn, Dice, Wellfound, and ZipRecruiter are visible-browser connectors and must never bypass a CAPTCHA, security check, login control, or site policy. There is no automatic application submission or AI-generated application answer workflow.

## Safety Boundaries

- Never submit job applications automatically.
- Never store job-board passwords. USAJOBS API credentials are the only credentials stored by the application and are encrypted by the desktop operating-system vault. Browser connectors use local Chromium profiles only.
- Never bypass CAPTCHAs, security checks, login controls, robots policies, or access controls. Stop a connector when the site requires an unresolved challenge or prohibits the requested method.
- Never make demographic or disclosure decisions.
- Keep future employer connectors isolated and limited to approved public sources.
- Preserve all source URLs and raw source records used for debugging.

## Requirements

- Windows, macOS, or Linux
- Node.js 24 LTS
- npm 11 or later

The project uses `better-sqlite3`, which normally installs a prebuilt native binary. See [Troubleshooting](#troubleshooting) if npm must compile it locally. Building the Windows installer requires Windows x64.

## Setup

Install the exact locked dependencies:

```powershell
npm install
```

Create, migrate, and seed the local database:

```powershell
npm run db:setup
```

The default database is `data/job-browser.sqlite`. Set `JOB_BROWSER_DB_PATH` to use another path.

## Windows Desktop Application

Install with `release/Job-Browser-Setup-1.0.9.exe`. The current-user NSIS installer creates Desktop and Start Menu shortcuts and does not delete application data during uninstall. The unpacked executable is `release/win-unpacked/Job Browser.exe`.

The desktop application:

- Enforces a single running instance.
- Binds its embedded Express server only to `127.0.0.1` on an available random port.
- Applies pending SQLite migrations before loading the dashboard.
- Shows startup progress and a recovery screen with retry, diagnostics, log, and safe-exit actions.
- Opens external HTTP/HTTPS links in the system browser and blocks unsafe navigation.
- Uses an isolated, sandboxed renderer with no Node.js integration.
- Stops the HTTP server and closes SQLite before exiting.
- Runs enabled discovery schedules only while the desktop application is open; scheduling is disabled by default.
- Seeds a small starter source set on desktop startup without overwriting existing sources: Built In is enabled for public discovery, while Wellfound, ZipRecruiter, Dice, and Indeed are preconfigured but disabled because they use visible browser sessions. Login providers such as LinkedIn and Dice remain available through Add source when the user is ready.

Installed data is stored under Electron's per-user `Job Browser` application-data directory, separate from the installation directory. It contains `data/jobs.sqlite`, resumes, settings, logs, diagnostics, and timestamped backups. Development Electron runs use `data/desktop-dev`. The Settings page shows the exact active paths and provides Open Folder, Create Backup, Copy Diagnostics, and Restart actions.

Desktop development and verification:

```powershell
npm run desktop:dev
npm run desktop:smoke
npm run desktop:unpacked
npm run desktop:smoke:packaged
npm run desktop:package
```

The packaging and smoke scripts temporarily install the Electron 42 native `better-sqlite3` binary and restore the Node.js binary afterward.

## Running The Dashboard

Start the local Express API and Vite development server:

```powershell
npm run dev
```

Open `http://localhost:4173`. The server applies pending migrations and the known-application seed before accepting requests.

Create and run a production build:

```powershell
npm run build
npm start
```

The production server serves the route-split Vite bundle from `dist/client`. Set `PORT` to change the default port.

## Dashboard Navigation

| Route        | Purpose                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `/`          | Summary cards, match health, market signals, and recent activity                       |
| `/jobs`      | Instant search, filters, saved views, sorting, pagination, and job details             |
| `/profile`   | Candidate profile and scoring-weight editor with optional rescoring                    |
| `/resumes`   | Resume upload, metadata, default selection, proposals, and resume-based rescoring      |
| `/analytics` | Skills, certifications, employers, scores, recommendations, and timeline charts        |
| `/sources`   | Configure sources, validate them, run discovery, schedule searches, and inspect health |
| `/settings`  | Local paths, scheduler master switch, theme, search defaults, and logging level        |

The dashboard is dark by default, keyboard navigable, responsive, and backed by TanStack Query. Jobs use server-backed pagination, sorting, facets, and optional FTS5 search with an indexed fallback. Job filter state is preserved in the URL and local storage, and named saved filters are stored in SQLite. Normal actions use the API instead of direct database access.

Job workflow changes use the existing audited status repository. Profile rescoring uses the intelligence engine, and all manual, scheduled, fixture, and CLI discovery uses `DiscoveryCoordinator`. The dashboard does not reimplement those rules.

TXT, Markdown, text-based PDF, and DOCX resumes are parsed locally using the configured skill/certification catalog. Scanned/image-only PDFs fail with a clear OCR-not-supported message. No resume content is sent to an external parser or AI service. Database-location setting changes are stored and apply after restart.

## Architecture

The discovery pipeline is:

```text
Search Request
    -> DiscoveryCoordinator single-flight queue
    -> Configured source and provider validation
    -> Provider search and fetch
    -> Provider-independent normalizer
    -> Zod validation
    -> SHA-256 fingerprint
    -> SQLite canonical job and source observation
    -> Application and status-history preservation
    -> Configurable scoring and recommendation persistence
```

Responsibilities are separated by directory:

| Directory        | Responsibility                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| `src/discovery`  | Pipeline orchestration and command entry point                          |
| `src/providers`  | Provider contract, automatic registry, source-specific implementation   |
| `src/normalizer` | Conversion into the shared normalized job schema                        |
| `src/database`   | Discovery-run, provider, and source persistence                         |
| `src/models`     | Provider-neutral application, run, metadata, and request models         |
| `src/utils`      | Fingerprints, fixtures, HTML cleanup, and failure artifacts             |
| `src/fixtures`   | Version-controlled provider responses for offline tests                 |
| `src/server`     | Shared Express application and web/Electron backend lifecycle           |
| `src/desktop`    | Secure Electron lifecycle, paths, startup, preload, and window handling |

`DiscoveryCoordinator` owns source validation, credential injection, run serialization, and health updates. `DiscoveryEngine` knows only the `JobProvider` interface and does not branch on provider IDs. A provider owns its search construction, fetch behavior, raw-data interpretation, and normalization; shared validation and persistence come from `BaseProvider`.

## Provider Architecture

Every provider implements or inherits:

- Stable provider `id` and display `name`.
- `search()` to translate a provider-neutral request.
- `fetch()` to obtain raw records from a fixture or public endpoint.
- `normalize()` to map one provider record into the shared schema.
- `validate()` to enforce the Zod schema.
- `save()` to persist through the canonical repository.

Providers are loaded automatically from files matching `src/providers/*.provider.ts`. To add a provider:

1. Extend `BaseProvider` in a new `yourProvider.provider.ts` file.
2. Implement `id`, `name`, `search`, `fetch`, and `normalize`.
3. Export one provider instance as the module's default export.
4. Add a representative JSON fixture under `src/fixtures`.
5. Add fixture-only normalization and pipeline tests.

No registry, discovery-engine, database, or CLI switch statement needs modification.

Built-in providers:

| Provider        | Source configuration                                    | Network behavior                                        |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Greenhouse      | Board token and optional company name                   | Public Greenhouse job-board API                         |
| Lever           | Site slug and optional company name                     | Public Lever postings API                               |
| Ashby           | Board name and optional company name                    | Public Ashby job-board API                              |
| Workday         | HTTPS origin, tenant, site, and optional company name   | Public Workday CXS endpoint                             |
| USAJOBS         | Optional page size; email and API key stored separately | Official USAJOBS Search API                             |
| Structured data | Public HTTPS feed or careers-page URL                   | Bounded JSON-LD, JSON, RSS, or Atom fetch               |
| SmartRecruiters | Company identifier or `jobs.`/`careers.` careers URL, optional company name | Public SmartRecruiters Posting API                      |
| BambooHR        | BambooHR company subdomain and company name             | Public BambooHR careers endpoints                       |
| Recruitee       | Public careers origin and optional company name         | Public Recruitee careers JSON endpoint                  |
| Teamtailor      | Public jobs RSS URL and company name                    | Public Teamtailor RSS feed                              |
| Workable        | Account subdomain and optional company name             | Public Workable account API                             |
| iCIMS           | Modern careers portal origin and optional company name  | Public iCIMS/Jibe `/api/jobs` endpoint                  |
| Built In        | Search terms and optional location                      | Public HTML cards and JSON-LD detail pages              |
| LinkedIn Jobs   | Search terms, filters, and local browser profile        | Visible Chromium search session                         |
| Dice            | Search terms, filters, and local browser profile        | Visible Chromium search session; authorization required |
| Wellfound       | Search terms, filters, and local browser profile        | Visible Chromium search session                         |
| ZipRecruiter    | Search terms, filters, and local browser profile        | Visible Chromium search session                         |

The Sources editor can inspect a public careers URL and suggest a supported provider configuration. Detection uses hostname patterns, redirect destinations, page metadata, structured links, and bounded non-executing HTML inspection. It never executes scripts. The suggestion is not applied until the user confirms it, and a newly saved source remains disabled until explicitly enabled.

Job Browser recognizes JazzHR, Jobvite, Taleo, Oracle Recruiting Cloud, and SuccessFactors URLs but does not claim connector support for them. These platforms currently lack a sufficiently stable universal unauthenticated endpoint, or commonly require private APIs, sessions, or authentication. When a detected page exposes supported JobPosting structured data, the detector can suggest the structured-data provider instead.

Provider configuration:

- SmartRecruiters: enter the identifier from `jobs.smartrecruiters.com/<identifier>` or `careers.smartrecruiters.com/<identifier>`.
- BambooHR: enter only the company subdomain from `<company>.bamboohr.com`, not a complete hostname.
- Recruitee: enter the HTTPS origin hosting `/api/offers/`. Standard `<company>.recruitee.com` and validated custom careers origins are supported.
- Teamtailor: enter the public RSS feed URL, commonly `<careers-origin>/jobs.rss`. The detector can extract an advertised RSS alternate from a custom Teamtailor careers page.
- Workable: enter the account subdomain from `apply.workable.com/<subdomain>`.
- iCIMS: enter the HTTPS origin of a modern iCIMS/Jibe careers portal exposing `/api/jobs`. Legacy server-rendered iCIMS portals are not supported by this connector.
- Built In: enter search terms and an optional location; public job cards and detail-page JSON-LD are fetched over HTTPS.
- LinkedIn, Dice, Wellfound, and ZipRecruiter: the source editor opens a visible browser for the configured search and keeps it open by default while the session is available. The user must complete any permitted site login or security check manually; passwords are not collected by the application. Uncheck `Keep browser open after search` when the browser should close after the run.

All provider requests use a shared bounded client with mandatory timeouts, caller cancellation, public-address validation, DNS pinning, redirect and response-size limits, content-type checks, low concurrency, and sanitized errors. HTTP 429, 502, 503, and 504 responses receive at most two bounded retries; `Retry-After` is honored up to five seconds. Automated tests always use deterministic fixtures and injected transports rather than external requests.

Provider-specific limits:

- SmartRecruiters reads at most five 100-item pages and fetches details for at most 100 selected jobs.
- iCIMS reads at most ten 50-item pages (500 records) from the public careers feed.
- BambooHR accepts at most 500 board records and fetches details for at most 100 selected jobs.
- Recruitee accepts at most 500 offers from one public careers response.
- Teamtailor accepts at most 500 RSS items and rejects feeds exceeding XML node or depth limits.

Structured-data URLs reject file, loopback, link-local, and private-network targets. Fetches revalidate redirects and DNS results, enforce time and response-size limits, and parse HTML without executing scripts. Generic CSS scraping and browser automation are intentionally unsupported.

USAJOBS credentials are configured from the Sources page in the desktop application. Electron encrypts them with `safeStorage` (Windows DPAPI); they never enter SQLite, source configuration, logs, diagnostics, fixtures, or API responses. Web-only mode can view USAJOBS source state but cannot manage desktop credentials.

Schedules support manual, 6-hour, 12-hour, 24-hour, and daily local-time cadences. The Settings master switch and each source schedule are disabled by default. The scheduler runs sources sequentially only while the desktop app is open, does not catch up missed runs at startup, and does not continue in the background after exit.

## Running Discovery

Run the demonstration provider against its public endpoint:

```powershell
npm run discover
```

This command performs an external request. It uses a 15-second timeout, identifies the local client, and does not log in or bypass access controls.

Run the same pipeline entirely from the committed fixture:

```powershell
npm run discover:test
```

Fixture mode performs no external request. Both commands apply pending migrations, preserve the known application seed, and record a search run.

## Fixture Testing

Deterministic fixtures for every supported provider live in `src/fixtures`. `loadJsonFixture` resolves and parses fixtures with path-aware errors. Provider tests exercise the same search, fetch, normalize, validate, fingerprint, and save path used by live discovery without making external requests.

Do not record credentials, personal data, or unnecessarily large source responses in fixtures.

## Job Intelligence

Run analysis against jobs currently in the local database:

```powershell
npm run analyze
```

Run fixture discovery first and then analyze, without external requests:

```powershell
npm run analyze:test
```

Analysis is deterministic and does not call an AI service. Each job receives category scores, a weighted overall score from 0 to 100, a recommendation, explanations, missing qualifications, extracted skills, and extracted certifications.

### Scoring

`config/scoring-config.json` defines weights totaling 100 for title, skills, certifications, location, remote preference, salary, experience, employment type, and recency. It also defines recommendation thresholds, recency windows, and canonical skill/certification aliases. Changes take effect on the next run without code changes. Invalid totals or threshold order fail validation.

Missing source or profile facts receive documented neutral scores rather than fabricated values. Category scores and the weighted total are persisted for future dashboard use.

### Recommendations

Recommendations are `Apply Immediately`, `Strong Match`, `Possible Match`, `Weak Match`, `Already Applied`, `Expired`, and `Hidden`.

Applied, interview, offer, and rejected states override score with `Already Applied`. Expired/inactive and ignored/excluded-title jobs also use explicit overrides. Analysis never changes workflow status or deletes application history.

### Skill Extraction

The extractor searches title, description, requirements, and preferred qualifications using configured aliases with token boundaries. Canonical skills and certifications are stored separately and linked to jobs. Skill frequency, requesting-employer count, and average score are captured in analytics.

### Analytics

Every analysis run stores snapshots for top skills and certifications, common titles, active employers, average listed salary, average score, jobs discovered today, and canonical jobs with multiple sources. `score_history` receives a row only when a score, category score, or recommendation changes.

## Scripts

| Command                          | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `npm run build`                  | Compile TypeScript into `dist/`                   |
| `npm run dev`                    | Start Express with Vite development middleware    |
| `npm start`                      | Start the compiled production dashboard           |
| `npm run preview`                | Preview the Vite client build                     |
| `npm run typecheck`              | Check strict TypeScript without emitting files    |
| `npm run lint`                   | Run ESLint                                        |
| `npm run format`                 | Format supported files with Prettier              |
| `npm run format:check`           | Check formatting without changing files           |
| `npm test`                       | Run all Vitest tests once                         |
| `npm run test:watch`             | Run Vitest in watch mode                          |
| `npm run db:migrate`             | Apply pending SQL migrations                      |
| `npm run db:seed`                | Apply migrations and seed known applications      |
| `npm run db:setup`               | Set up migrations and known applications          |
| `npm run discover`               | Run discovery against all enabled sources      |
| `npm run discover:test`          | Run discovery using provider fixtures only     |
| `npm run analyze`                | Analyze all jobs currently in the database        |
| `npm run analyze:test`           | Discover fixtures and run analysis offline        |
| `npm run verify`                 | Run format check, lint, typecheck, and tests      |
| `npm run desktop:dev`            | Run Electron against development services         |
| `npm run desktop:start`          | Build and run the desktop application             |
| `npm run desktop:smoke`          | Verify Electron startup, routes, health, and exit |
| `npm run desktop:unpacked`       | Build `release/win-unpacked/Job Browser.exe`      |
| `npm run desktop:smoke:packaged` | Smoke-test the unpacked executable                |
| `npm run desktop:package`        | Build the x64 NSIS installer                      |

## Candidate Configuration

The version-controlled candidate profile is `config/candidate-profile.json`. It contains an ID, preferred locations, radii, remote preference, desired salary, certifications, degrees, skills, clearance eligibility, experience years, desired/excluded titles, and employment types. The loader validates it with Zod and reports the profile path when loading fails.

Future profiles can use the same schema and be loaded by path. Neutral defaults are shipped for fresh installations; user-specific values remain in the local user-data directory. Radius values are configured, but exact distance is not claimed when a job lacks coordinates.

Do not add passwords, protected demographic information, or other secrets to this file.

## Database

The project uses `better-sqlite3` directly without an ORM. Application queries and migration metadata use prepared statements and bound parameters. File-backed databases enable foreign keys, a busy timeout, and WAL mode.

Core tables:

| Table                                    | Purpose                                          |
| ---------------------------------------- | ------------------------------------------------ |
| `schema_migrations`                      | Applied migration versions and checksums         |
| `sources`                                | Employer and source configuration                |
| `source_schedules`, `discovery_settings` | Per-source cadence and scheduler master setting  |
| `runs`                                   | Idempotent run lifecycle and counts              |
| `jobs`                                   | Canonical normalized jobs and current status     |
| `job_sources`                            | Source URLs, external IDs, and raw source JSON   |
| `job_observations`                       | Immutable raw records for every observation      |
| `job_status_history`                     | Immutable audit records for status transitions   |
| `application_history`                    | Application milestones and notes                 |
| `applications`                           | One durable application aggregate per job        |
| `provider_metadata`                      | Provider health and execution metadata           |
| `candidate_profiles`                     | Profile configuration used by analysis           |
| `analysis_runs`                          | Analysis lifecycle and processed-job count       |
| `recommendations`                        | Current scores, explanations, and recommendation |
| `score_history`                          | Changed historical scoring results               |
| `skills`, `job_skills`                   | Canonical skills, job links, and frequency       |
| `certifications`, `job_certifications`   | Requested certifications and links               |
| `analytics`                              | Per-run aggregate metric snapshots               |

Status changes must use `JobRepository.changeStatus`. It updates the job and writes its audit record in one transaction. Application milestones also write `application_history` records.

Incoming duplicate observations never overwrite the canonical workflow status. This protects an `applied` job from being changed back to `new`.

Every discovered job receives a SHA-256 fingerprint derived from normalized company, title, and location. Strong identity resolution prioritizes source/external IDs, canonical posting or application URLs, trusted requisition identity, and non-conflicting fingerprints. Similar titles alone are never merged. Conflicting signals preserve separate jobs and create sanitized diagnostics. `job_sources` keeps every distinct source URL and external identity attached to the canonical job, while `job_observations` preserves each immutable raw record.

Search runs store provider ID, serialized search parameters, execution time, insertion, rediscovery, merge, update, rejection, identity-conflict, truncation, retry, and failure counts. Provider errors are sanitized and do not persist raw response bodies. Structured logs emit the same bounded execution context as JSON.

## Migrations

Migration files live in `src/db/migrations` and use immutable numeric names such as `001_initial_schema.sql`, `002_discovery_engine.sql`, and `003_job_intelligence.sql`.

Phase 7 adds `007_expanded_discovery.sql` for discovery accounting, posting verification and removal, provider confidence, source snapshot state, identity-conflict diagnostics, source archival state, and search indexes. `008_job_search_salary.sql` adds the preserved salary-search index. Migration tests upgrade a populated Phase 6 database and verify existing jobs, sources, statuses, applications, and history remain intact.

The migration runner:

1. Reads migrations in filename order.
2. Calculates a SHA-256 checksum.
3. Applies each pending file in a transaction.
4. Records the version only after success.
5. Rejects changes to an already-applied migration.

Never edit an applied migration. Add a new numbered SQL file instead.

## Seed Data

`npm run db:seed` idempotently records the known Example Employer `Cybersecurity and Network Admin I` application as `applied`. Unknown details such as the original URL, external ID, location, and application date remain unknown rather than being fabricated.

The seed creates both a status-audit record and an application-history event. A later exact company/title observation attaches to this canonical job and retains its applied status.

## Testing

```powershell
npm run verify
```

Tests cover all provider fixtures, source validation and APIs, SSRF controls, credential encryption and redaction, coordinator serialization, scheduling, immutable observations, deduplication, scoring, analytics, migrations, seed idempotency, workflow preservation, desktop lifecycle, backups, navigation policy, UI routes, and local resume formats. Tests do not contact employer sites or any external service.

## Troubleshooting

### better-sqlite3 does not load

Use Node.js 24 LTS and reinstall dependencies from the lockfile. Job Browser pins a `better-sqlite3` release with Node 24 and Electron 42 prebuilt binaries. If a prebuilt binary is unavailable, install Python and the Visual Studio C++ Build Tools with the Desktop development with C++ workload, then reinstall.

The project allowlists install scripts only for `better-sqlite3`, Electron, esbuild, and sharp. Review any warning about another package rather than enabling install scripts globally.

### Discovery fails

Use `npm run discover:test` to distinguish provider/network problems from normalization or persistence problems. Failed runs retain error messages and stack traces. If an applicable response body is available, it is stored under `artifacts/providers/<provider-id>/`; artifacts are ignored by Git.

### SQLite database is locked

Stop any process using the database and ensure scripts close database handles. Antivirus and file-indexing tools can temporarily hold the database or its `-wal` and `-shm` sidecars.

### Paths contain spaces

The code uses Node path APIs and does not assume POSIX separators. Quote explicit paths in PowerShell when setting `JOB_BROWSER_DB_PATH`.

### Reset the local development database

Stop all processes using the database, remove the local `.sqlite`, `.sqlite-wal`, and `.sqlite-shm` files manually, then run `npm run db:setup`. Never reset a database whose application history must be retained without first making a backup.
