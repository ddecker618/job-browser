export interface SearchRequest {
  query: string;
  location: string | null;
  remoteOnly: boolean;
  limit: number;
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

export interface ProviderFetchResult {
  records: readonly unknown[];
  rejected: number;
  truncated: boolean;
  complete: boolean;
  unfilteredCount?: number;
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
}
