# AI Studio integration handoff

## Current source boundary

This reconciliation preserves both histories: local P38 through `0363659` and
GitHub web-runtime setup through `0857dd0`. P38 current-resume comparison and safe
local port allocation are included. Version remains 1.1.9; no new desktop
installer is implied. The original desktop checkout and production data are
untouched. The uncommitted local onboarding-contract test deletion is excluded.

The lockfile and Node 24 version hint are restored to retain reproducible installs.
The dependency versions are unchanged; the lockfile root engine range matches
package.json. SESSION_HANDOFF.md is retained despite its ignore rule.

## Run and verify in AI Studio

1. Pull this updated GitHub revision into the existing app, reviewing any AI
   Studio-only edits rather than overwriting them blindly.
2. Use the full-stack Node runtime and the existing Express backend. Run
   `npm ci`, then `npm run dev` for development. For production use
   `npm run build`, then `NODE_ENV=production npm start`.
3. Honor the platform PORT and bind the web runtime to 0.0.0.0. The server already
   accepts HOST and PORT. Do not launch Electron or replace the backend with
   a static-only Vite preview.
4. Verify better-sqlite3 installs for the actual runtime. Node 24 is the local
   reference; the cloud branch widened engines to Node 22–24 without evidence
   that all supported versions have been tested.
5. Start with disposable data and sanitized configuration. Never upload the
   owner's desktop database, resumes, browser profiles, cookies, or secrets as
   part of repository synchronization.
6. Verify page load, API health, onboarding, job browsing and the P38 preview
   using a sample resume and sample jobs. Check the platform console for actual
   startup errors before making additional compatibility changes.

## Remaining cloud boundaries

- SQLite, resumes, snapshots, preferences and backups currently use container-local
  paths. They need a deliberate durable-storage design before real cloud use;
  this reconciliation does not implement one.
- Several discovery providers use visible Chrome and persistent local login
  profiles. They will not inherit the desktop's browser sessions. Validate each
  cloud-compatible provider separately and label unsupported ones honestly.
- The web entry point does not enable the discovery scheduler or inject the
  desktop credential resolver. Successful startup is not proof of unattended
  discovery or credential-backed providers working.
- The existing cloud patch admits run.app hosts/origins, trusts one proxy hop,
  suppresses several rate-limit proxy validation messages and allows all Vite
  hosts. These are retained existing changes, not a security review approval.
  Before public deployment, enforce exact trusted hosts/origins, validate proxy
  assumptions, and add authentication and per-user data isolation. Host filtering
  alone is not authentication. Keep the desktop loopback boundary intact.
- Tracked candidate/scoring configuration is demo/default input, not the owner's
  private configuration. Do not overwrite desktop personal settings when bringing
  cloud changes back locally.

The private AI Studio project itself could not be inspected because the available
browser required Google sign-in. No claim is made that its current preview runs.

Official references:

- https://ai.google.dev/gemini-api/docs/aistudio-build-mode
- https://ai.google.dev/gemini-api/docs/aistudio-fullstack

## Reconciliation validation

On 2026-10-04, the combined checkout passed type checking, lint, formatting,
legal-notice generation/check, and the production frontend build. Focused tests
passed in 10 files: 120 passed, 1 skipped (P38, safe ports, backend lifecycle,
onboarding contract, privacy, and NLP packaging). The build and tests used the
native config loader because the sandbox blocked the default config bundler's
parent-directory scan. No full-suite rerun, installer build, live discovery,
production-data access, or AI Studio deployment was performed.
