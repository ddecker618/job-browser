import type {
  AnalyticsView,
  AppSettings,
  DashboardSummary,
  JobDetail,
  JobListItem,
  ResumeProposalView,
  ResumeView,
  SavedFilterView,
  SourceView,
} from '../models/dashboard.js';
import type {
  ConfiguredSource,
  AtsDetectionResult,
  ProviderConfiguration,
  ProviderDescriptor,
  SourceControlCenter,
  SourceInput,
  ValidationResult,
} from '../models/source-management.js';
import type {
  Employer,
  CareerSite,
  EmployerWithSites,
  EmployerSeed,
  EmployerSeedImportResult,
  CareerSiteVerificationHistory,
} from '../models/employer.js';
import type { CareerSiteHealthRunResult } from '../discovery/careerSiteHealthService.js';
import type { EmployerDiscoveryRunResult } from '../discovery/employerDiscoveryService.js';
import type { DiscoverySummary } from '../models/discovery.js';
import type {
  CareerSiteIntelligenceDecision,
  DiscoveryIntelligenceSummary,
} from '../models/employer-discovery-intelligence.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import type {
  JobSearchQuery,
  JobSearchResponse,
} from '../models/job-search.js';
import type { AnalysisSummary } from '../models/intelligence.js';
import type { OutcomeAnalytics } from '../models/outcome-analytics.js';
import type { SearchProfile } from '../config/search-profile.js';
import type {
  ApplicationDetail,
  ApplicationEventCommand,
  ApplicationListQuery,
  ApplicationListResponse,
  ApplicationNotesWriteResponse,
  ApplicationSummaryNotesCommand,
  ApplicationTimelineEvent,
  ApplicationWriteResponse,
  CreateApplicationCommand,
} from '../models/application-management.js';

export type ApiErrorDetail = string | number | boolean | null;

export class ApiRequestError extends Error {
  public readonly details: Readonly<Record<string, ApiErrorDetail>>;

  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    details: Readonly<Record<string, ApiErrorDetail>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'ApiRequestError';
    this.details = boundedErrorDetails(details);
  }
}

export function apiRequestErrorReason(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const reason = error.details['reason'];
  return typeof reason === 'string' && reason !== '' ? reason : null;
}

export function isDefinitiveApiCommandError(
  error: unknown,
): error is ApiRequestError {
  return (
    error instanceof ApiRequestError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
  );
}

export interface ProfileResponse {
  profile: CandidateProfile;
  scoring: ScoringConfig;
}

function searchParameters(query: Partial<JobSearchQuery>): string {
  const parameters = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value: unknown = query[key as keyof JobSearchQuery];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      parameters.set(key, String(value));
    }
  }
  const serialized = parameters.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

function applicationSearchParameters(query: ApplicationListQuery): string {
  const parameters = new URLSearchParams();
  parameters.set('limit', String(query.limit));
  if (query.status !== undefined) parameters.set('status', query.status);
  if (query.company !== undefined) parameters.set('company', query.company);
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor);
  return `?${parameters.toString()}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const errorBody = isRecord(body) ? body : {};
    const message =
      typeof errorBody['error'] === 'string'
        ? errorBody['error']
        : response.statusText ||
          `Request failed with status ${String(response.status)}`;
    const code =
      typeof errorBody['code'] === 'string' && errorBody['code'].length > 0
        ? errorBody['code']
        : `http_${String(response.status)}`;
    throw new ApiRequestError(
      response.status,
      code,
      message,
      readErrorDetails(errorBody['details']),
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  dashboard: () => request<DashboardSummary>('/api/dashboard'),
  jobs: () => request<JobListItem[]>('/api/jobs'),
  searchJobs: (query: Partial<JobSearchQuery> = {}, signal?: AbortSignal) =>
    request<JobSearchResponse>(
      `/api/jobs/search${searchParameters(query)}`,
      signal === undefined ? undefined : { signal },
    ),
  job: (id: string) => request<JobDetail>(`/api/jobs/${id}`),
  updateJob: (
    id: string,
    body: { favorite?: boolean; notes?: string | null },
  ) => request<JobDetail>(`/api/jobs/${id}`, json('PATCH', body)),
  updateStatus: (id: string, status: string) =>
    request<JobDetail>(`/api/jobs/${id}/status`, json('PATCH', { status })),
  refreshJob: (id: string) =>
    request<JobDetail>(`/api/jobs/${id}/refresh`, { method: 'POST' }),
  listApplications: (query: ApplicationListQuery, signal?: AbortSignal) =>
    request<ApplicationListResponse>(
      `/api/applications${applicationSearchParameters(query)}`,
      signal === undefined ? undefined : { signal },
    ),
  getApplication: (applicationId: string, signal?: AbortSignal) =>
    request<ApplicationDetail>(
      `/api/applications/${encodeURIComponent(applicationId)}`,
      signal === undefined ? undefined : { signal },
    ),
  getApplicationTimeline: (applicationId: string, signal?: AbortSignal) =>
    request<ApplicationTimelineEvent[]>(
      `/api/applications/${encodeURIComponent(applicationId)}/timeline`,
      signal === undefined ? undefined : { signal },
    ),
  createApplication: (command: CreateApplicationCommand) =>
    request<ApplicationWriteResponse>(
      '/api/applications',
      json('POST', command),
    ),
  appendApplicationEvent: (
    applicationId: string,
    command: ApplicationEventCommand,
  ) =>
    request<ApplicationWriteResponse>(
      `/api/applications/${encodeURIComponent(applicationId)}/events`,
      json('POST', command),
    ),
  updateApplicationNotes: (
    applicationId: string,
    command: ApplicationSummaryNotesCommand,
  ) =>
    request<ApplicationNotesWriteResponse>(
      `/api/applications/${encodeURIComponent(applicationId)}/notes`,
      json('PATCH', command),
    ),
  profile: () => request<ProfileResponse>('/api/profile'),
  saveProfile: (profile: CandidateProfile, rescore: boolean) =>
    request<{ profile: CandidateProfile; analysis: AnalysisSummary }>(
      '/api/profile',
      json('PUT', { profile, rescore }),
    ),
  saveScoring: (scoring: ScoringConfig) =>
    request<{ scoring: ScoringConfig; analysis: AnalysisSummary }>(
      '/api/scoring',
      json('PUT', scoring),
    ),
  resumes: () => request<ResumeView[]>('/api/resumes'),
  uploadResume: (form: FormData) =>
    request<ResumeView>('/api/resumes', { method: 'POST', body: form }),
  updateResume: (
    id: string,
    body: { displayName?: string; isDefault?: boolean },
  ) => request<ResumeView>(`/api/resumes/${id}`, json('PATCH', body)),
  deleteResume: (id: string) =>
    request<undefined>(`/api/resumes/${id}`, { method: 'DELETE' }),
  rescoreResume: (id: string) =>
    request(`/api/resumes/${id}/rescore`, { method: 'POST' }),
  reviewProposal: (id: string, status: 'approved' | 'rejected') =>
    request<ResumeProposalView>(
      `/api/resume-proposals/${id}`,
      json('PATCH', { status }),
    ),
  reviewAllProposals: (resumeId: string, status: 'approved' | 'rejected') =>
    request<ResumeProposalView[]>(
      `/api/resumes/${resumeId}/proposals`,
      json('POST', { status }),
    ),
  analytics: () => request<AnalyticsView>('/api/analytics'),
  outcomeAnalytics: (start: string, end: string) =>
    request<OutcomeAnalytics>(
      `/api/analytics/application-outcomes?${new URLSearchParams({ start, end }).toString()}`,
    ),
  sources: () => request<SourceView[]>('/api/sources'),
  providers: () => request<ProviderDescriptor[]>('/api/providers'),
  detectSource: (url: string) =>
    request<AtsDetectionResult>('/api/sources/detect', json('POST', { url })),
  sourceControlCenter: () =>
    request<SourceControlCenter>('/api/sources/control-center'),
  validateSource: (providerId: string, configuration: ProviderConfiguration) =>
    request<ValidationResult>(
      '/api/sources/validate',
      json('POST', { providerId, configuration }),
    ),
  createSource: (source: SourceInput) =>
    request<ConfiguredSource>('/api/sources', json('POST', source)),
  updateSource: (id: string, source: SourceInput) =>
    request<ConfiguredSource>(`/api/sources/${id}`, json('PUT', source)),
  deleteSource: (id: string) =>
    request<undefined>(`/api/sources/${id}`, { method: 'DELETE' }),
  setSourceEnabled: (id: string, enabled: boolean) =>
    request<ConfiguredSource>(
      `/api/sources/${id}/enabled`,
      json('PATCH', { enabled }),
    ),
  runSource: (id: string) =>
    request<DiscoverySummary[]>(`/api/sources/${id}/run`, { method: 'POST' }),
  validateSourceHealth: (id: string) =>
    request(`/api/sources/${id}/health`, { method: 'POST' }),
  runAllSources: () =>
    request<DiscoverySummary[]>('/api/discovery/run', { method: 'POST' }),
  saveDiscoverySettings: (settings: {
    schedulerEnabled: boolean;
    employerDiscoveryEnabled: boolean;
  }) =>
    request<{
      schedulerEnabled: boolean;
      employerDiscoveryEnabled: boolean;
    }>('/api/discovery/settings', json('PUT', settings)),
  settings: () => request<AppSettings>('/api/settings'),
  saveSettings: (settings: AppSettings) =>
    request<AppSettings>('/api/settings', json('PUT', settings)),
  searchProfile: () => request<SearchProfile>('/api/search-profile'),
  saveSearchProfile: (profile: SearchProfile) =>
    request<{ profile: SearchProfile; analysis: AnalysisSummary }>(
      '/api/search-profile',
      json('PUT', profile),
    ),
  savedFilters: () => request<SavedFilterView[]>('/api/saved-filters'),
  saveFilter: (
    name: string,
    filters: Record<string, string | number | boolean>,
  ) =>
    request<SavedFilterView>(
      '/api/saved-filters',
      json('POST', { name, filters }),
    ),
  deleteFilter: (id: string) =>
    request<undefined>(`/api/saved-filters/${id}`, { method: 'DELETE' }),
  employers: () => request<EmployerWithSites[]>('/api/employers'),
  employer: (id: string) =>
    request<{ employer: Employer; careerSites: CareerSite[] }>(
      `/api/employers/${id}`,
    ),
  createEmployer: (input: { name: string; websiteUrl: string | null }) =>
    request<Employer>('/api/employers', json('POST', input)),
  createCareerSite: (employerId: string, input: { url: string }) =>
    request<CareerSite>(
      `/api/employers/${employerId}/career-sites`,
      json('POST', input),
    ),
  verifyCareerSite: (id: string) =>
    request<CareerSite>(`/api/career-sites/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
    }),
  createCareerSiteSource: (id: string) =>
    request<ConfiguredSource>(
      `/api/career-sites/${encodeURIComponent(id)}/source`,
      { method: 'POST' },
    ),
  runEmployerDiscovery: () =>
    request<EmployerDiscoveryRunResult>('/api/employer-discovery/run', {
      method: 'POST',
    }),
  runCareerSiteHealth: () =>
    request<CareerSiteHealthRunResult>('/api/career-site-health/run', {
      method: 'POST',
    }),
  importEmployerSeeds: (seeds: readonly EmployerSeed[]) =>
    request<EmployerSeedImportResult>(
      '/api/employer-discovery/seeds',
      json('POST', { seeds }),
    ),
  employerDiscoveryIntelligence: (asOf?: string) =>
    request<DiscoveryIntelligenceSummary>(
      `/api/employer-discovery/intelligence${
        asOf === undefined ? '' : `?${new URLSearchParams({ asOf }).toString()}`
      }`,
    ),
  careerSiteIntelligence: (id: string, asOf?: string) =>
    request<CareerSiteIntelligenceDecision>(
      `/api/career-sites/${encodeURIComponent(id)}/intelligence${
        asOf === undefined ? '' : `?${new URLSearchParams({ asOf }).toString()}`
      }`,
    ),
  discoverCareerSite: (id: string) =>
    request<{ site: CareerSite; counter: string }>(
      `/api/career-sites/${encodeURIComponent(id)}/discover`,
      { method: 'POST' },
    ),
  checkCareerSiteHealth: (id: string) =>
    request<CareerSite>(
      `/api/career-sites/${encodeURIComponent(id)}/health-check`,
      { method: 'POST' },
    ),
  repairCareerSite: (id: string) =>
    request<{ site: CareerSite; repaired: boolean; reason: string }>(
      `/api/career-sites/${encodeURIComponent(id)}/repair`,
      { method: 'POST' },
    ),
  careerSiteVerificationHistory: (id: string) =>
    request<CareerSiteVerificationHistory[]>(
      `/api/career-sites/${encodeURIComponent(id)}/verification-history`,
    ),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readErrorDetails(value: unknown): Record<string, ApiErrorDetail> {
  if (!isRecord(value)) return {};
  const details: Record<string, ApiErrorDetail> = {};
  for (const [key, detail] of Object.entries(value)) {
    if (
      typeof detail === 'string' ||
      typeof detail === 'number' ||
      typeof detail === 'boolean' ||
      detail === null
    ) {
      details[key] = detail;
    }
  }
  return details;
}

function boundedErrorDetails(
  value: Readonly<Record<string, ApiErrorDetail>>,
): Readonly<Record<string, ApiErrorDetail>> {
  const details: Record<string, ApiErrorDetail> = {};
  for (const [key, detail] of Object.entries(value).slice(0, 12)) {
    details[key.slice(0, 200)] =
      typeof detail === 'string' ? detail.slice(0, 500) : detail;
  }
  return Object.freeze(details);
}
