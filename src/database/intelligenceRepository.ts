import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import type {
  AnalysisSummary,
  ExtractedTerm,
  JobIntelligence,
} from '../models/intelligence.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import { normalizeText } from '../utilities/normalization.js';
import { nowUtc } from '../utilities/timestamps.js';
import type { VerificationResult } from '../intelligence/verificationService.js';

interface PreviousRecommendationRow {
  overall_score: number;
  category_scores_json: string;
  recommendation_status: string;
  score_version: string | null;
  score_input_hash: string | null;
}

export class IntelligenceRepository {
  public constructor(private readonly database: JobDatabase) {}

  public saveProfile(profile: CandidateProfile): void {
    const timestamp = nowUtc();
    this.database
      .prepare(
        `INSERT INTO candidate_profiles
          (id, name, configuration_json, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           configuration_json = excluded.configuration_json,
           active = excluded.active,
           updated_at = excluded.updated_at`,
      )
      .run(
        profile.id,
        profile.name,
        JSON.stringify(profile),
        1,
        timestamp,
        timestamp,
      );
  }

  public startRun(profileId: string, scoreVersion: string): string {
    const runId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO analysis_runs
          (id, profile_id, status, started_at, completed_at, jobs_analyzed, error_message, score_version)
         VALUES (?, ?, 'running', ?, NULL, 0, NULL, ?)`,
      )
      .run(runId, profileId, nowUtc(), scoreVersion);
    return runId;
  }

  public saveIntelligence(
    profileId: string,
    result: JobIntelligence,
    metadata: {
      verification: VerificationResult;
      scoreVersion: string;
      scoreInputHash: string;
    },
  ): void {
    this.database.transaction(() => {
      const categoryScoresJson = JSON.stringify(result.categoryScores);
      const previous = this.database
        .prepare<[string, string], PreviousRecommendationRow>(
          `SELECT overall_score, category_scores_json, recommendation_status,
              score_version, score_input_hash
            FROM recommendations WHERE job_id = ? AND profile_id = ?`,
        )
        .get(result.jobId, profileId);

      this.database
        .prepare(
          `INSERT INTO recommendations (
            id, job_id, profile_id, overall_score, category_scores_json,
             recommendation_status, explanations_json, missing_qualifications_json,
             analyzed_at, score_version, score_input_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id, profile_id) DO UPDATE SET
            overall_score = excluded.overall_score,
            category_scores_json = excluded.category_scores_json,
            recommendation_status = excluded.recommendation_status,
             explanations_json = excluded.explanations_json,
             missing_qualifications_json = excluded.missing_qualifications_json,
             analyzed_at = excluded.analyzed_at,
             score_version = excluded.score_version,
             score_input_hash = excluded.score_input_hash`,
        )
        .run(
          randomUUID(),
          result.jobId,
          profileId,
          result.overallScore,
          categoryScoresJson,
          result.recommendationStatus,
          JSON.stringify(result.explanations),
          JSON.stringify(result.missingQualifications),
          result.analyzedAt,
          metadata.scoreVersion,
          metadata.scoreInputHash,
        );

      if (
        previous === undefined ||
        previous.overall_score !== result.overallScore ||
        previous.category_scores_json !== categoryScoresJson ||
        previous.recommendation_status !== result.recommendationStatus ||
        previous.score_version !== metadata.scoreVersion ||
        previous.score_input_hash !== metadata.scoreInputHash
      ) {
        this.database
          .prepare(
            `INSERT INTO score_history (
              id, job_id, profile_id, overall_score, category_scores_json,
             recommendation_status, analyzed_at, score_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            result.jobId,
            profileId,
            result.overallScore,
            categoryScoresJson,
            result.recommendationStatus,
            result.analyzedAt,
            metadata.scoreVersion,
          );
      }

      this.database
        .prepare(
          `UPDATE jobs SET score = ?, recommendation = ?, score_explanation = ?,
             verification_status = ?, eligibility_passed = ?, eligibility_rejection = ?,
             work_arrangement = ?, illinois_eligibility = ?, schedule_classification = ?,
             verified_at = ?, remote_type = ?, score_version = ?, score_input_hash = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          result.overallScore,
          result.recommendationStatus,
          result.explanations.join('\n'),
          result.verifiedStatus,
          result.eligibilityPassed ? 1 : 0,
          result.eligibilityRejection,
          result.workArrangement ?? metadata.verification.workArrangement,
          metadata.verification.illinoisEligibility,
          metadata.verification.schedule.classification,
          metadata.verification.evidence.verifiedAt,
          result.workArrangement ?? metadata.verification.workArrangement,
          metadata.scoreVersion,
          metadata.scoreInputHash,
          result.analyzedAt,
          result.jobId,
        );

      this.replaceTerms('skill', result.jobId, result.skills);
      this.replaceTerms('certification', result.jobId, result.certifications);
    })();
  }

  public completeRun(summary: AnalysisSummary): void {
    this.database
      .prepare(
        `UPDATE analysis_runs SET status = 'succeeded', completed_at = ?, jobs_analyzed = ?, score_version = ?
         WHERE id = ?`,
      )
      .run(nowUtc(), summary.jobsAnalyzed, summary.scoreVersion, summary.runId);
  }

  public failRun(runId: string, errorMessage: string): void {
    this.database
      .prepare(
        `UPDATE analysis_runs SET status = 'failed', completed_at = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(nowUtc(), errorMessage, runId);
  }

  private replaceTerms(
    kind: 'skill' | 'certification',
    jobId: string,
    terms: readonly ExtractedTerm[],
  ): void {
    const catalogTable = kind === 'skill' ? 'skills' : 'certifications';
    const linkTable = kind === 'skill' ? 'job_skills' : 'job_certifications';
    const foreignKey = kind === 'skill' ? 'skill_id' : 'certification_id';
    this.database
      .prepare(`DELETE FROM ${linkTable} WHERE job_id = ?`)
      .run(jobId);

    for (const term of terms) {
      const termId = `${kind}:${normalizeText(term.name)}`;
      this.database
        .prepare(
          `INSERT INTO ${catalogTable} (id, name, normalized_name) VALUES (?, ?, ?)
           ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name`,
        )
        .run(termId, term.name, term.normalizedName);
      if (kind === 'skill') {
        this.database
          .prepare(
            `INSERT INTO job_skills (job_id, skill_id, frequency) VALUES (?, ?, ?)`,
          )
          .run(jobId, termId, term.frequency);
      } else {
        this.database
          .prepare(
            `INSERT INTO ${linkTable} (job_id, ${foreignKey}) VALUES (?, ?)`,
          )
          .run(jobId, termId);
      }
    }
  }
}
