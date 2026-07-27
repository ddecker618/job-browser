import type { JobDatabase } from '../db/database.js';
import { AnalyticsService } from '../analytics/analyticsService.js';
import { IntelligenceRepository } from '../database/intelligenceRepository.js';
import { log, type LogWriter } from '../logging/logger.js';
import type { AnalysisSummary } from '../models/intelligence.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { nowUtc } from '../utilities/timestamps.js';
import { scoreJob } from './scoringEngine.js';

export class IntelligenceEngine {
  private readonly intelligenceRepository: IntelligenceRepository;
  private readonly jobRepository: JobRepository;
  private readonly analytics: AnalyticsService;

  public constructor(
    database: JobDatabase,
    private readonly writeLog: LogWriter = log,
  ) {
    this.intelligenceRepository = new IntelligenceRepository(database);
    this.jobRepository = new JobRepository(database);
    this.analytics = new AnalyticsService(database);
  }

  public analyze(
    profile: CandidateProfile,
    config: ScoringConfig,
  ): AnalysisSummary {
    this.intelligenceRepository.saveProfile(profile);
    const runId = this.intelligenceRepository.startRun(profile.id);
    const analyzedAt = nowUtc();
    this.writeLog('info', 'Analysis run started', {
      runId,
      profileId: profile.id,
    });

    try {
      const jobs = this.jobRepository.listJobs();
      let totalScore = 0;
      for (const job of jobs) {
        const intelligence = scoreJob(job, profile, config, analyzedAt);
        this.intelligenceRepository.saveIntelligence(profile.id, intelligence);
        totalScore += intelligence.overallScore;
      }
      const summary: AnalysisSummary = {
        runId,
        profileId: profile.id,
        jobsAnalyzed: jobs.length,
        averageScore:
          jobs.length === 0
            ? 0
            : Math.round((totalScore / jobs.length) * 10) / 10,
      };
      this.analytics.generate(runId, profile.id, analyzedAt);
      this.intelligenceRepository.completeRun(summary);
      this.writeLog('info', 'Analysis run completed', { ...summary });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.intelligenceRepository.failRun(runId, message);
      this.writeLog('error', 'Analysis run failed', {
        runId,
        profileId: profile.id,
        error: message,
        stackTrace: error instanceof Error ? (error.stack ?? null) : null,
      });
      throw new Error(`Analysis failed for profile ${profile.id}: ${message}`, {
        cause: error,
      });
    }
  }
}
