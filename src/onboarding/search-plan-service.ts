/*
 * MR1-05 — pure, deterministic onboarding search/source-plan preview
 * service. See `docs/delivery/tasks/MR1-05-search-plan.md`.
 *
 * The service never touches SQLite, the filesystem, the provider
 * registry, the network, credentials, or `DiscoveryCoordinator`. It
 * only reads the supplied inputs and returns a versioned plan; it
 * does not mutate any input array or object.
 */
import type {
  OnboardingSearchPlan,
  OnboardingSearchPlanSourceEntry,
} from '../models/onboarding.js';
import { ONBOARDING_SEARCH_PLAN_VERSION } from '../models/onboarding.js';
import type { OnboardingValidatedPreferences } from '../models/onboarding.js';
import type {
  ConfiguredSource,
  ProviderDescriptor,
} from '../models/source-management.js';
import type { SearchProfile } from '../config/search-profile.js';

const REASON_ARCHIVED = 'Source is archived';
const REASON_DISABLED = 'Source is disabled';
const REASON_NO_PROVIDER = 'No provider configured';
const REASON_PROVIDER_UNAVAILABLE = 'Provider is not available';
const REASON_CONFIG_UNVALIDATED = 'Configuration not validated';
const REASON_CONFIG_INVALID = 'Configuration is invalid';
const REASON_CREDENTIALS_REQUIRED = 'Credentials required';
const REASON_LAST_RUN_FAILED =
  'The last source check failed. Review this source before searching.';

const MAX_REASON_LENGTH = 240;
const MAX_WARNING_LENGTH = 240;

export interface BuildOnboardingSearchPlanInput {
  readonly preferences: OnboardingValidatedPreferences;
  readonly confirmedTitles: readonly string[];
  readonly searchProfile: Pick<SearchProfile, 'maxQueriesPerRun'>;
  readonly sources: readonly ConfiguredSource[];
  readonly providerDescriptors: readonly ProviderDescriptor[];
}

interface ProviderIndex {
  readonly byId: ReadonlyMap<string, ProviderDescriptor>;
}

function indexProviders(
  descriptors: readonly ProviderDescriptor[],
): ProviderIndex {
  const map = new Map<string, ProviderDescriptor>();
  for (const descriptor of descriptors) map.set(descriptor.id, descriptor);
  return { byId: map };
}

function clampReason(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

const SUPPORTED_STATES: ReadonlySet<ProviderDescriptor['supportState']> =
  new Set(['supported', 'supported-with-configuration']);

function isSupported(
  descriptor: ProviderDescriptor | undefined,
): descriptor is ProviderDescriptor {
  return (
    descriptor !== undefined && SUPPORTED_STATES.has(descriptor.supportState)
  );
}

interface Classification {
  readonly entry: OnboardingSearchPlanSourceEntry;
}

function classify(
  source: ConfiguredSource,
  providerIndex: ProviderIndex,
): Classification {
  const displayName = source.displayName || source.employer;
  const providerId = source.providerId;
  const provider =
    providerId === null ? undefined : providerIndex.byId.get(providerId);

  // excluded: archived
  if (typeof source.archivedAt === 'string' && source.archivedAt !== '') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_ARCHIVED, MAX_REASON_LENGTH),
      },
    };
  }

  // excluded: disabled
  if (!source.enabled) {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_DISABLED, MAX_REASON_LENGTH),
      },
    };
  }

  // excluded: no provider configured
  if (providerId === null) {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_NO_PROVIDER, MAX_REASON_LENGTH),
      },
    };
  }

  // excluded: provider reference is missing from the descriptor set
  if (provider === undefined) {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_PROVIDER_UNAVAILABLE, MAX_REASON_LENGTH),
      },
    };
  }

  // excluded: provider reference is not in a supported state
  if (!isSupported(provider)) {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_PROVIDER_UNAVAILABLE, MAX_REASON_LENGTH),
      },
    };
  }

  // excluded: configuration unvalidated / invalid
  if (source.configurationStatus === 'unvalidated') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_CONFIG_UNVALIDATED, MAX_REASON_LENGTH),
      },
    };
  }
  if (source.configurationStatus === 'invalid') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'excluded',
        reason: clampReason(REASON_CONFIG_INVALID, MAX_REASON_LENGTH),
      },
    };
  }

  // needs-attention: credentials required but unavailable
  if (
    provider.capabilities.requiresCredentials &&
    !provider.credentialStatus.available
  ) {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'needs-attention',
        reason: clampReason(REASON_CREDENTIALS_REQUIRED, MAX_REASON_LENGTH),
      },
    };
  }

  // needs-attention: configuration reports credentials-required
  if (source.configurationStatus === 'credentials-required') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'needs-attention',
        reason: clampReason(REASON_CREDENTIALS_REQUIRED, MAX_REASON_LENGTH),
      },
    };
  }

  // needs-attention: failed health (safe generic reason — raw diagnostics
  // such as healthMessage, lastFailure, careersUrl, secrets, paths, or
  // stack traces are never exposed through the onboarding plan).
  if (source.healthStatus === 'failed') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'needs-attention',
        reason: clampReason(REASON_LAST_RUN_FAILED, MAX_REASON_LENGTH),
      },
    };
  }

  // needs-attention: credentials-required health (e.g. mid-run)
  if (source.healthStatus === 'credentials-required') {
    return {
      entry: {
        id: source.id,
        displayName,
        employer: source.employer,
        providerId,
        state: 'needs-attention',
        reason: clampReason(REASON_CREDENTIALS_REQUIRED, MAX_REASON_LENGTH),
      },
    };
  }

  // ready (valid configuration, healthy or never-run, available credentials)
  return {
    entry: {
      id: source.id,
      displayName,
      employer: source.employer,
      providerId,
      state: 'ready',
      reason: null,
    },
  };
}

function sortSources(sources: readonly ConfiguredSource[]): ConfiguredSource[] {
  return [...sources].sort((a, b) => {
    const aName = a.displayName || a.employer;
    const bName = b.displayName || b.employer;
    const byName = aName.localeCompare(bName);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

function trimTitle(title: string): string {
  return title.trim();
}

function dedupeTitlesCaseInsensitive(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const title of titles) {
    const trimmed = trimTitle(title);
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function copyPreferredLocations(
  locations: OnboardingValidatedPreferences['preferredLocations'],
): OnboardingValidatedPreferences['preferredLocations'] {
  return locations.map((location) => ({
    city: location.city,
    state: location.state,
  }));
}

function boundQueryList(
  cleanedTitles: readonly string[],
  maxQueriesPerRun: number,
): { applied: string[]; omitted: string[] } {
  if (cleanedTitles.length <= maxQueriesPerRun) {
    return { applied: [...cleanedTitles], omitted: [] };
  }
  return {
    applied: cleanedTitles.slice(0, maxQueriesPerRun),
    omitted: cleanedTitles.slice(maxQueriesPerRun),
  };
}

/**
 * Build a versioned, deterministic onboarding search/source-plan
 * preview from the supplied inputs. The function is pure: it does
 * not read SQLite, the filesystem, providers, the network, or
 * credentials; it does not mutate any input.
 */
export function buildOnboardingSearchPlan(
  input: BuildOnboardingSearchPlanInput,
): OnboardingSearchPlan {
  const providerIndex = indexProviders(input.providerDescriptors);
  const sortedSources = sortSources(input.sources);
  const cleanedTitles = dedupeTitlesCaseInsensitive(input.confirmedTitles);

  const maxQueries = Math.max(
    0,
    Math.floor(input.searchProfile.maxQueriesPerRun),
  );
  const { applied, omitted } = boundQueryList(cleanedTitles, maxQueries);

  const classifications = sortedSources.map((source) =>
    classify(source, providerIndex),
  );

  const readySourceCount = classifications.filter(
    ({ entry }) => entry.state === 'ready',
  ).length;
  const needsAttentionSourceCount = classifications.filter(
    ({ entry }) => entry.state === 'needs-attention',
  ).length;
  const excludedSourceCount = classifications.filter(
    ({ entry }) => entry.state === 'excluded',
  ).length;

  const warnings: string[] = [];
  if (omitted.length > 0) {
    const suffix = omitted.length === 1 ? 'was' : 'were';
    const noun = omitted.length === 1 ? 'query' : 'queries';
    const message = `${String(omitted.length)} confirmed title${omitted.length === 1 ? '' : 's'} ${suffix} not included because the search plan is capped at ${String(maxQueries)} ${noun}.`;
    warnings.push(clampReason(message, MAX_WARNING_LENGTH));
  }

  const confirmationAllowed = applied.length > 0 && readySourceCount > 0;

  return {
    version: ONBOARDING_SEARCH_PLAN_VERSION,
    confirmedTitles: cleanedTitles,
    appliedQueries: applied,
    omittedTitles: omitted,
    preferredLocations: copyPreferredLocations(
      input.preferences.preferredLocations,
    ),
    remotePreference: input.preferences.remotePreference,
    primaryRadiusMiles: input.preferences.searchRadiusMiles,
    secondaryRadiusMiles: input.preferences.secondarySearchRadiusMiles,
    sources: classifications.map(({ entry }) => entry),
    totalSourceCount: classifications.length,
    readySourceCount,
    needsAttentionSourceCount,
    excludedSourceCount,
    warnings,
    confirmationAllowed,
  };
}
