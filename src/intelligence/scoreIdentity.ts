import { createHash } from 'node:crypto';

import type { JobForScoring } from '../domain/job.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import type { VerificationResult } from './verificationService.js';
import { SCORING_RULES_VERSION } from './scoringVersion.js';

export function createScoreVersion(
  profile: CandidateProfile,
  config: ScoringConfig,
): string {
  return hashPayload({
    rules: SCORING_RULES_VERSION,
    profile,
    config,
  });
}

export function createScoreInputHash(
  job: JobForScoring,
  profile: CandidateProfile,
  config: ScoringConfig,
  verification: VerificationResult,
): string {
  return hashPayload({
    rules: SCORING_RULES_VERSION,
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      city: job.city,
      state: job.state,
      remoteType:
        verification.workArrangement === 'unknown'
          ? job.remoteType
          : verification.workArrangement,
      employmentType: job.employmentType,
      salaryMinimum: job.salaryMinimum,
      salaryMaximum: job.salaryMaximum,
      description: job.description,
      requirements: job.requirements,
      preferredQualifications: job.preferredQualifications,
      datePosted: job.datePosted,
      active: job.active,
      status: job.status,
      matchedFamilies: job.matchedFamilies,
    },
    profile,
    config,
    verification: {
      evidence: {
        status: verification.evidence.status,
        verificationSource: verification.evidence.verificationSource,
        httpStatus: verification.evidence.httpStatus,
        applicationStatus: verification.evidence.applicationStatus,
        closedIndicators: verification.evidence.closedIndicators,
      },
      workArrangement: verification.workArrangement,
      illinoisEligibility: verification.illinoisEligibility,
      remoteRegion: verification.remoteRegion,
      schedule: verification.schedule,
      eligibility: verification.eligibility,
      extractedRequirements: verification.extractedRequirements,
    },
  });
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
