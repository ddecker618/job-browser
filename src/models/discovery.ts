export interface SearchRequest {
  query: string;
  queries?: readonly string[];
  location: string | null;
  remoteOnly: boolean;
  limit: number;
  maxAgeDays?: number | null;
}

export interface DiscoveryOptions {
  fixtureOnly: boolean;
  fixturePath?: string;
  sourceId?: string;
  configuration?: Record<string, unknown>;
  trigger?: DiscoveryTrigger;
  credentials?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export type DiscoveryTrigger =
  | 'cli'
  | 'manual-job'
  | 'manual-source'
  | 'manual-all'
  | 'scheduled';

export interface ProviderSearch {
  request: SearchRequest;
  target: string;
  fixturePath: string | null;
  signal?: AbortSignal;
  configuration?: Record<string, unknown>;
}

export interface QueryDiagnostics {
  provider: string;
  searchTerm: string;
  location: string;
  requestStarted: string;
  requestCompleted: string;
  rawResultsReturned: number;
  uniqueResultsRetained: number;
  duplicatesRemoved: number;
  errors: string[];
  durationMs: number;
  terminationReason:
    | 'exhausted_results'
    | 'per_query_limit'
    | 'global_unique_limit'
    | 'request_budget'
    | 'timeout'
    | 'provider_error'
    | 'cancelled';
}

export interface ProviderFetchResult {
  records: readonly unknown[];
  rejected: number;
  truncated: boolean;
  complete: boolean;
  unfilteredCount?: number;
  emptyNotice?: string | null;
  queryDiagnostics?: QueryDiagnostics[];
  plannedQueries?: number;
  completedQueries?: number;
  failedQueries?: number;
  truncatedQueries?: number;
}

export interface DiscoverySummary {
  runId: string;
  sourceId: string;
  providerId: string;
  jobsFound: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesDetected: number;
  duplicatesMerged: number;
  recordsRejected: number;
  rediscoveries: number;
  crossSourceMerges: number;
  materialUpdates: number;
  identityConflicts: number;
  fetchTruncated: boolean;
  completeSnapshot: boolean;
  retryCount: number;
  jobsFailed: number;
  executionTimeMs: number;
  emptyNotice?: string | null;
}

export interface GlobalDiscoverySummary {
  enabledSources: number;
  disabledSources: number;
  totalCareerSites: number;
  activeCareerSites: number;
  retiredCareerSites: number;
  healthyCareerSites: number;
  warningCareerSites: number;
  brokenCareerSites: number;
  unknownCareerSites: number;
}

export interface DiscoveryAnalyticsWindow {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  interruptedRuns: number;
  zeroResultSuccessfulRuns: number;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  medianDurationMs: number | null;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
}

export interface DiscoveryJobYield {
  jobsDiscovered: number;
  newCanonicalJobs: number;
  rediscoveredJobs: number;
  jobsUpdated: number;
  jobsClosed: number;
  currentlyActiveJobs: number;
  userRemovedJobsExcluded: number;
  newJobYieldPerSuccessfulRun: number;
  zeroYieldRunCount: number;
}

export interface DiscoveryAnalyticsReport {
  summary: GlobalDiscoverySummary;
  activity: DiscoveryAnalyticsWindow;
  yield: DiscoveryJobYield;
}

export interface SourceAnalyticsRow {
  sourceId: string;
  displayName: string;
  provider: string;
  enabled: boolean;
  lastRun: string | null;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  successRate: number;
  runCount: number;
  newJobs: number;
  activeJobs: number;
  jobsPerSuccessfulRun: number;
  zeroResultStreak: number;
  staleDurationHours: number | null;
  nextScheduledRun: string | null;
  healthStatus: string;
}

export interface ProviderAnalyticsRow {
  providerId: string;
  providerName: string;
  sourcesCount: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  averageYield: number;
  recentFailureTrend: 'stable' | 'degrading';
  recentZeroYieldTrend: 'stable' | 'high-zero-yield';
}

export interface DiscoveryAlert {
  id: string;
  ruleId: string;
  entityType: 'source' | 'career_site' | 'provider';
  entityId: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  state: 'active' | 'acknowledged' | 'resolved';
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  message: string;
  evidenceJson: string;
  ruleVersion: string;
}

