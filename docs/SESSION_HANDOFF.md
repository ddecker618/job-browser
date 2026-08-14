# Session Handoff

## Current Phase

Phase 8, Employer Discovery, Manual Lifecycle, and Structured Role Details v1.0.15 are complete and Architect-approved. Version is `1.0.15`. Migration head is `028`.

## Current Implementation Checkpoint (2026-08-14 — Structured Role Details Sprint v1.0.15)

### Core Architecture & Extraction Rules
- **Deterministic Regex/Rules Engine**: `src/intelligence/roleDetailsExtractor.ts` extracts canonical `RoleDetails` (`role-details-v1`) without AI/LLM/NLP.
- **Precedence Hierarchy**: Structured Provider data > Labeled description sections > Deterministic regex/rules > Unknown.
- **Persisted Contract**: Stored in `jobs.role_details_json` (added via migration `028_role_details.sql`). Original description prose remains untouched.
- **Separation of Dimensions**: Employment type (`full-time`, `part-time`, `contract`, `temporary`, `internship`, `unknown`) with source (`provider` | `description` | `unknown`) and evidence is strictly separated from Work arrangement.

### Provider Integration & Audit
- **USAJOBS**: `detailText` (duties/qualifications/conditions) correctly retained into `requirements`.
- **Greenhouse**: Removed fabricated `full-time` fallback; explicit metadata retained.
- **SmartRecruiters**: `workplaceType` (`REMOTE`, `HYBRID`, `ONSITE`) mapped correctly.
- **Dice**: `temporary` and `internship` employment types mapped.

### Backfill & Migration 028
- Bounded offline backfill (`backfillRoleDetails`, batch size 200, skips current version, skips user-removed/expired/inactive jobs).
- Migration runner idempotency and schema-parse safety fully verified.

### Scoring & Eligibility Integration
- Strict alignment with existing hard gates: far non-remote onsite jobs fail, ambiguous work arrangements cannot bypass commute gates, confirmed remote bypasses distance, active clearance blocks when lacking, obtainable/eligible clearance remain non-blocking, professional engineering / 0854 remains blocking, user-removed jobs remain excluded.

### UI & Verification
- Job Detail panel displays the structured Role Details section with clean key-value rows and evidence support.
- Full test suite: 92 test files, 869 tests passing (including 154 role-details extractor and integration tests).
- Desktop smoke, packaged smoke, and installed smoke passed successfully.
- Rebuilt installer: `release/Job-Browser-Setup-1.0.15.exe` (249,874,434 bytes, SHA-256: `505C91D3B13D826B7A74015E881FACB7ECB6D85396DE274B93B022B371BC425F`).

## Recommended Next Sprint
- **Next Sprint**: Advanced Discovery Analytics & Alerting Rules.
