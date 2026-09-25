# MR1-05 — Preview bounded search/source plan

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md).
**Dependencies:** MR0-01, MR1-01, MR1-02, MR1-03, MR1-04
**Implementation owner:** OpenCode
**Reviewer:** Codex
**Expected size:** one focused session (this task)

## Status

- **Implementation complete** — claimed by OpenCode 2026-09-24
  (after Codex accepted MR1-04).
- **Accepted by the Codex reviewer on 2026-09-24** — independent
  TypeScript validation PASS, 5-file onboarding focused suite
  **164/164 PASS** (`tests/onboarding-contract.test.ts` + preferences
  - review + progress-storage + search-plan), explicit
    applied/omitted query separation, safe generic failed-source reason,
    detached `preferredLocations` snapshot, truthful plan-specific
    copy.
- **Done** as of 2026-09-24; claimed files released back to the
  unclaimed bucket.

## Outcome

After confirming onboarding preferences and review facts, the user can
inspect a clear preview showing:

- which queries will run;
- which confirmed titles are omitted by the per-run query limit;
- the relevant location / remote / distance constraints;
- which existing configured sources are ready;
- which sources need attention or are excluded, and why;
- the bounded query and source totals;
- that no search runs until the user explicitly confirms the plan.

The confirmation callback may express intent, but it must not execute
discovery. This slice is preview-only.

## Reuse existing authorities

- `ConfiguredSource`, `ProviderDescriptor`, `CredentialStatus`,
  `ProviderCapabilities`, `ProviderConfiguration` from
  `src/models/source-management.ts`.
- `SearchProfile.maxQueriesPerRun` from `src/config/search-profile.ts`.
- `OnboardingValidatedPreferences` from `src/models/onboarding.ts`.
- `SourceRepository` / `DiscoveryCoordinator` semantics are
  reference behaviour only — they are **not** called from this task.
- Provider capability and credential state are taken from existing
  descriptor fields; no new provider model is invented.
- Onboarding component conventions (`onBack`, `onContinue`,
  `saving`, `saveError`) and the feature-scoped `onboarding.css` are
  reused.

No second source registry, discovery coordinator, scheduler, provider
model, search-profile format, or scoring system is introduced.

## Plan contract

The plan contract is added to `src/models/onboarding.ts`. It is
versioned (`ONBOARDING_SEARCH_PLAN_VERSION = 1`) and JSON-stable.

```ts
export const ONBOARDING_SEARCH_PLAN_VERSION = 1 as const;

export interface OnboardingSearchPlanSourceEntry {
  /** Stable source identity (ConfiguredSource.id). */
  readonly id: string;
  /** Stable display label (ConfiguredSource.displayName ?? employer). */
  readonly displayName: string;
  /** ConfiguredSource.employer. */
  readonly employer: string;
  /** ConfiguredSource.providerId (may be null). */
  readonly providerId: string | null;
  readonly   state: 'ready' \| 'needs-attention' \| 'excluded';
  /** Bounded user-facing reason for non-ready entries. null when ready. */
  readonly reason: string | null;
}

export interface OnboardingSearchPlan {
  readonly version: typeof ONBOARDING_SEARCH_PLAN_VERSION;
  /** User-supplied desired job titles, trimmed, non-empty, in user order. */
  readonly confirmedTitles: readonly string[];
  /** Bounded query list (≤ SearchProfile.maxQueriesPerRun). */
  readonly appliedQueries: readonly string[];
  /** Confirmed titles that did not fit the bound (informational). */
  readonly omittedTitles: readonly string[];
  readonly preferredLocations: OnboardingValidatedPreferences['preferredLocations'];
  readonly remotePreference: OnboardingValidatedPreferences['remotePreference'];
  readonly primaryRadiusMiles: number;
  readonly secondaryRadiusMiles: number;
  readonly sources: readonly OnboardingSearchPlanSourceEntry[];
  readonly totalSourceCount: number;
  readonly readySourceCount: number;
  readonly needsAttentionSourceCount: number;
  readonly excludedSourceCount: number;
  /** Bounded user-facing warnings (e.g. omitted titles, credentials). */
  readonly warnings: readonly string[];
  /** False when appliedQueries is empty or readySourceCount is 0. */
  readonly confirmationAllowed: boolean;
}
```

## Files owned by this task

| File                                                  | Existing/new | Intended change                                                                                                                                |
| ----------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/models/onboarding.ts`                            | existing     | Add `ONBOARDING_SEARCH_PLAN_VERSION`, `OnboardingSearchPlanSourceEntry`, `OnboardingSearchPlan` types (no behaviour change to existing types). |
| `src/onboarding/search-plan-service.ts`               | new          | Pure deterministic `buildOnboardingSearchPlan(input)` plus typed `BuildOnboardingSearchPlanInput`.                                             |
| `src/client/components/onboarding/SearchPlanStep.tsx` | new          | Pure, parent-controlled preview component.                                                                                                     |
| `src/client/styles/onboarding.css`                    | existing     | Add `onboarding-search-plan-*` classes only.                                                                                                   |
| `src/client/fixtures/onboarding.fixture.ts`           | existing     | Add fictional `fictionalSearchPlan*` fixtures.                                                                                                 |
| `tests/onboarding-search-plan.test.tsx`               | new          | Pure-service unit tests + component behaviour tests.                                                                                           |
| `docs/delivery/tasks/MR1-05-search-plan.md`           | new          | This task card.                                                                                                                                |
| `SESSION_HANDOFF.md`                                  | existing     | Status pointer for the new active task.                                                                                                        |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`                  | existing     | Move MR1-05 row to **In progress** (claimed by OpenCode); session-log row appended.                                                            |

## Shared files — integration owner only

None. The plan slice is consumed by the future parent wizard (MR1-06).
This task adds no route, no API call, no `App.tsx` change, no
`SourceRepository` mutation, no discovery execution, no provider
launch, no production database access, no migration, and no new
dependency.

## Contract details

### Source classification (pure, based on existing fields)

The plan service classifies each `ConfiguredSource` as:

- **ready** when:
  - `archivedAt` is null or empty,
  - `enabled === true`,
  - `providerId !== null` (a provider reference exists),
  - the provider reference exists in `providerDescriptors` and is
    `supported` or `supported-with-configuration`,
  - `configurationStatus === 'valid'`,
  - the provider does not require unavailable credentials
    (`providerDescriptor.capabilities.requiresCredentials` ⇒
    `providerDescriptor.credentialStatus.available === true`),
  - `healthStatus` is `healthy` or `never-run` (never-run is honest —
    "ready to try", not "currently passing"). Health states `failed`
    and `credentials-required` cannot be ready.

- **needs-attention** when the source is enabled and has a valid
  configuration but cannot run yet (e.g. credentials required and not
  available; last source check failed). The reason is a bounded,
  user-facing phrase. Raw `healthMessage`, `lastFailure`, `careersUrl`,
  credentials, exception details, stack traces, local paths, and
  secret-bearing URLs are never exposed through the onboarding plan.

- **excluded** when:
  - `archivedAt` is set (`reason: 'Source is archived'`),
  - `enabled === false` (`reason: 'Source is disabled'`),
  - `providerId === null` (`reason: 'No provider configured'`),
  - the provider reference is missing from `providerDescriptors` or is
    not in a supported state (`reason: 'Provider is not available'`),
  - `configurationStatus` is `unvalidated` or `invalid`
    (`reason: 'Configuration not validated'` /
    `'Configuration is invalid'`).

### Bounded reasons

`reason` strings are derived from existing fields and are bounded
(≤ 240 chars, no `Error.message` chains, no stack traces, no
`configuration_json`, no `careersUrl` secrets). The plan never
exposes credentials, raw exceptions, internal status strings, or
URLs that may carry secrets.

### Query bounding

The plan builds the query list from the user-confirmed desired job
titles:

1. Trim whitespace; drop empty entries.
2. Deduplicate case-insensitively while preserving the first
   user-visible spelling.
3. Preserve deterministic user order (no resort).
4. Bound the resulting list by `SearchProfile.maxQueriesPerRun`.
5. Record the over-the-bound titles in `omittedTitles` and add a
   bounded `warnings` entry such as
   `Some confirmed titles were not included because the search plan
was capped at N queries.`.

MR1-05 does **not** invent extra roles, synonyms, occupation
families, NLP-derived titles, or job-type taxonomy expansions. The
P37 job-type taxonomy stays SHADOW Level 0 and does not affect the
plan. No scoring, eligibility, ranking, or filtering authority is
changed.

### Confirmation gating

`confirmationAllowed` is `false` when:

- `appliedQueries.length === 0`, or
- `readySourceCount === 0`.

When `false`, the component disables the Confirm button and surfaces a
brief reason in plain language.

### Determinism

The plan service:

- sorts sources by `(displayName || employer).localeCompare(...)`,
  then by `id.localeCompare(...)` so equal inputs always produce equal
  output,
- preserves user query order after dedupe,
- never mutates any input array or object (verified by `deepFreeze`
  tests).

## Search-plan service

Create `src/onboarding/search-plan-service.ts` exporting:

```ts
export interface BuildOnboardingSearchPlanInput {
  readonly preferences: OnboardingValidatedPreferences;
  readonly confirmedTitles: readonly string[];
  readonly searchProfile: Pick<SearchProfile, 'maxQueriesPerRun'>;
  readonly sources: readonly ConfiguredSource[];
  readonly providerDescriptors: readonly ProviderDescriptor[];
}

export function buildOnboardingSearchPlan(
  input: BuildOnboardingSearchPlanInput,
): OnboardingSearchPlan;
```

The service is pure:

- no SQLite access;
- no filesystem access;
- no provider / browser calls;
- no health checks;
- no credentials retrieval;
- no discovery execution;
- no network access;
- no mutation of any input (objects or arrays).

The service does **not** silently enable, repair, validate, or
reconfigure a source.

## Search-plan component

Create `src/client/components/onboarding/SearchPlanStep.tsx`:

```ts
export interface SearchPlanStepProps {
  readonly plan: OnboardingSearchPlan;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}
```

The component must:

- show `appliedQueries` as the executable query list;
- show `omittedTitles` as a separate, clearly labeled list explaining
  that those confirmed titles exceeded the configured per-run query
  limit;
- show location, distance and remote constraints in plain language;
- list ready sources separately from needs-attention and excluded
  sources, with each non-ready entry's `reason` displayed verbatim;
- show query and source bounds (counts and the omission warning);
- state clearly that no search has run;
- explain that Back returns to job preferences and that sources needing
  attention must be fixed from the Sources workspace;
- provide `Back` and `Confirm plan` callbacks (`type="button"` /
  native form submit);
- prevent duplicate confirmation while pending (saving state disables
  Confirm; the same submit cannot enqueue twice);
- disable confirmation when the plan is not confirmable
  (`!plan.confirmationAllowed`);
- show an accessible confirmation error (`role="alert"`) without
  erasing the plan;
- use semantic headings, lists, labels, status / alert roles, and
  keyboard-operable buttons (`type="button"`, visible focus);

The component must **not**:

- call the API or SQLite;
- invoke `DiscoveryCoordinator` or any provider;
- enable or edit sources;
- navigate by itself;
- claim internet-wide coverage;
- claim every enabled source will succeed;
- promise jobs will be found.

## Scoped styles

Update only `src/client/styles/onboarding.css` with new
`onboarding-search-plan-*` classes. No changes to existing
`PreferencesStep` / `ReviewStep` styling. Responsive to narrow
windows and 200% zoom (no claim of visual verification — see
"Checks not run").

## Fixtures

Extend `src/client/fixtures/onboarding.fixture.ts` with clearly
fictional data:

- `fictionalSearchPlanSourceEntries` (mixed ready / needs-attention /
  excluded, including a credentials-required entry).
- `fictionalSearchPlanReady` (all sources ready, queries fit the
  bound).
- `fictionalSearchPlanNoConfirmedRoles` (`confirmedTitles: []`,
  `appliedQueries: []`, `confirmationAllowed: false`).
- `fictionalSearchPlanNoReadySources` (all sources excluded or
  needs-attention).
- `fictionalSearchPlanBounded` (confirmed titles exceed the bound;
  `omittedTitles` populated, warning present).
- `fictionalSearchPlanPendingConfirmation` (saving state fixture).
- `fictionalSearchPlanConfirmationFailure` (saveError fixture).

## Acceptance checks

Service tests in `tests/onboarding-search-plan.test.tsx` must cover:

- [ ] Deterministic output: equal inputs → equal plans (JSON-stable).
- [ ] Case-insensitive dedupe preserves the first user-visible
      spelling.
- [ ] Empty / whitespace-only titles are dropped.
- [ ] `SearchProfile.maxQueriesPerRun` bounds the query list and the
      overflow is recorded in `omittedTitles` + a bounded `warnings`
      entry.
- [ ] No ready sources → `readySourceCount === 0`,
      `confirmationAllowed === false`.
- [ ] No usable queries → `appliedQueries.length === 0`,
      `confirmationAllowed === false`.
- [ ] Archived source → `state: 'excluded'`, reason mentions archived.
- [ ] Disabled source → `state: 'excluded'`, reason mentions disabled.
- [ ] Missing provider (`providerId === null`) → `state: 'excluded'`.
- [ ] Unknown / unsupported provider reference →
      `state: 'excluded'`.
- [ ] Unvalidated configuration → `state: 'excluded'`.
- [ ] Invalid configuration → `state: 'excluded'`.
- [ ] Credentials-required with no available credentials →
      `state: 'needs-attention'`, reason mentions credentials.
- [ ] Failed health → `state: 'needs-attention'`, reason is the safe
      generic phrase
      (`'The last source check failed. Review this source before searching.'`).
- [ ] Hostile `healthMessage` content (URLs with tokens, passwords,
      paths, emails, exceptions) does not appear anywhere in
      `JSON.stringify(plan)`, while the safe generic reason does.
- [ ] Healthy / never-run health with valid configuration →
      `state: 'ready'`.
- [ ] Source ordering is deterministic across reorderings of the
      `sources` input array.
- [ ] Inputs are not mutated (object + array deep-freeze proof).
- [ ] `preferredLocations` is returned as a detached snapshot: new array
      and copied location objects, so mutating the returned plan cannot
      mutate the original preferences.
- [ ] Plan JSON round-trips to the same JSON (`JSON.parse(JSON.stringify(plan))`
      is `===` on every field).
- [ ] The plan service performs no provider, coordinator, database,
      filesystem or network side-effect (verified with a `vi.fn()` /
      `Object.freeze` probe).

Component tests in `tests/onboarding-search-plan.test.tsx` must
cover:

- [ ] `appliedQueries` render as the executable query list.
- [ ] `omittedTitles` render as a separate list and never appear in the
      executable query list.
- [ ] Empty `appliedQueries` disable confirmation and show an empty-query
      explanation.
- [ ] Location / remote / distance constraints render.
- [ ] Ready sources render in a separate group; needs-attention and
      excluded sources render with their `reason` text.
- [ ] The "no search has run" statement is visible.
- [ ] The copy is plan-specific (e.g. "Review your search plan") and does
      not describe profile qualification review.
- [ ] `Back` fires the `onBack` callback once.
- [ ] `Confirm plan` fires the `onConfirm` callback once.
- [ ] `Confirm plan` is disabled when `confirmationAllowed` is
      `false`.
- [ ] Duplicate confirmation is blocked while `saving === true`.
- [ ] A confirmation error (`role="alert"`) remains visible without
      clearing the plan.
- [ ] All controls are reachable by keyboard and have visible
      accessible names.
- [ ] The component never executes a provider, the coordinator, or
      any HTTP/SQL call (probe assertion).

Tests must not assert only wording. Assert behaviour, state,
callbacks, and accessible relationships.

## Validation

Focused gates while developing:

- `npm run typecheck`
- `npx vitest run tests/onboarding-search-plan.test.tsx`
- `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/onboarding-review.test.tsx tests/onboarding-progress-storage.test.ts tests/onboarding-search-plan.test.tsx`
- `npx eslint src/models/onboarding.ts src/onboarding/search-plan-service.ts src/client/components/onboarding/SearchPlanStep.tsx tests/onboarding-search-plan.test.tsx`
- `npx prettier --check <same set of files plus onboarding.css and the
  fixtures + docs touched>

After all source and documentation edits are final, run the broader
gates once:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run verify`
- `npm run privacy:check`
- `npm run nlp:security-audit`
- `git diff --check`

## Checks NOT performed

- Browser, narrow-window, and 200% zoom visual verification is
  **not** performed in MR1-05; these remain explicit acceptance items
  for **MR1-06/MR1-07** and are not described as passed.
- No packaged or installed-app validation.
- No production database access.
- No discovery execution, no provider launch, no network.
- No push, no version bump, no installer rebuild, no release claim.

## Scope boundaries

No route, API, `App.tsx`, `SourceRepository` mutation, discovery
execution, provider launch, production database access, migration,
dependency, scoring, eligibility, ranking, filtering, NLP-authority,
notification, version bump, installer build, or release claim is
included. The plan slice is **preview-only**.
