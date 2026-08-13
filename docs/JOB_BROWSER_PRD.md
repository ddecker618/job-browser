# Job Browser Product Requirements Document

> **Document responsibility:** Describe the product, its users, its intended
> outcomes, and the boundary between current, planned, and possible future
> capabilities. Technical design and delivery planning belong in the
> architecture, feature specifications, database specification, and roadmap.

## Executive Summary

> **Section purpose:** Provide a short, non-technical summary of Job Browser
> and the value it is intended to deliver.

Job Browser is a desktop job-discovery product that brings listings from
configured employer, ATS, government, structured-data, and job-board sources
into one consistent browsing experience. It is intended to help a job seeker
find and evaluate worthwhile opportunities while retaining control of local
career data. Over time, the product may improve guidance using reliable observed
application outcomes. Any anonymous cross-install evidence requires separate
opt-in privacy and system architecture; it is not implied by local outcome
tracking.

## Product Vision

> **Section purpose:** State the enduring product direction without prescribing
> implementation details or release sequencing.

Job Browser is not intended to become another job board. Its direction is to
become an evidence-driven job discovery platform whose guidance becomes more
useful as reliable outcome evidence becomes available.

## Problem Statement

> **Section purpose:** Define the verified user problems the product addresses.
> A later product documentation pass should expand this section with validated
> user research rather than assumptions.

The existing product direction centers on two documented problems: relevant
jobs are distributed across many sources, and job seekers have limited evidence
for deciding which opportunities are worth their time. The full problem
statement remains to be validated and documented.

## Product Goals

> **Section purpose:** Record durable, outcome-oriented goals already supported
> by the product direction. Detailed requirements belong in feature specs.

- Consolidate approved job sources into a consistent discovery experience.
- Preserve enough source context for users to evaluate and revisit listings.
- Help users search, filter, compare, and prioritize discovered jobs.
- Keep the user's resume and profile information under local control.
- Eventually base guidance on observed historical outcomes whenever reliable
  evidence is available.

## Non-Goals

> **Section purpose:** Make explicit what Job Browser is not intended to do.
> This section should be updated only when a product boundary is approved.

- Operate as an employer job board or replace an employer's application system.
- Submit applications automatically.
- Bypass CAPTCHAs, login controls, security checks, robots policies, or site
  terms.
- Store employer or marketplace passwords.
- Present a chatbot as the product's intelligence strategy.

## Target Users

> **Section purpose:** Identify validated user segments and the job-search
> contexts in which the product serves them. Current documentation establishes
> an individual desktop job seeker as the primary user; further segmentation is
> intentionally deferred.

## User Personas

> **Section purpose:** Capture research-backed personas, needs, constraints, and
> behaviors. No detailed personas have yet been approved, so a future product
> documentation pass should add them without inventing demographic assumptions.

## Product Overview

> **Section purpose:** Explain the product workflow in user terms, without
> architecture, API, or database detail.

Users configure approved job sources, run discovery manually or on an available
schedule, review normalized listings, and use search and ranking tools to focus
their job hunt. The desktop product also provides local resume parsing and
operational controls for source health, diagnostics, and backups. Application
Management now provides a dedicated filtered list, copied-context detail,
summary notes, richer lifecycle actions, correction workflows, and a complete
immutable timeline over the existing Job compatibility flow. ResumeSnapshot
materials and outcome-driven intelligence remain planned capabilities.

## Current Capabilities

> **Section purpose:** Maintain a concise inventory of user-visible behavior
> available in the current product. Release-level detail remains in the
> changelog.

- Multi-source job discovery across supported ATS, public-data, government, and
  visible-browser connectors.
- Manual and in-app scheduled source runs with source health and run history.
- Consistent job normalization, source provenance, search, filtering, and
  deterministic ranking.
- Non-destructive current/inactive Job lifecycle with explicit retained history;
  trustworthy closing evidence and complete source snapshots remove closed Jobs
  from current opportunities without erasing local evidence.
- Local desktop operation with diagnostics and SQLite backup controls.
- Local parsing of supported resume document formats.
- Dedicated local Application Management with Applied confirmation, richer
  lifecycle and Note events, append-only corrections, copied context, and a
  complete timeline.
- Visible browser sessions for connectors that require interactive login or
  dynamically rendered pages, subject to the documented safety boundaries.

## Planned Capabilities

> **Section purpose:** List approved planning areas at product level. Scope,
> sequencing, and acceptance criteria belong in the roadmap and feature specs.

- ResumeSnapshot-backed application materials and coordinated backup/restore.
- Local application-outcome intelligence and evidence-based analytics.
- Expanded resume management and resume intelligence.
- Company intelligence.
- A future evidence-oriented intelligence engine.
- A richer discovery health dashboard.

## Long-Term Vision

> **Section purpose:** Preserve the established outcome-oriented questions that
> motivate the product beyond the currently planned releases.

Job Browser is not intended to become another job board.

Its long-term objective is to become an evidence-driven job discovery platform
that improves recommendations when reliable outcome evidence is available.
Phase 8 evidence remains installation-local. Anonymous cross-install learning is
only a possible future opt-in architecture requiring consent, anonymization,
retention, deletion, security, and bias controls.

The system should eventually answer questions such as:

- Which jobs are worth applying to?
- Which companies respond most frequently?
- Which certifications improve interview rates?
- Which skills appear to increase offer rates?
- Which postings rarely produce interviews?

All recommendations must be based on observed historical data rather than assumptions whenever possible.

## Success Metrics

> **Section purpose:** Define measurable product outcomes, baselines, and review
> periods. Metrics have not yet been approved; a later pass should define them
> from real product usage rather than manufacture targets.

## Risks

> **Section purpose:** Record product-level uncertainties that could prevent the
> product from delivering its intended value. Technical mitigations belong in
> the architecture or relevant feature specification.

- External source availability, policies, and page structures can change.
- Incomplete or inconsistent listing data can reduce search and comparison
  quality.
- Sparse, self-reported, or biased application outcomes can make evidence less
  representative.
- Career documents and outcome histories are sensitive and require clear user
  control.
- Guidance that is not explainable can create false confidence or erode trust.

## Future Vision

> **Section purpose:** Capture validated opportunities beyond the current
> roadmap without turning them into commitments. Future documentation passes
> should promote an item into Planned Capabilities only after product approval.
