import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migration-runner.js';
import { log } from '../logging/logger.js';
import { JobRepository } from '../repositories/job-repository.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { IntelligenceEngine } from './intelligenceEngine.js';

const command = process.argv[2] ?? 'report';

const database = openDatabase();

try {
  runMigrations(database);
  const jobRepo = new JobRepository(database);
  const profile = loadCandidateProfile();
  const config = loadScoringConfig();

  if (command === 'report') {
    const jobs = jobRepo.listJobs();
    const verified = jobs.filter(
      (j) =>
        j.verificationStatus === 'verified' && j.eligibilityPassed === true,
    );
    const hardNo = jobs.filter((j) => j.eligibilityPassed === false);
    const unverified = jobs.filter(
      (j) =>
        j.verificationStatus === null || j.verificationStatus === 'unverified',
    );

    log('info', 'Verified Matches Report', {
      totalJobs: jobs.length,
      verifiedEligible: verified.length,
      hardNo: hardNo.length,
      unverified: unverified.length,
    });

    if (verified.length > 0) {
      log('info', '--- Verified Eligible Jobs ---');
      for (const job of verified) {
        log(
          'info',
          `  ${job.title} @ ${job.company} (score: ${String(job.score ?? 'N/A')})`,
        );
      }
    }
    if (hardNo.length > 0) {
      log('info', '--- Hard No (Failed Eligibility) ---');
      for (const job of hardNo) {
        log(
          'info',
          `  ${job.title} @ ${job.company} - reason: ${job.eligibilityRejection ?? 'N/A'}`,
        );
      }
    }
  } else if (command === 'run') {
    const engine = new IntelligenceEngine(database);
    const summary = engine.analyze(profile, config);
    log('info', 'Analysis completed', { ...summary });
  } else {
    log('error', 'Unknown command', { command });
    process.exitCode = 1;
  }
} catch (error) {
  log('error', 'Verified Matches command failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
