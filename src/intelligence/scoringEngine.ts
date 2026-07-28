import type { JobForScoring } from '../domain/job.js';
import type {
  CategoryScores,
  JobIntelligence,
  RecommendationStatus,
} from '../models/intelligence.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import type { VerificationResult } from './verificationService.js';
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
  const terms = extractJobTerms(job, config);
  const explanations: string[] = [];
  const missingQualifications: string[] = [];

  const verificationResult = applyVerification(
    verification ?? null,
    profile,
    config,
    explanations,
  );

  if (verificationResult.hardBlock) {
    return {
      jobId: job.id,
      overallScore: 0,
      categoryScores: createZeroScores(),
      recommendationStatus: 'Hard No',
      explanations,
      missingQualifications,
      skills: terms.skills,
      certifications: terms.certifications,
      analyzedAt,
      eligibilityPassed: false,
      eligibilityRejection: verificationResult.rejectionReason,
      verifiedStatus: verificationResult.verifiedStatus,
    };
  }

  const title = scoreTitle(job, profile, explanations);
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
  const location = scoreLocation(job, profile, explanations);
  const remotePreference = scoreRemote(job, profile, explanations);
  const salary = scoreSalary(job, profile, explanations);
  const experience = scoreExperience(
    job,
    profile,
    explanations,
    missingQualifications,
  );
  const employmentType = scoreEmploymentType(job, profile, explanations);
  const recency = scoreRecency(job, config, analyzedAt, explanations);
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
    job,
    profile,
    config,
    finalScore,
    verificationResult,
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
  };
}

interface VerificationScoringResult {
  hardBlock: boolean;
  eligibilityPassed: boolean;
  rejectionReason: JobIntelligence['eligibilityRejection'];
  verifiedStatus: JobIntelligence['verifiedStatus'];
  modifier: number | null;
}

function applyVerification(
  verification: VerificationResult | null,
  profile: CandidateProfile,
  config: ScoringConfig,
  explanations: string[],
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
    };
  }

  let verifiedStatus: string | null = verification.evidence.status;
  if (verification.evidence.status === 'closed') {
    explanations.push('Posting is closed.');
    return {
      hardBlock: false,
      eligibilityPassed: true,
      rejectionReason: 'closed',
      verifiedStatus: 'closed',
      modifier: 0,
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
    };
  }

  if (verification.workArrangement === 'onsite') {
    explanations.push('Onsite position at non-remote employer.');
    return {
      hardBlock: false,
      eligibilityPassed: true,
      rejectionReason: 'location_outside_radius',
      verifiedStatus,
      modifier: 0.5,
    };
  }

  verifiedStatus = 'verified';
  explanations.push('Verification pass succeeded.');

  return {
    hardBlock: false,
    eligibilityPassed: true,
    rejectionReason: 'none',
    verifiedStatus,
    modifier: null,
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
  profile: CandidateProfile,
  explanations: string[],
): number {
  if (job.remoteType === 'remote') {
    explanations.push('Remote role satisfies location constraints.');
    return 100;
  }
  if (job.city === null && job.state === null) {
    explanations.push('Location is not specific enough to calculate distance.');
    return 50;
  }
  const exact = profile.preferredLocations.some(
    (location) =>
      normalizeText(location.city) === normalizeText(job.city ?? '') &&
      normalizeText(location.state) === normalizeText(job.state ?? ''),
  );
  if (exact) {
    explanations.push('Job is in a preferred city.');
    return 100;
  }
  const sameState = profile.preferredLocations.some(
    (location) =>
      normalizeText(location.state) === normalizeText(job.state ?? ''),
  );
  if (sameState) {
    explanations.push(
      `Job is in a preferred state; exact distance against the ${String(profile.searchRadiusMiles)}-mile radius is unavailable.`,
    );
    return 70;
  }
  explanations.push(
    'Outside preferred locations; exact distance is unavailable.',
  );
  return 20;
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
    if (score >= thresholds.applyImmediately) return 'Verified Match';
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
