import type { JobForScoring } from '../domain/job.js';
import type {
  CategoryScores,
  JobIntelligence,
  RecommendationStatus,
} from '../models/intelligence.js';
import type { WorkArrangement } from '../domain/verification.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import type { VerificationResult } from './verificationService.js';
import {
  analyzeGeographicEligibility,
  evaluateGeographicGate,
  recommendationCapFor,
} from './geographicEligibility.js';
import type {
  GeographicEligibility,
  RecommendationCap,
} from './geographicEligibility.js';
import { extractJobTerms, profileHasTerm } from '../skills/skillExtractor.js';
import { normalizeText } from '../utilities/normalization.js';

const SENIORITY_DOWN_RANK: readonly [RegExp, number][] = [
  [/^(chief|cto|ceo|cfo|executive)\b/i, 0],
  [/\b(vice president|vp|director)\b/i, 0.3],
  [/\b(principal|staff)\b/i, 0.5],
  [/\b(lead|manager)\b/i, 0.6],
  [/\b(senior|sr\.?)\b/i, 0.7],
];

const DAY_MS = 86_400_000;

export function scoreJob(
  job: JobForScoring,
  profile: CandidateProfile,
  config: ScoringConfig,
  analyzedAt = new Date().toISOString(),
  verification?: VerificationResult | null,
): JobIntelligence {
  const explanations: string[] = [];
  const missingQualifications: string[] = [];

  const geo = analyzeGeographicEligibility(job, profile);
  const verificationResult = applyVerification(
    verification ?? null,
    job,
    profile,
    config,
    explanations,
    geo,
  );

  if (verificationResult.hardBlock) {
    return {
      jobId: job.id,
      overallScore: 0,
      categoryScores: createZeroScores(),
      recommendationStatus: 'Hard No',
      explanations,
      missingQualifications,
      skills: [],
      certifications: [],
      analyzedAt,
      eligibilityPassed: false,
      eligibilityRejection: verificationResult.rejectionReason,
      verifiedStatus: verificationResult.verifiedStatus,
      workArrangement: verificationResult.workArrangement,
    };
  }

  const scoringJob =
    verificationResult.workArrangement === null ||
    verificationResult.workArrangement === 'unknown'
      ? job
      : { ...job, remoteType: verificationResult.workArrangement };
  if (scoringJob.remoteType !== 'remote') {
    if (geo.knowledge === 'unknown') {
      missingQualifications.push(
        'Work location could not be confirmed to be within the configured commute boundary.',
      );
    } else if (geo.knowledge === 'known_state_eligible') {
      missingQualifications.push(
        'Worksite is in a preferred state but the exact commute distance is unconfirmed.',
      );
    } else if (
      geo.knowledge === 'known_distant' ||
      geo.knowledge === 'known_state_ineligible'
    ) {
      missingQualifications.push(
        'Worksite is outside the configured commute boundary.',
      );
    }
  }
  const terms = extractJobTerms(scoringJob, config);

  const title = scoreTitle(scoringJob, profile, explanations);
  const skills = scoreTerms(
    terms.skills,
    config.skills,
    profile.skills,
    'skill',
    explanations,
    missingQualifications,
  );
  const certifications = scoreTerms(
    terms.certifications,
    config.certifications,
    profile.certifications,
    'certification',
    explanations,
    missingQualifications,
  );
  const location = scoreLocation(scoringJob, geo, profile, explanations);
  const remotePreference = scoreRemote(scoringJob, profile, explanations);
  const salary = scoreSalary(scoringJob, profile, explanations);
  const experience = scoreExperience(
    scoringJob,
    profile,
    explanations,
    missingQualifications,
  );
  const employmentType = scoreEmploymentType(scoringJob, profile, explanations);
  const recency = scoreRecency(scoringJob, config, analyzedAt, explanations);
  const categoryScores: CategoryScores = {
    title,
    skills,
    certifications,
    location,
    remotePreference,
    salary,
    experience,
    employmentType,
    recency,
  };
  const overallScore = roundScore(
    Object.entries(categoryScores).reduce(
      (total, [category, score]) =>
        total +
        score * (config.weights[category as keyof CategoryScores] / 100),
      0,
    ),
  );

  const finalScore =
    verificationResult.modifier !== null
      ? roundScore(overallScore * verificationResult.modifier)
      : overallScore;

  const recommendationStatus = recommend(
    scoringJob,
    profile,
    config,
    finalScore,
    verificationResult,
    recommendationCapFor(scoringJob.remoteType, geo),
  );

  explanations.unshift(
    `Overall weighted match score: ${finalScore.toFixed(1)}.`,
  );
  if (verificationResult.modifier !== null && verificationResult.modifier < 1) {
    explanations.push(
      `Score adjusted by ${String(Math.round((1 - verificationResult.modifier) * 100))}% due to posting condition.`,
    );
  }
  explanations.push(`Recommendation: ${recommendationStatus}.`);

  return {
    jobId: job.id,
    overallScore: finalScore,
    categoryScores,
    recommendationStatus,
    explanations,
    missingQualifications,
    skills: terms.skills,
    certifications: terms.certifications,
    analyzedAt,
    eligibilityPassed: verificationResult.eligibilityPassed,
    eligibilityRejection: verificationResult.rejectionReason,
    verifiedStatus: verificationResult.verifiedStatus,
    workArrangement: verificationResult.workArrangement,
  };
}

interface VerificationScoringResult {
  hardBlock: boolean;
  eligibilityPassed: boolean;
  rejectionReason: JobIntelligence['eligibilityRejection'];
  verifiedStatus: JobIntelligence['verifiedStatus'];
  modifier: number | null;
  workArrangement: WorkArrangement | null;
}

function applyVerification(
  verification: VerificationResult | null,
  job: JobForScoring,
  profile: CandidateProfile,
  config: ScoringConfig,
  explanations: string[],
  geo: GeographicEligibility,
): VerificationScoringResult {
  const cfg = config.verification;

  if (!cfg.enabled || verification === null) {
    explanations.push('Verification pass skipped or not configured.');
    return {
      hardBlock: false,
      eligibilityPassed: true,
      rejectionReason: 'none',
      verifiedStatus: null,
      modifier: null,
      workArrangement: null,
    };
  }

  let verifiedStatus: string | null = verification.evidence.status;
  const workArrangement =
    verification.workArrangement === 'unknown' &&
    (job.remoteType === 'onsite' || job.remoteType === 'hybrid')
      ? job.remoteType
      : verification.workArrangement;
  if (verification.evidence.status === 'closed') {
    explanations.push('Posting is closed.');
    return {
      hardBlock: true,
      eligibilityPassed: false,
      rejectionReason: 'closed',
      verifiedStatus: 'closed',
      modifier: null,
      workArrangement,
    };
  }

  if (cfg.eligibilityGate && !verification.eligibility.passed) {
    explanations.push(
      `Hard eligibility gate failed: ${String(verification.eligibility.rejectionDetail)}.`,
    );
    return {
      hardBlock: true,
      eligibilityPassed: false,
      rejectionReason: verification.eligibility.rejectionReason,
      verifiedStatus,
      modifier: null,
      workArrangement,
    };
  }

  if (verification.illinoisEligibility === 'excluded') {
    explanations.push(
      'Hard eligibility gate failed: Remote position explicitly excludes Illinois.',
    );
    return {
      hardBlock: true,
      eligibilityPassed: false,
      rejectionReason: 'illinois_excluded',
      verifiedStatus,
      modifier: null,
      workArrangement,
    };
  }

  const remoteRegion = verification.remoteRegion;
  if (
    workArrangement === 'remote' &&
    remoteRegion !== undefined &&
    remoteRegion.restricted &&
    remoteRegion.states.length > 0
  ) {
    const preferredStates = profile.preferredLocations
      .map((location) => location.state.trim().toUpperCase())
      .filter((state) => state !== '');
    const allowed = remoteRegion.states.filter((state) =>
      preferredStates.includes(state),
    );
    const restrictedPhrase = remoteRegion.states.join(', ');
    if (allowed.length === 0) {
      explanations.push(
        `Hard eligibility gate failed: remote work is restricted to ${restrictedPhrase}, and the candidate is outside the permitted region.`,
      );
      return {
        hardBlock: true,
        eligibilityPassed: false,
        rejectionReason: 'remote_region_ineligible',
        verifiedStatus,
        modifier: null,
        workArrangement,
      };
    }
    explanations.push(
      `Remote work is restricted to ${restrictedPhrase}; the candidate is within the permitted region.`,
    );
  }

  const extracted = verification.extractedRequirements;
  if (
    extracted.professionalEngineering &&
    !profileHasEngineeringCredential(profile)
  ) {
    explanations.push(
      'Hard eligibility gate failed: Professional engineering basic qualification required.',
    );
    return {
      hardBlock: true,
      eligibilityPassed: false,
      rejectionReason: 'professional_engineering_required',
      verifiedStatus,
      modifier: null,
      workArrangement,
    };
  }

  if (
    extracted.clearanceMode === 'active' &&
    profile.clearanceEligibility !== 'eligible'
  ) {
    explanations.push(
      `Hard eligibility gate failed: Active ${extracted.clearanceLevel ?? 'security'} clearance required and the profile does not evidence holding it.`,
    );
    return {
      hardBlock: true,
      eligibilityPassed: false,
      rejectionReason: 'clearance_required',
      verifiedStatus,
      modifier: null,
      workArrangement,
    };
  }
  if (
    extracted.clearanceMode === 'obtainable' ||
    extracted.clearanceMode === 'eligible' ||
    extracted.clearanceMode === 'ambiguous' ||
    extracted.clearanceMode === 'public-trust'
  ) {
    explanations.push(
      `Clearance wording present (${extracted.clearanceMode}); not a hard rejection without an active clearance requirement.`,
    );
  }

  if (workArrangement === 'remote') {
    const remoteEligibility =
      verification.illinoisEligibility === 'eligible' ||
      verification.illinoisEligibility === 'unrestricted'
        ? 'eligible'
        : 'unknown';
    explanations.push(
      `Remote position: commute_status=not_applicable, remote_eligibility=${remoteEligibility}, illinois_eligibility=${verification.illinoisEligibility}`,
    );
  } else {
    const arrangementLabel =
      workArrangement === 'onsite'
        ? 'Onsite'
        : workArrangement === 'hybrid'
          ? 'Hybrid'
          : 'Unknown work arrangement; commute boundary applies';
    const gate = evaluateGeographicGate(workArrangement, geo);
    for (const evidence of geo.evidence) {
      explanations.push(`${arrangementLabel}: ${evidence}`);
    }
    if (gate.block && gate.explanation !== null) {
      explanations.push(`Location eligibility gate failed: ${gate.explanation}`);
      return {
        hardBlock: true,
        eligibilityPassed: false,
        rejectionReason: 'location_outside_radius',
        verifiedStatus,
        modifier: null,
        workArrangement,
      };
    }
    if (gate.explanation !== null) {
      explanations.push(gate.explanation);
    }
    if (geo.knowledge === 'unknown') {
      explanations.push(
        'Location cannot be confirmed; retaining job with unknown location status.',
      );
    } else if (geo.knowledge === 'known_state_eligible') {
      explanations.push(
        'Location eligibility gate passed; job is in a preferred state, exact distance unavailable.',
      );
    } else if (geo.knowledge === 'known_local') {
      explanations.push('Location eligibility gate passed.');
    }
  }

  verifiedStatus = 'verified';
  explanations.push('Verification pass succeeded.');

  return {
    hardBlock: false,
    eligibilityPassed: true,
    rejectionReason: 'none',
    verifiedStatus,
    modifier: null,
    workArrangement,
  };
}

function scoreTitle(
  job: JobForScoring,
  profile: CandidateProfile,
  explanations: string[],
): number {
  const title = normalizeText(job.title);
  const excluded = profile.excludedJobTitles.some((value) =>
    title.includes(normalizeText(value)),
  );
  if (excluded) {
    explanations.push('Title matches an excluded job-title rule.');
    return 0;
  }

  let best = 0;
  for (const desired of profile.desiredJobTitles) {
    const normalizedDesired = normalizeText(desired);
    if (title === normalizedDesired) {
      explanations.push('Excellent title match.');
      best = 100;
      break;
    }
    if (title.includes(normalizedDesired) || normalizedDesired.includes(title))
      best = Math.max(best, 90);
    best = Math.max(best, tokenSimilarity(title, normalizedDesired) * 100);
  }

  if (
    job.matchedFamilies !== null &&
    job.matchedFamilies !== undefined &&
    job.matchedFamilies.length > 0
  ) {
    const familyBonus = best > 0 ? 5 : 20;
    best = Math.min(100, best + familyBonus);
    explanations.push(
      `Job matches role famil${job.matchedFamilies.includes(',') ? 'ies' : 'y'}: ${job.matchedFamilies}.`,
    );
  }

  for (const [pattern, multiplier] of SENIORITY_DOWN_RANK) {
    if (pattern.test(title)) {
      best = roundScore(best * multiplier);
      explanations.push(
        `Seniority level (${pattern.source}) adjusted score by ${String(multiplier * 100)}%.`,
      );
      break;
    }
  }

  const result = roundScore(best);
  if (result < 70) {
    explanations.push('Limited title match.');
  }
  return result;
}

function scoreTerms(
  extracted: JobIntelligence['skills'],
  catalog: ScoringConfig['skills'],
  profileValues: readonly string[],
  label: 'skill' | 'certification',
  explanations: string[],
  missing: string[],
): number {
  if (extracted.length === 0) {
    explanations.push(`No ${label} requirements were identified.`);
    return 60;
  }

  let matched = 0;
  for (const term of extracted) {
    const entry = catalog.find((candidate) => candidate.name === term.name);
    const possessed =
      entry !== undefined && profileHasTerm(profileValues, entry);
    if (possessed) {
      matched += 1;
      explanations.push(
        `Requires ${term.name}, which the candidate possesses.`,
      );
    } else {
      const message = `Missing requested ${label}: ${term.name}.`;
      explanations.push(message);
      missing.push(message);
    }
  }
  return roundScore((matched / extracted.length) * 100);
}

function scoreLocation(
  job: JobForScoring,
  geo: GeographicEligibility,
  profile: CandidateProfile,
  explanations: string[],
): number {
  if (job.remoteType === 'remote') {
    explanations.push('Remote role satisfies location constraints.');
    return 100;
  }
  if (geo.knowledge === 'known_local' && geo.distanceMiles !== null) {
    explanations.push(
      `Worksite is ${String(geo.distanceMiles)} miles from a preferred location; within the configured ${String(profile.searchRadiusMiles)}-mile commute boundary.`,
    );
    return 100;
  }
  if (geo.knowledge === 'known_state_eligible') {
    explanations.push(
      `Worksite is in a preferred state; exact distance against the ${String(profile.searchRadiusMiles)}-mile radius is unavailable.`,
    );
    return 60;
  }
  if (
    geo.knowledge === 'known_distant' ||
    geo.knowledge === 'known_state_ineligible'
  ) {
    explanations.push(
      'Worksite is outside the configured commute boundary.',
    );
    return 0;
  }
  explanations.push(
    'Location is not specific enough to confirm commute eligibility.',
  );
  return 30;
}

function scoreRemote(
  job: JobForScoring,
  profile: CandidateProfile,
  explanations: string[],
): number {
  if (job.remoteType === 'remote') {
    if (profile.remotePreference === 'not-preferred') {
      explanations.push('Remote work is not preferred.');
      return 30;
    }
    explanations.push('Remote arrangement matches the candidate preference.');
    return profile.remotePreference === 'preferred' ? 100 : 90;
  }
  if (job.remoteType === 'hybrid') {
    explanations.push(
      'Hybrid arrangement is acceptable when commuting is realistic.',
    );
    return 75;
  }
  if (job.remoteType === 'unknown') {
    explanations.push(
      'Work arrangement is unknown; remote preference cannot be confirmed.',
    );
    return 50;
  }
  if (profile.remotePreference === 'preferred') {
    explanations.push(
      'On-site work is less desirable than the remote preference.',
    );
    return 40;
  }
  return 75;
}

function scoreSalary(
  job: JobForScoring,
  profile: CandidateProfile,
  explanations: string[],
): number {
  if (job.salaryMinimum === null && job.salaryMaximum === null) {
    explanations.push('Salary not listed.');
    return 50;
  }
  if (profile.desiredSalary === null) {
    explanations.push(
      'No desired salary is configured, so listed salary is neutral.',
    );
    return 60;
  }
  const effectiveSalary = job.salaryMaximum ?? job.salaryMinimum ?? 0;
  if (effectiveSalary >= profile.desiredSalary.target) {
    explanations.push('Salary meets or exceeds the target.');
    return 100;
  }
  if (effectiveSalary >= profile.desiredSalary.minimum) {
    explanations.push('Salary meets the configured minimum.');
    return 75;
  }
  explanations.push('Salary is below the configured minimum.');
  return 20;
}

function scoreExperience(
  job: JobForScoring,
  profile: CandidateProfile,
  explanations: string[],
  missing: string[],
): number {
  if (job.estimatedExperienceYears === null) {
    explanations.push('Required experience could not be determined.');
    return 60;
  }
  if (profile.yearsOfExperience === null) {
    explanations.push('Candidate experience years are not configured.');
    return 60;
  }
  const gap = job.estimatedExperienceYears - profile.yearsOfExperience;
  if (gap <= 0) {
    explanations.push('Candidate meets the stated experience requirement.');
    return 100;
  }
  const message = `Missing ${gap.toFixed(1)} years of requested experience.`;
  missing.push(message);
  explanations.push(message);
  return gap <= 2 ? 60 : 20;
}

function scoreEmploymentType(
  job: JobForScoring,
  profile: CandidateProfile,
  explanations: string[],
): number {
  const matched = profile.desiredEmploymentTypes.includes(job.employmentType);
  explanations.push(
    matched
      ? 'Employment type matches preferences.'
      : 'Employment type is not preferred.',
  );
  return matched ? 100 : 30;
}

function scoreRecency(
  job: JobForScoring,
  config: ScoringConfig,
  analyzedAt: string,
  explanations: string[],
): number {
  const sourceDate = job.datePosted ?? job.firstSeenAt;
  const ageDays = Math.max(
    0,
    (Date.parse(analyzedAt) - Date.parse(sourceDate)) / DAY_MS,
  );
  if (ageDays <= config.recency.freshDays) {
    explanations.push('Recently posted opportunity.');
    return 100;
  }
  if (ageDays <= config.recency.recentDays) {
    explanations.push('Posting is still reasonably recent.');
    return 70;
  }
  explanations.push('Posting is older than the configured recency window.');
  return 30;
}

function recommend(
  job: JobForScoring,
  profile: CandidateProfile,
  config: ScoringConfig,
  score: number,
  verificationResult: VerificationScoringResult,
  cap: RecommendationCap,
): RecommendationStatus {
  if (
    job.status === 'applied' ||
    job.status === 'interview' ||
    job.status === 'offer' ||
    job.status === 'rejected'
  ) {
    return 'Already Applied';
  }
  if (!job.active || job.status === 'expired') return 'Expired';
  if (
    job.status === 'ignored' ||
    profile.excludedJobTitles.some((title) =>
      normalizeText(job.title).includes(normalizeText(title)),
    )
  ) {
    return 'Hidden';
  }
  const title = normalizeText(job.title);
  const tooSeniorPatterns = [
    /^(chief|cto|ceo|cfo|executive)\b/i,
    /\b(vice president|vp|director)\b/i,
  ];
  const hasDesiredExact = profile.desiredJobTitles.some(
    (t) => normalizeText(t) === title,
  );
  if (!hasDesiredExact && tooSeniorPatterns.some((p) => p.test(title))) {
    return 'Hidden';
  }

  if (verificationResult.verifiedStatus === 'verified') {
    const thresholds = config.recommendationThresholds;
    if (score >= thresholds.applyImmediately && cap === 'none') {
      return 'Verified Match';
    }
    if (score >= thresholds.applyImmediately && cap === 'strong') {
      return 'Strong Match';
    }
  }

  const thresholds = config.recommendationThresholds;
  if (score >= thresholds.applyImmediately) return 'Apply Immediately';
  if (score >= thresholds.strongMatch) return 'Strong Match';
  if (score >= thresholds.possibleMatch) return 'Possible Match';
  return 'Weak Match';
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function roundScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function profileHasEngineeringCredential(profile: CandidateProfile): boolean {
  const hasEngineeringDegree = profile.degrees.some((degree) =>
    /\bengineering\b/i.test(degree.name),
  );
  const hasEngineeringCredential = profile.certifications.some((cert) =>
    /professional\s+engineer|\bpe\s+license|\b(eit|fe)\b|fundamentals\s+of\s+engineering/i.test(
      cert,
    ),
  );
  return hasEngineeringDegree || hasEngineeringCredential;
}

function createZeroScores(): CategoryScores {
  return {
    title: 0,
    skills: 0,
    certifications: 0,
    location: 0,
    remotePreference: 0,
    salary: 0,
    experience: 0,
    employmentType: 0,
    recency: 0,
  };
}
