# Universal Employment Coverage Roadmap

**Status:** Approved product requirement; implementation planning required.  
**Commercial significance:** Required before Job Browser can be presented as a
general subscription job-search product.  
**Current boundary:** The application accepts user-defined job titles and can
show all collected listings, but its defaults, occupation taxonomy, matching
assumptions, and validated source coverage remain primarily technology-focused.

## Personal job-search non-interference rule

This roadmap must not disrupt or broaden the owner's active technology job
search. Until the owner explicitly approves a tested rollout:

- do not change the owner's saved desired titles, `sourceQueryRoles`, search
  profile, locations, radii, remote preference, employment preferences,
  sources, schedules, credentials, filters, scoring, or eligibility behavior;
- do not run live discovery or modify the production job database while
  planning, benchmarking, or testing universal coverage;
- do not replace the current technology defaults or silently add non-technology
  queries to an existing profile;
- build and test expansion work with synthetic fixtures, disposable databases,
  and isolated profiles only;
- place any eventual broad-coverage experience behind an explicit user-created
  profile, opt-in mode, or similarly reversible boundary, with the existing
  personal profile remaining unchanged by default;
- require regression evidence that the same personal profile and collected
  data produce the same My matches results before and after an expansion slice;
  and
- do not include expansion source code in the active MR1-07/1.1.6 release.

Documentation and research may proceed without production effects. Any source
implementation, migration, live-source test, installer inclusion, or rollout
requires a separate approved task after the current release boundary.

## Product requirement

Job Browser must evolve from a technology-oriented personal search tool into an
occupation-neutral employment discovery product. A user must be able to start
with a legitimate job title or career direction and receive useful results
whether the target is a quick-service restaurant position, an office role, a
skilled trade, healthcare, education, public service, a United States military
career, or a technology role.

Representative boundary examples include:

- McDonald's crew member, cashier, maintenance worker, and shift manager;
- warehouse associate, delivery driver, retail sales associate, and store
  manager;
- medical assistant, registered nurse, pharmacy technician, and medical
  billing specialist;
- electrician, welder, HVAC technician, mechanic, and construction laborer;
- teacher, paraprofessional, accountant, human-resources specialist, and
  project coordinator;
- United States Army enlisted and officer opportunities, Army civilian jobs,
  federal civilian positions, and defense-contractor roles, represented as
  distinct opportunity types rather than collapsed into one category; and
- the existing software, infrastructure, networking, support, data, and
  cybersecurity roles.

"All titles" is a product coverage objective, not an immediate marketing
claim. Job Browser may claim broad or universal coverage only after a published
benchmark demonstrates it across occupations, locations, opportunity types,
and supported sources. The UI must always distinguish the user's requested
search from the listings the configured sources were actually able to collect.

## Required capability tracks

### UEC-0 — Current-state audit and cross-industry benchmark

1. Inventory every IT-specific default, filter, hard gate, title family,
   seniority rule, skill catalog, source assumption, and UI label.
2. Build a synthetic, privacy-safe benchmark spanning at least:
   quick-service/hourly, retail, logistics, skilled trades, healthcare,
   education, business/finance, public-sector/federal, military, and
   technology roles.
3. Record title-query support, location behavior, freshness, detail quality,
   and failure modes for every provider.
4. Establish baseline recall, precision, duplicate rate, stale-listing rate,
   and unknown/abstention rate by occupation cohort.

### UEC-1 — Versioned occupation and opportunity model

1. Replace the technology-heavy shadow catalog with a versioned,
   occupation-neutral model evaluated against O\*NET-SOC and, where useful,
   ESCO. Record license and redistribution constraints before adoption.
2. Add reviewed aliases, common employer titles, seniority, employment type,
   schedule/shift, apprenticeship, seasonal, internship, and public-service
   concepts without silently broadening ambiguous titles.
3. Model military careers, federal civilian jobs, contractors, and ordinary
   private-sector employment separately. Evaluate an auditable military
   occupation-code crosswalk instead of treating "Army" as an employer-title
   synonym.
4. Preserve raw title, source title, canonical occupation, mapping version,
   evidence, confidence, and explicit unknown/ambiguous outcomes.
5. Keep new mappings in shadow until cohort tests and false-match review pass.

### UEC-2 — Source and query coverage

1. Keep free-form desired titles as first-class user input; never require a
   title to exist in a curated technology list before it can be searched.
2. Add a reviewed related-title expansion preview so the user can approve,
   remove, or edit aliases before discovery runs.
3. Maintain a provider capability matrix for title, keyword, occupation,
   location, radius, remote, schedule, employment type, salary, pagination,
   and freshness support.
4. Expand connectors deliberately across direct employer career sites,
   mainstream ATS platforms, hourly/shift employers, healthcare and education
   systems, state/local/federal sources, USAJOBS where permitted, and official
   military recruiting/career sources.
5. Treat Army enlistment/recruiting opportunities and Army civilian openings
   as different source contracts and user journeys.
6. Use documented APIs and permitted public pages. CAPTCHA or bot/security
   challenges require a visible user-assisted pause-and-resume flow; Job
   Browser must not solve, bypass, harvest, or evade them.
7. Record source provenance, collection time, query used, source limitations,
   and terms/licensing review status for every listing.

### UEC-3 — Occupation-neutral matching and explanations

1. Remove IT-specific assumptions from the generic eligibility and ranking
   path. Put domain rules in versioned, testable profiles when they are truly
   necessary.
2. Support transferable evidence such as customer service, supervision,
   logistics, equipment operation, licenses, certifications, education,
   physical/schedule requirements, military experience, and security
   clearances without forcing them into technology skill categories.
3. Preserve deterministic authority and explicit unknown states. No ontology,
   NLP, or semantic match may invent qualifications or override a verified
   hard requirement.
4. Explain why a listing was retrieved, how its occupation was classified,
   which requirements match, which are missing or unknown, and when the source
   did not expose enough detail.
5. Ensure My matches and All jobs behave truthfully for every cohort. All jobs
   means all listings collected from the user's configured sources, not every
   open job in the market.

### UEC-4 — Coverage measurement and honest product UX

1. Add a coverage report showing requested titles, approved expansions,
   queried sources, successful/failed sources, collected counts, freshness,
   and known blind spots.
2. Provide safe fallback behavior when a title is unknown: search the literal
   user term, display the unknown classification, and invite correction rather
   than substituting a technology role.
3. Test empty, ambiguous, localized, multilingual, acronym, employer-specific,
   military, and adversarial titles.
4. Publish no "all jobs" or "all careers" claim until the cross-industry
   acceptance matrix passes and the claim states its source and geography
   limits.

### UEC-5 — Subscription-readiness gate

Before paid subscriptions or a hosted multi-user service launch:

1. Validate the recurring customer outcome and the minimum source coverage
   users will pay for across more than one occupation cohort.
2. Define accounts, entitlements, billing, cancellation, support, updates,
   retention, deletion, export, incident handling, and service availability.
3. Review source terms, listing redistribution, derived-data rights,
   commercial API costs, privacy, security, accessibility, branding,
   licensing, and trademark risk.
4. Separate local private user data from any hosted operational data and
   obtain explicit consent for every sync or telemetry boundary.
5. Measure discovery cost, provider failure rate, maintenance load, and gross
   margin before setting price tiers.

## Delivery order

1. Complete the active MR1-07 installed-onboarding and 1.1.6 release boundary.
2. Complete the preserved MR3-01 user-assisted source-verification handoff so
   security challenges can be handled by the user without bypass behavior.
3. Run UEC-0 and produce the cross-industry benchmark and provider matrix.
4. Implement UEC-1 and UEC-2 as bounded, recoverable slices with shadow data
   and explicit source contracts.
5. Implement UEC-3 and UEC-4 only after the earlier benchmark identifies
   concrete failures and acceptance thresholds.
6. Treat UEC-5 as a release gate before any paid subscription pilot.

This order protects the current release task while making universal employment
coverage a required product program rather than an optional idea.

## Minimum acceptance boundary

The broad-coverage program is not complete until all of the following are
demonstrated with recorded evidence:

- a new user can enter any non-empty legitimate title without selecting a
  technology family;
- the exact title is queried even when occupation classification abstains;
- reviewed title expansion is user-visible and reversible;
- the benchmark includes every UEC-0 cohort and reports results per cohort;
- at least one direct-employer or authoritative source path is validated for
  each pilot cohort, with limitations shown rather than hidden;
- Army recruiting opportunities, Army civilian roles, federal civilian jobs,
  and contractor roles remain distinguishable;
- generic ranking has no hidden technology-family eligibility dependency;
- failures, blocked sources, and incomplete coverage are visible to the user;
- no security-control bypass, bulk automatic application, fabricated
  qualification, or unsupported coverage claim is introduced; and
- packaged and installed acceptance uses disposable data and preserves the
  established privacy, legal, lifecycle, notification-silencing, and release
  gates.

## Non-goals for the roadmap entry

This document does not authorize a large unbounded rewrite, a hosted service,
billing integration, automatic applications, source-security bypass, or an
immediate production promotion of the P37 shadow classifier. Each delivery
slice still requires a task contract, tests, a recoverable commit, and the
normal release boundary.
