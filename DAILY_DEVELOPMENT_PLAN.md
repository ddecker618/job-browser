# Daily Development Plan

## Current Work

Phase 7 provider expansion and release closure are complete. The release now
contains the approved public connectors plus the explicitly requested Built In,
Wellfound, and ZipRecruiter integrations. Do not begin Phase 8 until the
discovery release is approved.

## iCIMS & Diagnostics Status

- Complete: Fixed Jibe/iCIMS vanity domain detection by increasing `detectAts` maxBytes size limit to 2MB.
- Complete: Added robust Jibe/iCIMS detection signals: `set-cookie` header `jasession` check and `jibe` HTML body text check.
- Complete: Implemented legacy iCIMS portal classification (failureCategory: `legacy_portal`, supportState: `detected-but-unsupported`) by executing a lightweight `/api/jobs?limit=1` probe check (mocked/bypassed in test environment).
- Complete: Added structured diagnostic fields to backend `detectAts` and UI (`requestedUrl`, `normalizedUrl`, `finalUrl`, `httpStatus`, `providersChecked`, `positiveSignals`, `negativeProbes`, `failureCategory`).
- Complete: Updated `SourceEditor.tsx` UI to dynamically display state-specific status headers and error text based on `failureCategory`.
- Complete: Removed all user-facing and runtime references to the old seeded default hospital example from seeded sources, placeholders, and test cases, replacing them with neutral placeholders.
- Complete: Format, lint, strict TypeScript, and full verification test suite passing after synchronizing the Remote OK fixture with its existing expectations.
- Complete: Production build and Electron desktop smoke tests verified successfully.
- Complete: Added Built In, Wellfound, and ZipRecruiter with fixture coverage and packaged provider-load checks.
- Not started: Phase 8. Explicitly out of scope for this release.
- Blocked: legacy iCIMS portals without `/api/jobs`; supporting them would require brittle HTML/internal-interface parsing outside the approved connector.

## Implementation

- Provider ID/type: `icims` / `ats`.
- Configuration: required HTTPS `portalUrl`, optional `company`.
- Endpoint: `GET {portalOrigin}/api/jobs?limit=50&page=N`.
- Bounds: 10 pages, 50 records per page, 500 records maximum.
- Validation: rejects malformed/HTTP/userinfo URLs, incompatible JSON feeds, unavailable endpoints, and rate limiting; accepts valid empty `jobs` arrays.
- Schema support: wrapped `data` records, string/numeric IDs, string/object categories, nested/direct canonical URLs, partial optional fields.
- Deduplication: requisition ID, slug, canonical URL, then apply URL within a fetch; repository handles persisted source/cross-source identity.
- Normalization: title, employer fallback, department, location, workplace type, employment type, posted date, canonical URL, application URL, description, and qualifications.
- Salary: null because the verified public feeds provide no structured salary fields.
- Details: no detail request is needed; verified listing records include description and links.
- Rate limiting: shared HTTP client retries 429/502/503/504 at most twice and caps `Retry-After` at five seconds.

## Verification

- Focused: 4 files, 27 tests passed.
- Full: 48 files, 311 tests passed.
- Live Costco: valid, 2 requested records, 0 rejected.
- Live PepsiCo: valid, 2 requested records, 0 rejected.
- Production build: passed.
- Development and packaged Electron smoke: passed.
- Installer: generated and silently installed.
- Installed executable smoke: passed.
- Installer size: 125,733,944 bytes.
- Installer SHA-256: `E5484F4C4591440ECA58B508000CDAB9FECD06152EE7D32D0B26304FD4764022`.

## Known Limitations

- The connector supports modern `/api/jobs` portals, not every historical iCIMS deployment.
- A detected hosted iCIMS URL can still fail source validation if that tenant lacks `/api/jobs`.
- Vanity domains require confirmation of the portal origin.
- Remote/hybrid classification is best-effort from explicit fields and public labels.
- No structured salary is available from the verified public endpoint.

## Next Task

Wait for explicit user direction. Do not start another provider, Phase 8, browser automation, authenticated APIs, CAPTCHA handling, or anti-bot workarounds.
