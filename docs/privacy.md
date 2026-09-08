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
