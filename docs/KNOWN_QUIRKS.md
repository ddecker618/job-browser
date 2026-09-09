# Known Quirks

Single index of the intentional behaviors, workarounds, and residual behaviors a
beta user or maintainer may hit. Each entry names the fix or the reason it is
kept, and the automated proof where one exists.

## Browser discovery

1. **Dice discovery can hang past its run deadline; the app force-kills the
   browser.** Root cause was the Playwright-owned browser refusing a graceful
   close (DEF-001). `closeSession` now bounds the graceful close and force-kills
   the browser child process; the discovery engine also force-closes the shared
   session exactly once at the deadline and on abort.
   Proof: `tests/browser-session-close.test.ts`,
   `tests/browser-regression.test.ts`.

2. **Reader (browser) providers need a human in the loop.** Dice, LinkedIn,
   USAJobs, and Handshake open a visible, persistent-profile Chromium window.
   Logging in and completing security challenges are done by the user; the app
   shows a `jb-login-overlay` while waiting and reports the reason in run
   history and source health. Verification/login walls are classified and reuse
   the `credentials-required` status (decision D-006); browser-session sources
   are never auto-disabled (report-only).

3. **Anti-bot pacing sleeps are kept after opening a job detail page.** A short
   randomized pause (1000-2000 ms, provider-dependent) between detail visits is
   deliberate (decision D-007). It is why large browser runs take a while.

4. **Page navigation waits only for `domcontentloaded`, never `load` or
   `networkidle`.** Content that arrives later is detected by polling known
   selectors via `waitForContent` / `waitForCardCount`, each with a bounded
   timeout. A waiter timeout means "content did not appear" and is treated as
   absent, not as a failure.

5. **A transient navigation failure is retried twice with a 2 s backoff.**
   `navigateWithRetry` re-attempts `page.goto` and, after the final attempt,
   throws a message naming the URL and the number of attempts.
   Proof: `tests/browser-regression.test.ts`.

6. **A run that reaches 0 results or a partial page is not a failure.** Empty
   boards produce an empty notice on success; filters that matched nothing do
   not complete a snapshot; only genuinely broken fetches count against health.

## Scheduling and runs

7. **Aborts are recorded as `interrupted`, never as failures.** Stopping the app
   mid-run interrupts the active provider and records an `interrupted` run with
   preserved data and references (migration `015_interrupted_run_status.sql`).

8. **Scheduled cadence advances only after a successful run.** A failed or
   interrupted surface run does not shift the next scheduled time.
   Proof: `tests/discovery-coordinator.test.ts`, `tests/discovery-scheduler.test.ts`.

9. **Runs are serialized.** Concurrent discovery requests enqueue instead of
   overlapping; cross-source parallelization is deferred (decision D-008).

10. **Startup used to hang on large databases** while migration
    `015_interrupted_run_status.sql` rescanned `job_observations`; temporary
    indexes cut it from ~18 s to ~1.4 s. No longer reproduces.

11. **USAJobs `login.gov` occasionally rejects known devices.** This is
    site-side authentication behavior, not automatically a connector defect; it
    surfaces as a login/verification wall, not a source failure.

## Search

12. **Search prefers FTS5 and falls back automatically to an indexed mode** when
    FTS is unavailable or disabled, so the same queries still work.
    Proof: `tests/` FTS fallback coverage.

## Desktop, packaging, and distribution

13. **One instance per machine.** The desktop app enforces a single-instance lock
    (`requestSingleInstanceLock`).

14. **Uninstalling does not delete app data.** The installer sets
    `deleteAppDataOnUninstall: false`; candidate profile, resumes, backups, and
    the database survive uninstall/reinstall.

15. **Node is pinned to `>=24 <25`.** Engines are enforced at install; other
    Node majors are unsupported.

16. **HTTP/SQL providers do not use generic scraping.** Structured-data sources
    (SmartRecruiters, Workday, Lever, and the rest) reject file, loopback,
    link-local, and private-network targets and parse HTML without executing
    scripts. Only the four reader providers automate a browser.

## Privacy

17. **Nothing leaves the machine except discovery fetches.** There is no
    telemetry or crash reporting; provider requests carry only the URL for the
    page being fetched. `npm run privacy:check` scans the distribution, tracked
    files, and the packaged `app.asar` for personal-data markers.
    See `docs/privacy.md`.
