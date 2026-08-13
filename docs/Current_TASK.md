# Historical Task: Superseded

> This completed basic Applied-workflow task is retained for history only. Use
> `SESSION_HANDOFF.md` and `IMPLEMENTATION_ROADMAP.md` for current work.

Implement basic application tracking in the existing Job Browser application.

## Objective

Allow a user to mark an existing job listing as "Applied."

When the user marks a job as applied, record:

- existing job identifier
- company
- title
- source
- job URL
- current timestamp
- application status = applied

## Requirements

1. Inspect the existing application architecture before modifying code.
2. Reuse the existing database/storage system if one already exists.
3. Do not introduce a new database unless necessary.
4. Do not modify provider scraping logic.
5. Do not modify job ranking behavior.
6. Do not modify existing job deduplication.
7. Do not remove existing functionality.
8. Add tests for the new behavior.
9. Existing tests must continue passing.

## Scope

Only implement:

Applied status
Application timestamp
Persistence

Do NOT implement:

AI scoring
Interview predictions
Resume analysis
Company analytics
Cross-user analytics
Machine learning

Those belong to later phases.
