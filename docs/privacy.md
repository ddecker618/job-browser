# Privacy and Data Rules

The application outcome dataset may eventually become commercially valuable.

However, user privacy takes priority.

## Principles

1. Do not store resume documents when structured attributes are sufficient.
2. Use generated internal user IDs rather than names or email addresses for analytics.
3. Separate personally identifiable account information from analytics data.
4. Never expose one user's application history to another user.
5. Aggregate company statistics only when there is enough data to avoid identifying individuals.
6. Allow users to delete their collected data.
7. Store the minimum information necessary for analysis.
8. Clearly distinguish observed outcomes from predictions.

All notable changes: see `CHANGELOG.md`.

## Transmission

Job Browser is fully offline-first. Nothing you enter or store — jobs,
applications, candidate profile, resumes, or analytics — is ever transmitted
off your machine. There is no telemetry, no crash reporting, and no usage
analytics sent to any third party.

The only outbound network activity is fetching public job listings from
provider feeds (SmartRecruiters, Workday, Lever, USAJobs, Dice, LinkedIn,
Handshake, etc.) during discovery. Those requests send only the normal URL
referrers for the provider pages being fetched and occur only when you run or
validate a source. No stored user data is included in any request.

## Install Distribution Guarantees

1. A fresh install never writes developer personal data to the user-data
   directory. It is a clean slate: empty application tables, generic
   candidate profile, no demo records, employer discovery disabled.
2. An existing install is never destroyed. The database is integrity-checked
   and reopened in place (never replaced); pending migrations run against it;
   the optional pre-migration backup is written only when configured; user
   files (candidate profile, resumes, backups) survive upgrades and
   reinstalls.
3. The packaged installer contains no machine-specific paths or developer
   personal data. `tests/privacy-distribution.test.ts` enforces this on
   tracked files, compiled output, and the packaged `app.asar`.
4. Uninstalling does not delete app data (`deleteAppDataOnUninstall: false`).

## Example

Acceptable:

Applicants with Splunk experience reported a 31% interview rate for this role.

Not acceptable:

John Smith from Chicago applied here and was rejected.
