import { z } from 'zod';

import {
  EMPLOYMENT_TYPES,
  REMOTE_TYPES,
  SENIORITY_LEVELS,
} from '../domain/job.js';
import { JOB_STATUSES } from '../domain/job-status.js';
import type {
  ClosingDatePrecision,
  ProviderLifecycleStatus,
} from '../domain/job-lifecycle.js';

const utcTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), 'Timestamp must use UTC (Z)');

export const normalizedJobSchema = z
  .strictObject({
    id: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    externalId: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1),
    normalizedTitle: z.string().trim().min(1),
    company: z.string().trim().min(1),
    normalizedCompany: z.string().trim().min(1),
    location: z.string().trim().min(1).nullable(),
    city: z.string().trim().min(1).nullable(),
    state: z.string().trim().min(1).nullable(),
    remoteType: z.enum(REMOTE_TYPES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    salaryMinimum: z.number().nonnegative().nullable(),
    salaryMaximum: z.number().nonnegative().nullable(),
    salaryText: z.string().trim().min(1).nullable(),
    description: z.string().trim().min(1).nullable(),
    requirements: z.string().trim().min(1).nullable(),
    preferredQualifications: z.string().trim().min(1).nullable(),
    postingUrl: z.url().nullable(),
    sourceName: z.string().trim().min(1),
    sourceType: z.string().trim().min(1),
    datePosted: utcTimestampSchema.nullable(),
    agency: z.string().trim().min(1).nullable(),
    department: z.string().trim().min(1).nullable(),
    gradeLow: z.string().trim().min(1).nullable(),
    gradeHigh: z.string().trim().min(1).nullable(),
    payPlan: z.string().trim().min(1).nullable(),
    appointmentType: z.string().trim().min(1).nullable(),
    workSchedule: z.string().trim().min(1).nullable(),
    teleworkEligible: z.boolean().nullable(),
    openingDate: utcTimestampSchema.nullable(),
    closingDate: utcTimestampSchema.nullable(),
    closingDatePrecision: z
      .custom<ClosingDatePrecision>()
      .pipe(z.enum(['date', 'instant']))
      .nullable(),
    providerLifecycleStatus: z
      .custom<ProviderLifecycleStatus>()
      .pipe(z.enum(['open', 'closed', 'unknown'])),
    applicationUrls: z.array(z.url()),
    firstSeenAt: utcTimestampSchema,
    lastSeenAt: utcTimestampSchema,
    active: z.boolean(),
    clearanceRequirement: z.string().trim().min(1).nullable(),
    sponsorshipAvailable: z.boolean().nullable(),
    estimatedExperienceYears: z.number().nonnegative().nullable(),
    seniorityLevel: z.enum(SENIORITY_LEVELS),
    score: z.number().min(0).max(100).nullable(),
    recommendation: z.string().trim().min(1).nullable(),
    scoreExplanation: z.string().trim().min(1).nullable(),
    status: z.enum(JOB_STATUSES),
  })
  .superRefine((job, context) => {
    if (
      job.salaryMinimum !== null &&
      job.salaryMaximum !== null &&
      job.salaryMaximum < job.salaryMinimum
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Salary maximum cannot be lower than salary minimum',
        path: ['salaryMaximum'],
      });
    }

    if (job.score !== null && job.scoreExplanation === null) {
      context.addIssue({
        code: 'custom',
        message: 'A score explanation is required when a score is present',
        path: ['scoreExplanation'],
      });
    }

    if (Date.parse(job.lastSeenAt) < Date.parse(job.firstSeenAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Last-seen timestamp cannot precede first-seen timestamp',
        path: ['lastSeenAt'],
      });
    }
  });

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
