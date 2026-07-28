import type { EligibilityRejectionReason } from '../domain/verification.js';
import type { ScoreCategoryName } from '../schemas/scoring-config.js';

export const RECOMMENDATION_STATUSES = [
  'Verified Match',
  'Apply Immediately',
  'Strong Match',
  'Possible Match',
  'Weak Match',
  'Hard No',
  'Needs Review',
  'Already Applied',
  'Expired',
  'Hidden',
] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export type CategoryScores = Record<ScoreCategoryName, number>;

export interface ExtractedTerm {
  name: string;
  normalizedName: string;
  frequency: number;
}

export interface JobIntelligence {
  jobId: string;
  overallScore: number;
  categoryScores: CategoryScores;
  recommendationStatus: RecommendationStatus;
  explanations: string[];
  missingQualifications: string[];
  skills: ExtractedTerm[];
  certifications: ExtractedTerm[];
  analyzedAt: string;
  eligibilityPassed: boolean;
  eligibilityRejection: EligibilityRejectionReason;
  verifiedStatus: string | null;
}

export interface AnalysisSummary {
  runId: string;
  profileId: string;
  jobsAnalyzed: number;
  averageScore: number;
}
