import type { JobStatus } from './job-status.js';

export const REMOTE_TYPES = ['onsite', 'hybrid', 'remote', 'unknown'] as const;
export const EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'temporary',
  'internship',
  'unknown',
] as const;
export const SENIORITY_LEVELS = [
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive',
  'unknown',
] as const;

export type RemoteType = (typeof REMOTE_TYPES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export interface Job {
  id: string;
  fingerprint: string;
  externalId: string | null;
  title: string;
  normalizedTitle: string;
  company: string;
  normalizedCompany: string;
  location: string | null;
  city: string | null;
  state: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  salaryText: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  postingUrl: string | null;
  sourceName: string;
  sourceType: string;
  datePosted: string | null;
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
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt?: string | null;
  discoveryCount?: number;
  materiallyUpdatedAt?: string | null;
  removedAt?: string | null;
  providerConfidence?: number | null;
  matchedFamilies?: string | null;
  active: boolean;
  clearanceRequirement: string | null;
  sponsorshipAvailable: boolean | null;
  estimatedExperienceYears: number | null;
  seniorityLevel: SeniorityLevel;
  score: number | null;
  recommendation: string | null;
  scoreExplanation: string | null;
  status: JobStatus;
  verificationStatus: string | null;
  eligibilityPassed: boolean | null;
  eligibilityRejection: string | null;
  workArrangement: string | null;
  illinoisEligibility: string | null;
  scheduleClassification: string | null;
  verifiedAt: string | null;
  scoreVersion: string | null;
  scoreInputHash: string | null;
}

export type JobForScoring = Omit<
  Job,
  | 'verificationStatus'
  | 'eligibilityPassed'
  | 'eligibilityRejection'
  | 'workArrangement'
  | 'illinoisEligibility'
  | 'scheduleClassification'
  | 'verifiedAt'
  | 'scoreVersion'
  | 'scoreInputHash'
>;
