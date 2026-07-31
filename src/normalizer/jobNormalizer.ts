import { randomUUID } from 'node:crypto';

import type {
  EmploymentType,
  RemoteType,
  SeniorityLevel,
} from '../domain/job.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { generateJobFingerprint } from '../utils/fingerprint.js';
import { normalizeText } from '../utilities/normalization.js';

export interface NormalizedJobInput {
  externalId: string | null;
  title: string;
  company: string;
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
  providerId: string;
  providerName: string;
  datePosted: string | null;
  discoveredAt: string;
  seniorityLevel?: SeniorityLevel;
  agency?: string | null;
  department?: string | null;
  gradeLow?: string | null;
  gradeHigh?: string | null;
  payPlan?: string | null;
  appointmentType?: string | null;
  workSchedule?: string | null;
  teleworkEligible?: boolean | null;
  openingDate?: string | null;
  closingDate?: string | null;
  applicationUrls?: string[];
  requisitionId?: string | null;
}

export function normalizeJob(input: NormalizedJobInput): NormalizedJob {
  const title = input.title.trim();
  const company = input.company.trim();
  const location = cleanNullable(input.location);

  return {
    id: randomUUID(),
    fingerprint: generateJobFingerprint({
      company,
      title,
      location,
      postingUrl: input.postingUrl,
      externalId: input.externalId,
      employmentType: input.employmentType,
      requisitionId: input.requisitionId,
    }),
    externalId: cleanNullable(input.externalId),
    title,
    normalizedTitle: normalizeText(title),
    company,
    normalizedCompany: normalizeText(company),
    location,
    city: cleanNullable(input.city),
    state: cleanNullable(input.state),
    remoteType: input.remoteType,
    employmentType: input.employmentType,
    salaryMinimum: input.salaryMinimum,
    salaryMaximum: input.salaryMaximum,
    salaryText: cleanNullable(input.salaryText),
    description: cleanNullable(input.description),
    requirements: cleanNullable(input.requirements),
    preferredQualifications: cleanNullable(input.preferredQualifications),
    postingUrl: cleanNullable(input.postingUrl),
    sourceName: input.providerName,
    sourceType: input.providerId,
    datePosted: input.datePosted,
    agency: cleanNullable(input.agency ?? null),
    department: cleanNullable(input.department ?? null),
    gradeLow: cleanNullable(input.gradeLow ?? null),
    gradeHigh: cleanNullable(input.gradeHigh ?? null),
    payPlan: cleanNullable(input.payPlan ?? null),
    appointmentType: cleanNullable(input.appointmentType ?? null),
    workSchedule: cleanNullable(input.workSchedule ?? null),
    teleworkEligible: input.teleworkEligible ?? null,
    openingDate: input.openingDate ?? null,
    closingDate: input.closingDate ?? null,
    applicationUrls: input.applicationUrls ?? [],
    firstSeenAt: input.discoveredAt,
    lastSeenAt: input.discoveredAt,
    active: true,
    clearanceRequirement: null,
    sponsorshipAvailable: null,
    estimatedExperienceYears: null,
    seniorityLevel: input.seniorityLevel ?? 'unknown',
    score: null,
    recommendation: null,
    scoreExplanation: null,
    status: 'new',
  };
}

function cleanNullable(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}
