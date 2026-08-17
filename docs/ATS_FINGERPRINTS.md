# ATS Fingerprinting

## What this document covers

This document records how Job Browser identifies the applicant tracking system
(ATS) powering an employer career site. The fingerprinting used by the manifest
import path is **URL-only and deterministic**: it never makes a network request.
Network-fetched HTML fingerprinting lives in `src/domain/atsDetector.ts` and is
out of scope here.

## URL fingerprinting

`detectCareerSiteProvider(url)` in `src/domain/atsFingerprint.ts` inspects the
URL host and path and returns a `{ providerId, configuration, platform }` signal
when the host is a known ATS board:

| Provider        | Signal            | Host(s)                                            | Tenant field                                     |
| --------------- | ----------------- | -------------------------------------------------- | ------------------------------------------------ |
| Greenhouse      | `greenhouse`      | `boards.greenhouse.io`, `job-boards.greenhouse.io` | `boardToken` (path or `board_token`/`for` param) |
| Lever           | `lever`           | `jobs.lever.co`                                    | `site`                                           |
| Ashby           | `ashby`           | `jobs.ashbyhq.com`                                 | `boardName`                                      |
| Workday         | `workday`         | `myworkdayjobs.com` (+ other hosts)                | `tenant`, `site`                                 |
| SmartRecruiters | `smartrecruiters` | `jobs.smartrecruiters.com`                         | `companyIdentifier`                              |
| BambooHR        | `bamboohr`        | `{company}.bamboohr.com`                           | `companyDomain`                                  |
| Recruitee       | `recruitee`       | `{company}.recruitee.com`                          | `company`                                        |
| Teamtailor      | `teamtailor`      | `{company}.teamtailor.com`                         | `company`                                        |
| Workable        | `workable`        | `apply.workable.com`                               | `subdomain`                                      |
| iCIMS           | `icims`           | `careers.icims.com` (+ related hosts)              | `company`                                        |

Every `.myworkdayjobs.com` host is fingerprinted uniformly as the `workday`
provider with `{origin, tenant, site}` configuration derived from the hostname
and path — including CrowdStrike's tenant (`crowdstrike.wd5.myworkdayjobs.com`),
which previously had a dedicated `crowdstrike` provider branch. The ATS detector
(`src/domain/atsDetector.ts`) has no CrowdStrike special-case, so this unifies
fingerprint and detector behavior. The `crowdstrike` provider remains a valid,
registered provider for manually configured/managed Sources and is used when a
Source is explicitly attached to the CrowdStrike Workday tenant.

Unknown or generic hosts return `null`; the site is recorded as `unsupported`
and no Source is created.

## Canonical identities

`src/domain/urlIdentity.ts` provides the deterministic identities used to dedupe
across manifests and existing registry rows:

- `normalizeUrlIdentity` — lowercased host, `www.` stripped only when a second
  level label remains, fragments/default ports/known tracking parameters removed,
  remaining query parameters preserved and sorted, repeated slashes collapsed,
  trailing slash trimmed.
- `normalizeDomainIdentity` — host-only identity used for exact employer domain
  matching.
- `canonicalConfigJson` — recursively key-sorted JSON so two provider
  configurations with different key orders compare equal.
- `atsTenantIdentity` — `provider:tenant` (e.g. `greenhouse:acme`,
  `workday:acme:ext`) so the same ATS board is recognized even when the submitted
  URL differs.

## Evidence

Fingerprints persist a stable identity and per-rule evidence (`hostname`,
`board_token`, etc.) with confidence and observed-at timestamps. The manifest
import path additionally records its own evidence kinds
(`manifest-provenance`, `manifest-batch`, `manifest-notes`,
`manifest-expected-ats`, `manifest-expected-tenant`, `manifest-submitted-url`)
and writes them **after** verification, because verification recomputes the
fingerprint and wipes prior `career_site_evidence` rows.
