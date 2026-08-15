import { z } from 'zod';

import {
  EMPLOYMENT_TYPES,
  REMOTE_TYPES,
  SENIORITY_LEVELS,
} from '../domain/job.js';
import { SCHEDULE_TYPES } from '../domain/verification.js';

// ---------------------------------------------------------------------------
// Canonical structured role details.
//
// Deterministic, evidence-backed extraction from retained job evidence. Every
// derived fact carries the evidence that produced it so downstream consumers
// (Job Detail, eligibility, scoring, filtering, Discovery, analytics) can audit
// how a value was reached. The model is versioned independently from scoring
// rules: ROLE_DETAILS_VERSION changes only when the extraction contract or its
// determinism semantics change.
// ---------------------------------------------------------------------------

export const ROLE_DETAILS_VERSION = 'role-details-v2';

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);

export const workplaceArrangementSchema = z.enum(REMOTE_TYPES);

export const clearanceModeSchema = z.enum([
  'active',
  'obtainable',
  'eligible',
  'public-trust',
  'ambiguous',
  'none',
  'unknown',
]);

export const degreeLevelSchema = z.enum([
  'none',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'unknown',
]);

export const scheduleClassificationSchema = z.enum(SCHEDULE_TYPES);

export const scheduleFlagSchema = z.enum([
  'weekends',
  'onCall',
  'rotating',
  'overnight',
  'evening',
]);

export const roleDetailsSchema = z.strictObject({
  version: z.literal(ROLE_DETAILS_VERSION),
  generatedAt: z.string(),
  sourceTextHash: z.string(),
  workplace: z.strictObject({
    arrangement: workplaceArrangementSchema,
    source: z.enum(['provider', 'description', 'unknown']),
    evidence: z.array(z.string()),
  }),
  employment: z.strictObject({
    type: employmentTypeSchema,
    source: z.enum(['provider', 'description', 'unknown']),
    evidence: z.array(z.string()),
  }),
  locations: z.strictObject({
    primaryCity: z.string().nullable(),
    primaryState: z.string().nullable(),
    remoteCapable: z.boolean(),
    multiple: z.boolean(),
    evidence: z.array(z.string()),
  }),
  clearance: z.strictObject({
    mode: clearanceModeSchema,
    level: z.string().nullable(),
    sponsorable: z.boolean(),
    evidence: z.array(z.string()),
  }),
  education: z.strictObject({
    degreeRequired: degreeLevelSchema,
    degreeInProgressOk: z.boolean(),
    field: z.string().nullable(),
    evidence: z.array(z.string()),
  }),
  experience: z.strictObject({
    requiredYears: z.number().nullable(),
    preferredYears: z.number().nullable(),
    substitution: z.array(z.string()),
    evidence: z.array(z.string()),
  }),
  skills: z.strictObject({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
  }),
  technologies: z.array(z.string()),
  certifications: z.strictObject({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
  }),
  occupationalSeries: z.array(z.string()),
  citizenship: z.strictObject({
    usCitizenRequired: z.boolean(),
    evidence: z.array(z.string()),
  }),
  travel: z.strictObject({
    required: z.boolean(),
    percent: z.number().nullable(),
    evidence: z.array(z.string()),
  }),
  schedule: z.strictObject({
    classification: scheduleClassificationSchema,
    flags: z.array(scheduleFlagSchema),
    evidence: z.array(z.string()),
  }),
  contingentConditions: z.strictObject({
    commissionBased: z.boolean(),
    physicalRequirements: z.boolean(),
    fieldInstallation: z.boolean(),
    developmentFocused: z.boolean(),
    professionalEngineering: z.boolean(),
    contingentOnAward: z.boolean(),
    evidence: z.array(z.string()),
  }),
});

export type RoleDetails = z.infer<typeof roleDetailsSchema>;
export type WorkplaceArrangement = (typeof REMOTE_TYPES)[number];
export type ClearanceMode = z.infer<typeof clearanceModeSchema>;
export type DegreeLevel = z.infer<typeof degreeLevelSchema>;
export type ScheduleClassification = z.infer<
  typeof scheduleClassificationSchema
>;
export type ScheduleFlag = z.infer<typeof scheduleFlagSchema>;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
