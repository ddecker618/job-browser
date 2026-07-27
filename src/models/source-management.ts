import type { SearchRequest } from './discovery.js';

export const PROVIDER_TYPES = [
  'job-board',
  'ats',
  'government',
  'structured-data',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderCapabilities {
  keywordSearch: boolean;
  locationSearch: boolean;
  remoteFilter: boolean;
  pagination: boolean;
  compensation: boolean;
  requiresCredentials: boolean;
  structuredPreview: boolean;
  interactiveBrowser?: boolean;
}

export type ProviderConfiguration = Record<string, unknown>;

export interface ValidationResult {
  valid: boolean;
  message: string;
  normalizedConfiguration: ProviderConfiguration | null;
  preview: SourcePreview | null;
  failureCategory?:
    | 'unsupported_variant'
    | 'legacy_portal'
    | 'endpoint_not_found'
    | 'blocked'
    | 'timeout'
    | 'unreachable'
    | 'invalid_response'
    | 'internal_error'
    | null;
  variant?: 'jibe_json' | 'icims_hosted_v1' | 'icims_hosted_v2' | null;
  diagnostics?: {
    provider: string;
    resolvedPortalUrl: string;
    resolvedJobsEndpoint: string;
    httpStatus: number | null;
    schemaRecognized: boolean;
    sampleCount: number;
  } | null;
}

export interface SourcePreview {
  format: string;
  jobCount: number;
  samples: { title: string; company: string; location: string | null }[];
  warnings: string[];
}

export interface ProviderHealthResult {
  status: 'healthy' | 'failed' | 'credentials-required';
  message: string;
  checkedAt: string;
}

export interface SourceSchedule {
  enabled: boolean;
  cadence:
    | 'manual'
    | 'every-6-hours'
    | 'every-12-hours'
    | 'every-24-hours'
    | 'daily';
  dailyLocalTime: string | null;
  nextRunAt: string | null;
  lastDueAt: string | null;
}

export interface ConfiguredSource {
  id: string;
  displayName: string;
  employer: string;
  providerId: string | null;
  sourceType: string;
  careersUrl: string | null;
  enabled: boolean;
  configuration: ProviderConfiguration;
  searchCriteria: SearchRequest;
  configurationStatus:
    | 'unvalidated'
    | 'valid'
    | 'invalid'
    | 'credentials-required';
  healthStatus: 'healthy' | 'failed' | 'never-run' | 'credentials-required';
  healthMessage: string | null;
  lastHealthCheckAt: string | null;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  failureCount: number;
  archivedAt?: string | null;
  lastCompleteSnapshotAt?: string | null;
  schedule: SourceSchedule;
}

export interface SourceInput {
  displayName: string;
  employer: string;
  providerId: string;
  careersUrl: string | null;
  configuration: ProviderConfiguration;
  searchCriteria: SearchRequest;
  enabled: boolean;
  schedule: Omit<SourceSchedule, 'nextRunAt' | 'lastDueAt'>;
}

export interface SourceControlSummary {
  healthySources: number;
  enabledSources: number;
  disabledSources: number;
  failedSources: number;
  lastDiscoveryRun: string | null;
  nextScheduledRun: string | null;
  jobsFoundToday: number;
  newUniqueJobs: number;
  duplicatesMerged: number;
  recordsRejected: number;
  rediscoveries: number;
  materialUpdates: number;
  identityConflicts: number;
}

export interface DiscoveryRunView {
  id: string;
  sourceId: string | null;
  providerId: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  jobsFound: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesMerged: number;
  jobsFailed: number;
  recordsRejected: number;
  rediscoveries: number;
  crossSourceMerges: number;
  materialUpdates: number;
  identityConflicts: number;
  fetchTruncated: boolean;
  completeSnapshot: boolean;
  retryCount: number;
  error: string | null;
}

export interface DiscoveryStatus {
  running: boolean;
  queuedSourceIds: string[];
  activeSourceId: string | null;
  startedAt: string | null;
  completedSources: number;
  totalSources: number;
  lastError: string | null;
}

export interface CredentialStatus {
  providerId: string;
  configured: boolean;
  available: boolean;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  type: ProviderType;
  capabilities: ProviderCapabilities;
  credentialStatus: { configured: boolean; available: boolean };
  supportState: 'supported' | 'supported-with-configuration';
}

export const ATS_SUPPORT_STATES = [
  'supported',
  'supported-with-configuration',
  'detected-but-unsupported',
  'structured-data-fallback-available',
  'unsupported',
] as const;
export type AtsSupportState = (typeof ATS_SUPPORT_STATES)[number];

export type AtsFailureCategory =
  | 'unreachable'
  | 'timeout'
  | 'blocked'
  | 'unsupported'
  | 'invalid_url'
  | 'no_signals'
  | 'legacy_portal'
  | 'internal_error';

export interface AtsDetectionResult {
  detectedPlatform: string | null;
  confidence: number;
  confidenceLabel?: 'high' | 'medium' | 'low';
  supportState: AtsSupportState;
  suggestedProvider: string | null;
  extractedConfiguration: ProviderConfiguration | null;
  fallbackConfiguration?: ProviderConfiguration | null;
  structuredFallback: boolean;
  explanation: string;
  resolvedUrl: string;
  requestedUrl?: string;
  normalizedUrl?: string;
  finalUrl?: string;
  httpStatus?: number | null;
  providersChecked?: string[];
  positiveSignals?: string[];
  negativeProbes?: string[];
  failureCategory?: AtsFailureCategory | null;
  variant?: 'jibe_json' | 'icims_hosted_v1' | 'icims_hosted_v2' | null;
  portalOrigin?: string | null;
  listingsUrl?: string | null;
  sitemapUrl?: string | null;
}

export interface SourceControlCenter {
  summary: SourceControlSummary;
  sources: ConfiguredSource[];
  recentRuns: DiscoveryRunView[];
  discovery: DiscoveryStatus | null;
  schedulerEnabled: boolean;
}
