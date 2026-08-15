export const VERIFICATION_STATUSES = [
  'verified',
  'closed',
  'unverified',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const WORK_ARRANGEMENTS = [
  'remote',
  'hybrid',
  'onsite',
  'unknown',
] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const SCHEDULE_TYPES = [
  'daytime',
  'evening',
  'overnight',
  'rotating',
  'weekend',
  'onCall',
  'flexible',
  'unknown',
] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const ILLINOIS_ELIGIBILITY = [
  'eligible',
  'excluded',
  'unrestricted',
  'unknown',
] as const;
export type IllinoisEligibility = (typeof ILLINOIS_ELIGIBILITY)[number];

export const ELIGIBILITY_REJECTION_REASONS = [
  'closed',
  'illinois_excluded',
  'location_outside_radius',
  'location_unknown',
  'remote_region_ineligible',
  'overnight_schedule',
  'rotating_nights',
  'weekend_coverage',
  'clearance_required',
  'professional_engineering_required',
  'sales_position',
  'software_development',
  'field_installation',
  'already_applied',
  'dismissed',
  'none',
] as const;
export type EligibilityRejectionReason =
  (typeof ELIGIBILITY_REJECTION_REASONS)[number];

export interface VerificationEvidence {
  status: VerificationStatus;
  verifiedAt: string;
  verificationSource: string;
  httpStatus: number | null;
  applicationStatus: string | null;
  evidence: string[];
  closedIndicators: string[];
}

export interface ScheduleEvidence {
  classification: ScheduleType;
  evidence: string[];
  riskIndicators: string[];
  positiveIndicators: string[];
}

export interface EligibilityResult {
  passed: boolean;
  rejectionReason: EligibilityRejectionReason;
  rejectionDetail: string | null;
}

export enum RequirementCategory {
  Required = 'required',
  Preferred = 'preferred',
  NiceToHave = 'niceToHave',
  EmployerProvided = 'employerProvided',
  Ambiguous = 'ambiguous',
}

export interface ExtractedRequirement {
  text: string;
  category: RequirementCategory;
}
