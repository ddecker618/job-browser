import type { JobStatus } from '../domain/job-status.js';

export const JOB_SEARCH_SORT_FIELDS = [
  'score',
  'firstSeenAt',
  'lastVerifiedAt',
  'closingDate',
  'company',
  'title',
  'materiallyUpdatedAt',
] as const;

export type JobSearchSortField = (typeof JOB_SEARCH_SORT_FIELDS)[number];
export type JobSearchMode = 'fts5' | 'indexed';

export interface JobSearchQuery {
  q?: string | undefined;
  title?: string | undefined;
  company?: string | undefined;
  location?: string | undefined;
  remoteType?: 'onsite' | 'hybrid' | 'remote' | 'unknown' | undefined;
  provider?: string | undefined;
  sourceId?: string | undefined;
  minScore?: number | undefined;
  maxScore?: number | undefined;
  minSalary?: number | undefined;
  recommendation?: string | undefined;
  status?: JobStatus | undefined;
  firstDiscoveredFrom?: string | undefined;
  firstDiscoveredTo?: string | undefined;
  lastVerifiedFrom?: string | undefined;
  lastVerifiedTo?: string | undefined;
  newlyDiscovered?: boolean | undefined;
  materiallyUpdated?: boolean | undefined;
  closingSoon?: boolean | undefined;
  active?: 'active' | 'removed' | undefined;
  multipleSource?: boolean | undefined;
  page: number;
  pageSize: number;
  sort: JobSearchSortField;
  direction: 'asc' | 'desc';
}

export interface JobSearchSource {
  sourceId: string;
  sourceName: string;
  providerId: string | null;
}

export interface JobSearchItem {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  score: number | null;
  recommendation: string | null;
  status: JobStatus;
  firstSeenAt: string;
  lastVerifiedAt: string | null;
  materiallyUpdatedAt: string | null;
  closingDate: string | null;
  favorite: boolean;
  active: boolean;
  sources: JobSearchSource[];
}

export interface JobSearchFacet {
  value: string;
  label: string;
  count: number;
}

export interface JobSearchFacets {
  companies: JobSearchFacet[];
  locations: JobSearchFacet[];
  remoteTypes: JobSearchFacet[];
  providers: JobSearchFacet[];
  sources: JobSearchFacet[];
  recommendations: JobSearchFacet[];
  statuses: JobSearchFacet[];
  activeStates: JobSearchFacet[];
}

export interface JobSearchResponse {
  items: JobSearchItem[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  facets: JobSearchFacets;
  searchMode: JobSearchMode;
}
