# Discovery Engine PRD

## 1. Vision
- Purpose
- Philosophy
- Product Goals
- Success Metrics

## 2. Scope
- Goals
- Non-Goals
- Milestone Boundaries

## 3. Discovery Architecture
- High-Level Architecture
- Data Flow
- Components
- Subsystems

## 4. Conceptual Data Model
Employer
CareerSite
ATS
DiscoverySource
DiscoverySignal
Evidence
Fingerprint
Verification
Health
ScanSchedule
DiscoveryRun
Alias
Industry
Location
Brand

For each:
- Purpose
- Lifecycle
- Relationships
- Ownership
- Invariants

## 5. Discovery Pipeline

Seed
↓

Discover
↓

Normalize
↓

Fingerprint
↓

Verify
↓

Classify
↓

Register
↓

Schedule
↓

Monitor
↓

Repair

Document every stage.

## 6. Seed Sources

Manual
Import
Government
Fortune
Universities
Hospitals
LinkedIn Companies
GitHub Organizations
Crunchbase
OpenCorporates

## 7. Discovery Methods

Manual
Passive
Active
Provider-derived
Search-derived
Referral

## 8. ATS Fingerprinting

One section for every ATS.

Greenhouse
Workday
Ashby
Lever
BambooHR
iCIMS
SmartRecruiters
Teamtailor
Oracle
SAP
UKG
etc.

Each includes:

Detection
Normalization
Confidence
Failure Modes
Repair Strategy

## 9. Confidence Model

Confidence Scores

Employer
Career Page
ATS
Discovery
Verification
Health

How confidence changes.

## 10. Evidence Model

Every decision stores evidence.

Examples:

Employer identity

Career URL

ATS

Company merge

Verification

Health

Nothing should be magic.

## 11. Company Registry

Everything stored about an employer.

## 12. Duplicate Resolution

Aliases

Parent companies

Subsidiaries

Merged organizations

Acquisitions

## 13. Scan Scheduling

Priority

Frequency

Failure backoff

Retry policy

Maximum concurrency

## 14. Health Monitoring

Healthy

Warning

Broken

Retired

Unknown

Transition rules.

## 15. Automatic Repair

ATS changes

Career URL changes

Redirects

Dead links

Provider failures

## 16. Discovery Intelligence

Future AI

Hiring trends

Employer confidence

Discovery recommendations

## 17. APIs

Registry API

Discovery API

Scheduling API

Verification API

Administration API

## 18. UI

Discovery Dashboard

Company Registry

Verification Queue

Health Dashboard

Discovery History

## 19. Metrics

Companies

Verified

Broken

New

Discovery Rate

ATS Distribution

## 20. Security

Rate limiting

Robots.txt

User-Agent

Caching

Audit logs

## 21. Roadmap

Discovery 1

Discovery 2

Discovery 3

Discovery Intelligence