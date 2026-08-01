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
