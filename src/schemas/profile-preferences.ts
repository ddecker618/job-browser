import { z } from 'zod';

import { searchProfileSchema } from '../config/search-profile.js';
import { candidateProfileSchema } from './candidate-profile.js';
import { EMPLOYMENT_TYPES } from '../domain/job.js';
import { scoringConfigSchema } from './scoring-config.js';

const candidateShape = candidateProfileSchema.shape;
const searchProfileShape = searchProfileSchema.shape;

const candidatePreferencesSchema = z.strictObject({
  id: candidateShape.id,
  name: candidateShape.name,
  skills: candidateShape.skills,
  certifications: candidateShape.certifications,
  degrees: candidateShape.degrees,
  clearanceEligibility: candidateShape.clearanceEligibility,
  yearsOfExperience: candidateShape.yearsOfExperience,
});

const jobPreferencesSchema = z.strictObject({
  preferredLocations: candidateShape.preferredLocations,
  searchRadiusMiles: candidateShape.searchRadiusMiles,
  secondarySearchRadiusMiles: candidateShape.secondarySearchRadiusMiles,
  remotePreference: candidateShape.remotePreference,
  desiredSalary: candidateShape.desiredSalary,
  desiredJobTitles: candidateShape.desiredJobTitles,
  excludedJobTitles: candidateShape.excludedJobTitles,
  desiredEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
  education: z.strictObject({
    degreeRequired: candidateShape.degreeRequired,
    degreeInProgressOk: candidateShape.degreeInProgressOk,
  }),
  travel: z.strictObject({
    maxTravelPercent: candidateShape.maxTravelPercent,
  }),
  schedule: z.strictObject({
    noWeekends: candidateShape.noWeekends,
    noOnCall: candidateShape.noOnCall,
    noRotatingShifts: candidateShape.noRotatingShifts,
    noOvernightShifts: candidateShape.noOvernightShifts,
  }),
});

const discoveryPreferencesSchema = z.strictObject({
  roleFamilies: searchProfileShape.families,
  sourceQueryRoles: z.array(z.string().trim().min(1)),
  prioritizeRemote: searchProfileShape.prioritizeRemote,
  maxOnsiteDistanceMiles: searchProfileShape.maxOnsiteDistanceMiles,
  preferredLocation: searchProfileShape.preferredLocation,
  maxExperienceYears: searchProfileShape.maxExperienceYears,
  maxQueriesPerRun: searchProfileShape.maxQueriesPerRun,
});

export const profilePreferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidate: candidatePreferencesSchema,
  jobPreferences: jobPreferencesSchema,
  discovery: discoveryPreferencesSchema,
  scoring: scoringConfigSchema,
});

export type ProfilePreferences = z.infer<typeof profilePreferencesSchema>;
export type CandidatePreferences = ProfilePreferences['candidate'];
export type JobPreferences = ProfilePreferences['jobPreferences'];
export type DiscoveryPreferences = ProfilePreferences['discovery'];
