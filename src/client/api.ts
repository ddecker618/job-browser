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
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import type {
  JobSearchQuery,
  JobSearchResponse,
} from '../models/job-search.js';
import type { AnalysisSummary } from '../models/intelligence.js';
import type { SearchProfile } from '../config/search-profile.js';

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `Request failed with status ${String(response.status)}`,
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
    request(`/api/sources/${id}/run`, { method: 'POST' }),
  validateSourceHealth: (id: string) =>
    request(`/api/sources/${id}/health`, { method: 'POST' }),
  runAllSources: () => request('/api/discovery/run', { method: 'POST' }),
  saveDiscoverySettings: (schedulerEnabled: boolean) =>
    request<{ schedulerEnabled: boolean }>(
      '/api/discovery/settings',
      json('PUT', { schedulerEnabled }),
    ),
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
};
