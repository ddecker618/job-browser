import type { JobStatus } from '../domain/job-status.js';
import type { CategoryScores, RecommendationStatus } from './intelligence.js';

export interface DashboardSummary {
  totalJobs: number;
  newJobsToday: number;
  strongMatches: number;
  appliedJobs: number;
  hiddenJobs: number;
  expiredJobs: number;
  verifiedMatches: number;
  averageMatchScore: number;
  topEmployer: string | null;
  topSkill: string | null;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  type: 'status' | 'discovery' | 'analysis';
  label: string;
  timestamp: string;
}

export interface JobListItem {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  score: number | null;
  recommendation: string | null;
  matchedFamilies: string | null;
  status: JobStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  provider: string;
  favorite: boolean;
  active: boolean;
}

export interface JobSourceView {
  sourceId: string;
  providerId: string | null;
  postingUrl: string | null;
  externalId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface JobDetail extends JobListItem {
  city: string | null;
  state: string | null;
  employmentType: string;
  salaryText: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  postingUrl: string | null;
  datePosted: string | null;
  clearanceRequirement: string | null;
  agency: string | null;
  department: string | null;
  gradeLow: string | null;
  gradeHigh: string | null;
  payPlan: string | null;
  appointmentType: string | null;
  workSchedule: string | null;
  teleworkEligible: boolean | null;
  openingDate: string | null;
  closingDate: string | null;
  applicationUrls: string[];
  categoryScores: CategoryScores | null;
  explanations: string[];
  missingQualifications: string[];
  skills: string[];
  certifications: string[];
  sources: JobSourceView[];
  notes: string | null;
  recommendationStatus: RecommendationStatus | null;
}

export interface ResumeView {
  id: string;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  isDefault: boolean;
  parsingStatus: 'parsed' | 'pending' | 'failed';
  parsingError: string | null;
  extractedSkills: string[];
  extractedCertifications: string[];
  createdAt: string;
  updatedAt: string;
  proposals: ResumeProposalView[];
}

export interface ResumeProposalView {
  id: string;
  fieldName: 'skills' | 'certifications';
  proposedValue: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface SourceView {
  id: string;
  providerName: string;
  status: 'healthy' | 'failed' | 'never-run';
  jobsImported: number;
  lastRun: string | null;
  durationMs: number | null;
  error: string | null;
  lastSuccessfulImport: string | null;
}

export interface AnalyticsView {
  topSkills: MetricItem[];
  topCertifications: MetricItem[];
  topEmployers: MetricItem[];
  jobsByLocation: MetricItem[];
  jobsByScore: MetricItem[];
  recommendationDistribution: MetricItem[];
  jobsOverTime: MetricItem[];
  averageSalary: number;
}

export interface MetricItem {
  label: string;
  value: number;
}

export interface AppSettings {
  databaseLocation: string;
  defaultSearch: string;
  theme: 'dark' | 'light';
  defaultSort: 'score' | 'newest' | 'company';
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
  resumeDirectory: string;
  artifactDirectory: string;
  targetRoles: string[];
}

export interface SavedFilterView {
  id: string;
  name: string;
  filters: Record<string, string | number | boolean>;
}
