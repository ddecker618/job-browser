# Job Browser — Architecture & Provider Status

## Overview

Desktop Electron app that scrapes job listings from multiple ATS (Applicant Tracking Systems) and job boards. Users create "sources" pointing to company career pages or job board searches. Sources run on schedules or manually; discovered jobs are normalized into a unified schema and stored in a local SQLite database.

## Tech Stack

- **Runtime**: Electron 42 (Chromium + Node.js 24) — desktop shell + backend server
- **Backend**: Express on top of Electron's main process. Serves REST API + renders React SPA.
- **Frontend**: React + Mantine UI + React Router, served as static SPA from the Express backend.
- **Database**: SQLite via `better-sqlite3` with migration-based schema.
- **Browser Automation**: Playwright (Chromium) for LinkedIn/Dice login + scraping.
- **HTTP Client**: Custom provider HTTP client with concurrency limiting, retries, redirects, DNS pinning via Cloudflare's public resolver.
- **Build**: TypeScript compiled to ESM. Packaged by electron-builder (NSIS installer + portable dir).
- **Validation**: Zod schemas for all configs, search criteria, and job normalization.

## Architecture

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
│  │  React + Mantine│  │  -> Provider.search()│  │
│  │  WebSocket logs │  │  -> Provider.fetch() │  │
│  └─────────────────┘  │  -> Provider.normalize│  │
│                        └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Provider Discovery

Providers are auto-discovered via `src/providers/providerRegistry.ts`. On startup:

1. `loadProviders()` calls `readdirSync` on the provider directory
2. Finds all `*.provider.{js,ts}` files
3. Dynamically `import()`s each, expects a default export
4. Registers the provider instance in a map keyed by `provider.id`
5. `Electron asar` note: providers live inside `app.asar`. The registry reads them from the asar path — `readdirSync` is intercepted by Electron's asar virtual filesystem. No `asarUnpack` needed.

### Provider Lifecycle

```
Source Created ──> validateConfiguration(config)
                         │
                    search(request, options) ──> returns ProviderSearch (URL + params)
                         │
                    fetch(search) ──> returns ProviderFetchResult (raw records)
                         │
                    normalize(raw, discoveredAt) ──> returns NormalizedJob
                         │
                    DiscoveryEngine inserts into DB
```

### Source Management

Each source has:

- `providerId` — which provider to use
- `configuration` — provider-specific config (board name, URL, etc.)
- `searchCriteria` — query, location, remoteOnly, limit
- `schedule` — daily/weekly/manual cadence
- `healthStatus` — healthy/failed/never-run/credentials-required

Sources are managed through the `/api/sources` CRUD endpoints. The `DiscoveryCoordinator` runs them sequentially, queuing up schedules. A cron-like scheduler fires due sources at their scheduled interval.

## Provider Status (v1.0.0)

| Provider        | Type       | Status         | Last Run   | Jobs | Notes                                                          |
| --------------- | ---------- | -------------- | ---------- | ---- | -------------------------------------------------------------- |
| Ashby           | ATS        | ✅ Healthy     | 2026-07-24 | 26   | Source Mux board                                               |
| BambooHR        | ATS        | ✅ Healthy     | 2026-07-25 | 5    | Source Etsy; fixed `isRemote: null` schema bug                 |
| Dice            | Job Board  | ⚠️ Needs login | Never      | -    | Headed browser, user must log in                               |
| Greenhouse      | ATS        | ✅ Healthy     | 2026-07-24 | 139  | Stripe, Figma, Coinbase boards                                 |
| iCIMS           | ATS        | ✅ Healthy     | 2026-07-25 | 11   | encyclis portal (hosted v1)                                    |
| Lever           | ATS        | ✅ Healthy     | 2026-07-25 | 17   | Wealthfront board                                              |
| LinkedIn Jobs   | Job Board  | ✅ Healthy     | 2026-07-25 | 7    | Headed browser, 7 jobs imported                                |
| Recruitee       | ATS        | ✅ Healthy     | 2026-07-25 | 2    | bunq board                                                     |
| Remote OK       | Job Board  | ❌ Removed     | -          | -    | Source deleted per user request; provider code removed and legacy sources disabled by migration 014 |
| SmartRecruiters | ATS        | ✅ Healthy     | 2026-07-25 | 7    | Bosch board                                                    |
| Structured Data | Generic    | ⚪ Never run   | -          | -    | Needs a URL with JSON-LD (e.g. Stripe careers)                 |
| Teamtailor      | ATS        | ⚪ Never run   | -          | -    | Needs RSS feed URL                                             |
| USAJOBS         | Government | ⚪ Needs creds | -          | -    | Requires email + API key credentials                           |
| Workable        | ATS        | ⚪ Never run   | -          | -    | Needs company subdomain                                        |
| Workday         | ATS        | ✅ Healthy     | 2026-07-24 | 69   | NVIDIA, Boeing boards                                          |
| Built In        | Job Board  | ⚪ Never run   | -          | -    | Public HTML/JSON-LD connector                                  |
| Wellfound       | Job Board  | ⚪ Never run   | -          | -    | Visible browser; security checks may require manual action     |
| ZipRecruiter    | Job Board  | ⚪ Never run   | -          | -    | Visible browser; security checks may require manual action     |

### Fixes Applied

- **Packaged build — provider module resolution**: Removed `dist/src/providers/**/*` from `asarUnpack`. Providers (and their relative imports) stay inside the asar archive where Node.js `import()` resolves dependencies correctly.
- **LinkedIn — browser process cleanup**: `closeBrowserSession()` now calls `persistentContext.close()` + `underlyingBrowser.close()`. `BrowserContext.close()` alone doesn't kill the Chromium process, leaving profile locked.
- **LinkedIn — silent catch on page.goto**: Removed `.catch(() => {})` on `page.goto()` calls. Silent catch left page on `about:blank` while `waitForLogin` polled for 5 minutes.
- **LinkedIn — proxy settings**: Added `--no-proxy-server` Chromium launch arg to bypass corrupted proxy configs in stale profiles.
- **LinkedIn — login timeout**: Increased `page.goto` timeout from 30s → 45s.
- **LinkedIn — stale session check**: Reduced `page.evaluate('1')` timeout from 30s → 2s.
- **LinkedIn — profile isolation**: Added `profileDir` to `BrowserSession`. Prevents LinkedIn from reusing Dice's browser session.
- **LinkedIn — query fallback**: `resolveQueries()` falls back to `search.request.query` before Zod's default `'software engineer'`.
- **BambooHR — nullable isRemote**: Changed `isRemote: z.boolean().optional()` → `z.boolean().nullable().optional()`. BambooHR API sends `"isRemote": null`, which failed all job validations.

### Browser connector boundary

Built In is an HTTP connector. LinkedIn, Dice, Wellfound, and ZipRecruiter use
a visible persistent Chromium profile because their public pages are rendered
or protected dynamically. These connectors do not solve CAPTCHAs, evade
anti-bot systems, submit applications, or store passwords. Dice remains
subject to its published terms and robots policy and should only be used with
explicit authorization; otherwise keep its source disabled.

## How to Debug

1. **Check logs**: `%APPDATA%\Job Browser\logs\job-browser-YYYY-MM-DD.log`
2. **API health**: `GET http://127.0.0.1:{port}/api/sources/control-center`
3. **Provider list**: `GET http://127.0.0.1:{port}/api/providers`
4. **Run a source**: `POST http://127.0.0.1:{port}/api/sources/{sourceId}/run`
5. **Browser automation debug**: Set `debugMode: true` in source config — browser stays open and diagnostic screenshots are saved.

## Technical Roadmap

### Short-term (next 1-2 weeks)

1. **Fix Workable `telecommuting: null` issue** — Same BambooHR bug. `telecommuting: z.boolean().optional()` should be `z.boolean().nullable().optional()`.
2. **Dice login flow** — Test and fix Dice browser automation. Previously timed out on login page.
3. **Structured Data source** — Test with a JSON-LD careers page (Stripe, Google, etc.) to verify extraction works.
4. **USAJOBS credentials UI** — The backend requires email + API key, but the frontend may not have the UI flow for entering credentials.
5. **Packaged app auto-test** — Write script to verify all providers load in a packaged build (no more `ERR_MODULE_NOT_FOUND` regressions).

### Medium-term (next 1-2 months)

6. **Provider timeout handling** — Many "timed out" errors on scheduled runs are transient network issues. Add retry with backoff at the coordinator level, not just the HTTP client level.
7. **Source deduplication UI** — Show which sources contributed each job. Currently jobs can come from multiple overlapping sources.
8. **Job expiry** — Jobs from ATS sources should expire if the source stops listing them. Currently they're never removed. -- this should be a higher priority meaning asap
9. **Source health dashboard** — Visual health of all sources with failure reasons, not just text `healthy`/`failed`.
10. **Better error messages** — Many provider errors are opaque ("request timed out"). Surface more detail (HTTP status, response body preview).

### Long-term (3+ months)

11. **Multiple browser profiles per provider** — Allow LinkedIn and Dice to use different profiles for different accounts.
12. **Proxy support** — For LinkedIn/Dice browser automation through corporate VPNs.
13. **OAuth-based ATS integrations** — For ATS providers that offer OAuth APIs (Greenhouse, Lever, Ashby all have official APIs).
14. **Plug-in provider system** — Allow users to write custom providers without modifying the app code.
15. **Web UI (non-Electron)** — Offer a separate web server mode for headless/remote deployment.
16. **Email notifications** — Alert when new jobs match saved filters.
17. **AI-powered matching** — Rank jobs against a resume using LLM scoring.
