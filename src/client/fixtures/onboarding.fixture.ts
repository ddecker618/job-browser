/*
 * All values in this fixture file are fictional. They exist only to
 * exercise the onboarding contract in isolation and are not, and must
 * never be treated as, real candidate or employer data.
 */
import type {
  OnboardingPreferencesDraft,
  OnboardingPreferencesStepProps,
  OnboardingProgressSnapshot,
  OnboardingReviewItem,
  OnboardingReviewStepProps,
  OnboardingSearchPlan,
  OnboardingSearchPlanSourceEntry,
  OnboardingValidatedPreferences,
} from '../../models/onboarding.js';
import type { ConfiguredSource } from '../../models/source-management.js';
import type { ProviderDescriptor } from '../../models/source-management.js';

/**
 * The reachable end state of the current onboarding flow: all five
 * ENABLED questions answered. The salary question is deferred (L1), so
 * salary stays unanswered with no amounts.
 */
export const fictionalPreferencesDraftComplete: OnboardingPreferencesDraft = {
  desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
  preferredLocations: [
    { city: 'Austin', state: 'TX' },
    { city: 'Remote', state: 'TX' },
  ],
  searchRadiusMiles: '50',
  secondarySearchRadiusMiles: '75',
  remotePreference: 'preferred',
  answers: {
    remotePreference: 'answered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: ['full-time', 'contract'],
};

/**
 * Demonstrates the full supported contract including the deferred
 * salary question (supported, not enabled today). Kept for future use
 * when salary-period semantics are resolved (L1).
 */
export const fictionalFullContractDraft: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  answers: {
    ...fictionalPreferencesDraftComplete.answers,
    desiredSalary: 'answered',
  },
  desiredSalary: {
    minimum: '70000',
    target: '85000',
    currency: 'USD',
  },
};

export const fictionalFirstTimeUserDraft: OnboardingPreferencesDraft = {
  desiredJobTitles: [],
  preferredLocations: [],
  searchRadiusMiles: '',
  secondarySearchRadiusMiles: '',
  remotePreference: null,
  answers: {
    remotePreference: 'unanswered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: [],
};

/**
 * A deliberate skip recorded in a stored snapshot (L4). Not reachable
 * from the current enabled flow because salary is deferred.
 */
export const fictionalSkippedSalaryDraft: OnboardingPreferencesDraft = {
  ...fictionalFullContractDraft,
  desiredSalary: null,
  answers: {
    ...fictionalFullContractDraft.answers,
    desiredSalary: 'skipped',
  },
};

/**
 * A partial session resumed at the travel-distance question: roles and
 * location are answered, radii and everything later are still open.
 */
export const fictionalResumedProgressDraft: OnboardingPreferencesDraft = {
  desiredJobTitles: ['Network Engineer'],
  preferredLocations: [{ city: 'Austin', state: 'TX' }],
  searchRadiusMiles: '',
  secondarySearchRadiusMiles: '',
  remotePreference: null,
  answers: {
    remotePreference: 'unanswered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: [],
};

export const fictionalResumedProgressSnapshot: OnboardingProgressSnapshot = {
  version: 1,
  onboardingStep: 'preferences',
  currentQuestion: 'travel-distance',
  answers: fictionalResumedProgressDraft,
};

export const fictionalCorrectedLocationDraft: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  preferredLocations: [
    { city: 'Fort Worth', state: 'TX' },
    { city: 'Plano', state: 'TX' },
  ],
};

export const fictionalPreferencesDraftMissingLocation: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    preferredLocations: [
      { city: 'Dallas', state: '' },
      { city: '', state: 'OK' },
    ],
  };

export const fictionalPreferencesDraftEmptyRoles: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  desiredJobTitles: ['  ', '  '],
};

export const fictionalPreferencesDraftEmptyEmploymentTypes: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    desiredEmploymentTypes: [],
  };

export const fictionalPreferencesDraftInvalidRadius: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    searchRadiusMiles: '100',
    secondarySearchRadiusMiles: '50',
  };

export const fictionalPreferencesDraftInvalidSalaryRange: OnboardingPreferencesDraft =
  {
    ...fictionalFullContractDraft,
    desiredSalary: {
      minimum: '90000',
      target: '80000',
      currency: 'USD',
    },
  };

export const fictionalPreferencesSavingProps: OnboardingPreferencesStepProps = {
  value: fictionalPreferencesDraftComplete,
  errors: {},
  currentQuestion: 'employment-types',
  saving: true,
  saveError: null,
  onChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

export const fictionalPreferencesSaveFailureProps: OnboardingPreferencesStepProps =
  {
    value: fictionalPreferencesDraftComplete,
    errors: {},
    currentQuestion: 'employment-types',
    saving: false,
    saveError: 'Could not save preferences. Please try again.',
    onChange: () => undefined,
    onBack: () => undefined,
    onContinue: () => undefined,
  };

export const fictionalReviewItems: readonly OnboardingReviewItem[] = [
  {
    id: 'rev-1',
    field: 'skills',
    value: 'BGP configuration',
    status: 'confirmed',
    reason: null,
  },
  {
    id: 'rev-2',
    field: 'skills',
    value: 'Cisco Meraki administration',
    status: 'suggested',
    reason: 'Present in resume work history.',
  },
  {
    id: 'rev-3',
    field: 'certifications',
    value: 'CCNP Enterprise',
    status: 'confirmed',
    reason: null,
  },
  {
    id: 'rev-4',
    field: 'certifications',
    value: 'CompTIA Security+',
    status: 'unknown',
    reason: 'No evidence found.',
  },
];

export const fictionalReviewSavingProps: OnboardingReviewStepProps = {
  items: fictionalReviewItems,
  saving: true,
  saveError: null,
  onChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

// ---------------------------------------------------------------------------
// MR1-05 — search/source-plan preview fixtures (fictional)
// ---------------------------------------------------------------------------

export const fictionalSearchProfileMax40 = {
  maxQueriesPerRun: 40,
};

export const fictionalSearchProfileMax2 = {
  maxQueriesPerRun: 2,
};

export const fictionalSearchPreferences: OnboardingValidatedPreferences = {
  preferredLocations: [
    { city: 'Example City', state: 'EX' },
    { city: 'Second City', state: 'EX' },
  ],
  searchRadiusMiles: 25,
  secondarySearchRadiusMiles: 50,
  remotePreference: 'preferred',
  desiredSalary: null,
  desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
  desiredEmploymentTypes: ['full-time'],
};

const fictionalConfiguredSourceBase = (
  overrides: Partial<ConfiguredSource>,
): ConfiguredSource => ({
  id: 'src-base',
  displayName: 'Example Source',
  employer: 'Example Employer',
  providerId: 'builtin',
  sourceType: 'job-board',
  careersUrl: 'https://example.com/jobs',
  enabled: true,
  configuration: {},
  searchCriteria: {
    query: 'example',
    location: null,
    remoteOnly: false,
    limit: 50,
    maxAgeDays: 30,
  },
  configurationStatus: 'valid',
  healthStatus: 'healthy',
  healthMessage: null,
  lastHealthCheckAt: null,
  lastSuccessfulRun: null,
  lastFailure: null,
  failureCount: 0,
  archivedAt: null,
  lastCompleteSnapshotAt: null,
  schedule: {
    enabled: false,
    cadence: 'manual',
    dailyLocalTime: null,
    nextRunAt: null,
    lastDueAt: null,
  },
  ...overrides,
});

export const fictionalSearchProviderBuiltIn: ProviderDescriptor = {
  id: 'builtin',
  name: 'Built In',
  type: 'job-board',
  capabilities: {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: true,
  },
  credentialStatus: { configured: true, available: true },
  supportState: 'supported',
};

export const fictionalSearchProviderBrowser: ProviderDescriptor = {
  id: 'browser-provider',
  name: 'Browser Provider',
  type: 'job-board',
  capabilities: {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: true,
    structuredPreview: true,
    interactiveBrowser: true,
  },
  credentialStatus: { configured: true, available: false },
  supportState: 'supported',
};

export const fictionalSearchProviderUnsupported: ProviderDescriptor = {
  id: 'unsupported-provider',
  name: 'Unsupported Provider',
  type: 'job-board',
  capabilities: {
    keywordSearch: true,
    locationSearch: false,
    remoteFilter: false,
    pagination: false,
    compensation: false,
    requiresCredentials: false,
    structuredPreview: false,
  },
  credentialStatus: { configured: false, available: false },
  supportState: 'supported-with-configuration',
};

export const fictionalSearchSourceExcludedUnknownProvider: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-unknown-provider',
    displayName: 'Mystery Source',
    employer: 'Mystery Co',
    providerId: 'mystery-provider',
  });

export const fictionalSearchSourceReadyBuiltIn: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-ready-builtin',
    displayName: 'Built In',
    employer: 'Built In',
    providerId: 'builtin',
    healthStatus: 'healthy',
  });

export const fictionalSearchSourceReadyNeverRun: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-ready-never-run',
    displayName: 'Indeed',
    employer: 'Indeed',
    providerId: 'builtin',
    healthStatus: 'never-run',
  });

export const fictionalSearchSourceNeedsCredentials: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-needs-credentials',
    displayName: 'Handshake (browser)',
    employer: 'Handshake',
    providerId: 'browser-provider',
    healthStatus: 'credentials-required',
  });

export const fictionalSearchSourceNeedsFailedHealth: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-needs-failed',
    displayName: 'Dice',
    employer: 'Dice',
    providerId: 'builtin',
    healthStatus: 'failed',
    healthMessage: 'Timeout: The server did not respond in time',
    failureCount: 3,
  });

export const fictionalSearchSourceExcludedArchived: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-archived',
    displayName: 'Old Board',
    employer: 'Old Co',
    providerId: 'builtin',
    archivedAt: '2026-01-01T00:00:00.000Z',
    enabled: false,
  });

export const fictionalSearchSourceExcludedDisabled: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-disabled',
    displayName: 'ZipRecruiter',
    employer: 'ZipRecruiter',
    providerId: 'builtin',
    enabled: false,
  });

export const fictionalSearchSourceExcludedNoProvider: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-no-provider',
    displayName: 'Manual Source',
    employer: 'Manual Co',
    providerId: null,
  });

export const fictionalSearchSourceExcludedUnsupportedProvider: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-unsupported-provider',
    displayName: 'Unsupported Board',
    employer: 'Unsupported Co',
    providerId: 'unsupported-provider',
  });

export const fictionalSearchSourceExcludedUnvalidatedConfig: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-unvalidated',
    displayName: 'New Source',
    employer: 'New Co',
    providerId: 'builtin',
    configurationStatus: 'unvalidated',
    healthStatus: 'never-run',
  });

export const fictionalSearchSourceExcludedInvalidConfig: ConfiguredSource =
  fictionalConfiguredSourceBase({
    id: 'src-invalid',
    displayName: 'Bad Config Source',
    employer: 'Bad Co',
    providerId: 'builtin',
    configurationStatus: 'invalid',
    healthStatus: 'failed',
  });

export const fictionalSearchPlanSourceEntries: readonly OnboardingSearchPlanSourceEntry[] =
  [
    {
      id: 'src-ready-builtin',
      displayName: 'Built In',
      employer: 'Built In',
      providerId: 'builtin',
      state: 'ready',
      reason: null,
    },
    {
      id: 'src-needs-credentials',
      displayName: 'Handshake (browser)',
      employer: 'Handshake',
      providerId: 'browser-provider',
      state: 'needs-attention',
      reason: 'Credentials required',
    },
    {
      id: 'src-archived',
      displayName: 'Old Board',
      employer: 'Old Co',
      providerId: 'builtin',
      state: 'excluded',
      reason: 'Source is archived',
    },
  ];

export const fictionalSearchPlanReady: OnboardingSearchPlan = {
  version: 1,
  confirmedTitles: ['Network Engineer', 'Cloud Support Engineer'],
  appliedQueries: ['Network Engineer', 'Cloud Support Engineer'],
  omittedTitles: [],
  preferredLocations: fictionalSearchPreferences.preferredLocations,
  remotePreference: fictionalSearchPreferences.remotePreference,
  primaryRadiusMiles: 25,
  secondaryRadiusMiles: 50,
  sources: fictionalSearchPlanSourceEntries.slice(0, 1),
  totalSourceCount: 1,
  readySourceCount: 1,
  needsAttentionSourceCount: 0,
  excludedSourceCount: 0,
  warnings: [],
  confirmationAllowed: true,
};

export const fictionalSearchPlanNoConfirmedRoles: OnboardingSearchPlan = {
  ...fictionalSearchPlanReady,
  confirmedTitles: [],
  appliedQueries: [],
  omittedTitles: [],
  confirmationAllowed: false,
  warnings: [],
};

export const fictionalSearchPlanNoReadySources: OnboardingSearchPlan = {
  ...fictionalSearchPlanReady,
  sources: fictionalSearchPlanSourceEntries.slice(2, 3),
  totalSourceCount: 1,
  readySourceCount: 0,
  needsAttentionSourceCount: 0,
  excludedSourceCount: 1,
  confirmationAllowed: false,
};

export const fictionalSearchPlanBounded: OnboardingSearchPlan = {
  ...fictionalSearchPlanReady,
  confirmedTitles: [
    'Network Engineer',
    'Cloud Support Engineer',
    'Database Administrator',
    'Security Analyst',
    'Help Desk Technician',
  ],
  appliedQueries: ['Network Engineer', 'Cloud Support Engineer'],
  omittedTitles: [
    'Database Administrator',
    'Security Analyst',
    'Help Desk Technician',
  ],
  warnings: [
    '3 confirmed titles were not included because the search plan is capped at 2 queries.',
  ],
};

export const fictionalSearchPlanMixed: OnboardingSearchPlan = {
  ...fictionalSearchPlanReady,
  sources: fictionalSearchPlanSourceEntries,
  totalSourceCount: 3,
  readySourceCount: 1,
  needsAttentionSourceCount: 1,
  excludedSourceCount: 1,
};
