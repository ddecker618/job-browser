import type { CandidateProfile } from '../schemas/candidate-profile.js';
import { candidateProfileSchema } from '../schemas/candidate-profile.js';
import type { SearchProfile } from '../config/search-profile.js';
import { searchProfileSchema } from '../config/search-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { scoringConfigSchema } from '../schemas/scoring-config.js';
import {
  profilePreferencesSchema,
  type ProfilePreferences,
} from '../schemas/profile-preferences.js';

export interface LegacyPreferences {
  candidateProfile: CandidateProfile;
  searchProfile: SearchProfile;
  sourceQueryRoles: string[];
  scoringConfig: ScoringConfig;
}

export interface LegacyPreferencesInput {
  candidateProfile: CandidateProfile;
  searchProfile: SearchProfile;
  sourceQueryRoles: string[];
  scoringConfig: ScoringConfig;
}

export function fromLegacyPreferences(
  input: LegacyPreferencesInput,
): ProfilePreferences {
  const candidate = candidateProfileSchema.parse(input.candidateProfile);
  const searchProfile = searchProfileSchema.parse(input.searchProfile);
  const scoringConfig = scoringConfigSchema.parse(input.scoringConfig);

  return profilePreferencesSchema.parse({
    schemaVersion: 1,
    candidate: {
      id: candidate.id,
      name: candidate.name,
      skills: candidate.skills,
      certifications: candidate.certifications,
      degrees: candidate.degrees,
      clearanceEligibility: candidate.clearanceEligibility,
      yearsOfExperience: candidate.yearsOfExperience,
    },
    jobPreferences: {
      preferredLocations: candidate.preferredLocations,
      searchRadiusMiles: candidate.searchRadiusMiles,
      secondarySearchRadiusMiles: candidate.secondarySearchRadiusMiles,
      remotePreference: candidate.remotePreference,
      desiredSalary: candidate.desiredSalary,
      desiredJobTitles: candidate.desiredJobTitles,
      excludedJobTitles: candidate.excludedJobTitles,
      desiredEmploymentTypes: candidate.desiredEmploymentTypes,
      education: {
        degreeRequired: candidate.degreeRequired,
        degreeInProgressOk: candidate.degreeInProgressOk,
      },
      travel: {
        maxTravelPercent: candidate.maxTravelPercent,
      },
      schedule: {
        noWeekends: candidate.noWeekends,
        noOnCall: candidate.noOnCall,
        noRotatingShifts: candidate.noRotatingShifts,
        noOvernightShifts: candidate.noOvernightShifts,
      },
    },
    discovery: {
      roleFamilies: searchProfile.families,
      sourceQueryRoles: input.sourceQueryRoles,
      prioritizeRemote: searchProfile.prioritizeRemote,
      maxOnsiteDistanceMiles: searchProfile.maxOnsiteDistanceMiles,
      preferredLocation: searchProfile.preferredLocation,
      maxExperienceYears: searchProfile.maxExperienceYears,
      maxQueriesPerRun: searchProfile.maxQueriesPerRun,
    },
    scoring: scoringConfig,
  });
}

export function toLegacyPreferences(
  document: ProfilePreferences,
): LegacyPreferences {
  const parsed = profilePreferencesSchema.parse(document);
  const { candidate, jobPreferences, discovery } = parsed;

  const candidateProfile = candidateProfileSchema.parse({
    id: candidate.id,
    name: candidate.name,
    preferredLocations: jobPreferences.preferredLocations,
    searchRadiusMiles: jobPreferences.searchRadiusMiles,
    secondarySearchRadiusMiles: jobPreferences.secondarySearchRadiusMiles,
    remotePreference: jobPreferences.remotePreference,
    desiredSalary: jobPreferences.desiredSalary,
    certifications: candidate.certifications,
    degrees: candidate.degrees,
    skills: candidate.skills,
    clearanceEligibility: candidate.clearanceEligibility,
    yearsOfExperience: candidate.yearsOfExperience,
    desiredJobTitles: jobPreferences.desiredJobTitles,
    excludedJobTitles: jobPreferences.excludedJobTitles,
    desiredEmploymentTypes: jobPreferences.desiredEmploymentTypes,
    degreeRequired: jobPreferences.education.degreeRequired,
    degreeInProgressOk: jobPreferences.education.degreeInProgressOk,
    maxTravelPercent: jobPreferences.travel.maxTravelPercent,
    noWeekends: jobPreferences.schedule.noWeekends,
    noOnCall: jobPreferences.schedule.noOnCall,
    noRotatingShifts: jobPreferences.schedule.noRotatingShifts,
    noOvernightShifts: jobPreferences.schedule.noOvernightShifts,
  });

  const searchProfile = searchProfileSchema.parse({
    families: discovery.roleFamilies,
    prioritizeRemote: discovery.prioritizeRemote,
    maxOnsiteDistanceMiles: discovery.maxOnsiteDistanceMiles,
    preferredLocation: discovery.preferredLocation,
    maxExperienceYears: discovery.maxExperienceYears,
    maxQueriesPerRun: discovery.maxQueriesPerRun,
  });

  return {
    candidateProfile,
    searchProfile,
    sourceQueryRoles: [...discovery.sourceQueryRoles],
    scoringConfig: scoringConfigSchema.parse(parsed.scoring),
  };
}
