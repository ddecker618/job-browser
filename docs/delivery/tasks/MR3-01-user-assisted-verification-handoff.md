# MR3-01 — User-assisted verification handoff for browser job sources

**Status:** Backlog — user-prioritized idea; begin after the onboarding/release boundary is safe

**Owner:** Together

**Dependencies:** MR1-06 is Done; complete MR1-07 and coordinate with MR3-PLAN source-reliability gates

**Release state:** Not shipped

## Why this task exists

Job Browser was created to query job sources with less manual repetition. Browser-backed sources can present CAPTCHAs, login walls, or other security checks that correctly require the user to act. The current code detects several challenge pages, opens a visible persistent browser, waits for manual completion, and reports verification-required failures, but the handoff is fragmented and a timeout can force the user to rerun the source from the beginning.

This task makes the supported behavior a first-class product flow: Job Browser pauses the exact source/query when verification is required, clearly asks the user to complete the check in the visible browser, observes or accepts confirmation that the challenge has cleared, and resumes from the saved checkpoint without discarding already collected results.

## Product boundary

This task does **not** automate CAPTCHA solving, obtain third-party solving services, harvest challenge tokens, forge attestations, conceal automation, defeat rate limits, bypass authentication, or evade a site's security controls or policies.

The user completes the challenge. Job Browser coordinates the pause, status, browser focus, session preservation, and safe resume.

## Existing foundation to reuse

- `src/providers/browserJobBoard.ts`
  - `pageHasSecurityChallenge()`
  - `waitForSecurityChallenge()`
  - visible manual Continue banner
- `src/providers/linkedIn/browserSession.ts`
  - visible persistent Playwright browser profile
  - active-session tracking and bounded shutdown
- `src/discovery/discoveryCoordinator.ts`
  - safe login/verification error translation
  - discovery run status and cancellation
- `src/client/pages/SourcesPage.tsx`
  - current running-source status, health messages, and user guidance
- Existing provider-specific login flows for LinkedIn, Dice, Handshake, USAJOBS, Wellfound, ZipRecruiter, and Indeed

## Required behavior

1. Detect a supported login or security-verification wall without attempting to solve it.
2. Transition the active source/query to an explicit `awaiting-user-verification` state.
3. Keep the visible browser session and its persistent profile available to the user.
4. Surface a prominent in-app card containing:
   - provider/source name;
   - bounded explanation;
   - `Open browser` or `Focus browser` action;
   - `I completed the check — resume` action;
   - `Cancel this source` action.
5. Preserve the current provider, query index, location, already collected records, deduplication state, and remaining query budget.
6. Resume the same query after the challenge is actually gone. Do not restart completed queries or duplicate previously collected jobs.
7. If the challenge remains, keep waiting or return a bounded verification-required result; never claim success.
8. Permit a configurable, bounded user-action window appropriate for an interactive desktop flow.
9. Prevent scheduled/background discovery from waiting indefinitely. It may pause with an actionable state and require a foreground manual resume.
10. Persist enough non-sensitive checkpoint metadata to recover after a renderer refresh or ordinary app navigation. Never persist credentials, cookies, CAPTCHA tokens, raw page HTML, or secret-bearing URLs in application data or logs.
11. Continue using official APIs, ATS feeds, and structured public endpoints whenever available; interactive browser handling is the fallback for sources that require it.
12. Preserve source pacing, cancellation, shutdown, privacy, and no-orphan-browser guarantees.

## Suggested architecture

- Add a small versioned `VerificationHandoff` contract owned by discovery, containing safe identifiers and checkpoint state only.
- Add a coordinator/controller that owns one active handoff and supports `status`, `focus`, `resume`, and `cancel`.
- Expose narrow loopback API endpoints for those actions.
- Extend the existing discovery status response rather than creating a second competing run authority.
- Have browser providers report a typed `user-action-required` result rather than relying only on message matching.
- Keep provider extraction resumable through an explicit query checkpoint. Do not serialize Playwright objects.
- Resume only after re-running challenge detection and confirming ordinary result content is available.

## Acceptance tests

- Challenge detection enters `awaiting-user-verification` and never invokes extraction while the challenge remains.
- The Sources UI shows accessible provider-specific guidance and focus/resume/cancel actions.
- Resume after a cleared challenge continues the same query and retains earlier unique records.
- Resume while the challenge remains does not proceed and does not report success.
- Cancel closes only the Job Browser-owned session and records an interrupted source run.
- Renderer reload preserves the safe handoff status.
- Scheduled discovery does not wait indefinitely for unattended user action.
- Duplicate resume clicks cannot start concurrent extraction.
- Shutdown during a handoff leaves no orphan Job Browser/Playwright process.
- Logs and persisted state contain no credentials, cookies, challenge tokens, raw HTML, personal profile data, or secret-bearing URLs.
- Existing login, provider, discovery-deadline, privacy, lifecycle, and packaged desktop tests remain green.

## Implementation order

1. Freeze the typed state and checkpoint contract with unit tests.
2. Add coordinator state transitions and provider adapter behavior.
3. Add loopback API and client status/actions.
4. Add provider integration tests using local fixtures only.
5. Perform an isolated visible-browser acceptance pass with a synthetic challenge fixture.
6. Test one authorized real source manually with the user completing any verification.
7. Build/release only under a separately approved version and installer boundary.

## Guardrails

- No automated CAPTCHA solver or paid solving service.
- No challenge-token interception or replay.
- No fingerprint impersonation or stealth work intended to defeat detection.
- No proxy rotation intended to evade source controls.
- No modification of production job/application state during tests.
- No push, version bump, or installer build without explicit approval.
