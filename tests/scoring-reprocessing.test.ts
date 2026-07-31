import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';
import { createJobFixture } from './helpers/job-fixture.js';
import { insertTestSource } from './helpers/test-database.js';

const directories: string[] = [];
const handles: BackendHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('scoring reprocessing and current ranking', () => {
  it('reclassifies Barnes-style onsite jobs and excludes them from eligible results', async () => {
    const databasePath = createStaleBarnesDatabase();
    const first = await startBackend({
      databasePath,
      enableScheduler: false,
      seedDefaultSources: false,
    });
    handles.push(first);

    const row = first.database
      .prepare<[], Record<string, unknown>>(
        `SELECT remote_type, work_arrangement, eligibility_passed,
           eligibility_rejection, score, recommendation, score_version
         FROM jobs WHERE company LIKE 'Barnes & Noble Education%'`,
      )
      .get();
    expect(row).toMatchObject({
      remote_type: 'onsite',
      work_arrangement: 'onsite',
      eligibility_passed: 0,
      eligibility_rejection: 'location_outside_radius',
      score: 0,
      recommendation: 'Hard No',
      score_version: createScoreVersion(
        loadCandidateProfile(),
        loadScoringConfig(),
      ),
    });

    const eligibleResponse = await fetch(
      `${first.url}/api/jobs/search?q=Solaris&pageSize=10`,
    );
    expect(eligibleResponse.ok).toBe(true);
    const eligibleResults = (await eligibleResponse.json()) as {
      items: unknown[];
    };
    expect(eligibleResults.items).toEqual([]);

    const allResponse = await fetch(
      `${first.url}/api/jobs/search?q=Solaris&includeIneligible=true&pageSize=10`,
    );
    const allResults = (await allResponse.json()) as {
      items: {
        id: string;
        score: number;
        eligibilityPassed: boolean;
        eligibilityRejection: string;
        workArrangement: string;
        scoreVersion: string;
      }[];
    };
    expect(allResults.items).toHaveLength(1);
    expect(allResults.items[0]).toMatchObject({
      score: 0,
      eligibilityPassed: false,
      eligibilityRejection: 'location_outside_radius',
      workArrangement: 'onsite',
    });

    const detailResponse = await fetch(
      `${first.url}/api/jobs/${allResults.items[0]?.id ?? ''}`,
    );
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      score: 0,
      eligibilityPassed: false,
      eligibilityRejection: 'location_outside_radius',
      workArrangement: 'onsite',
      scoreVersion: allResults.items[0]?.scoreVersion,
    });

    await first.stop();
    handles.splice(handles.indexOf(first), 1);

    const second = await startBackend({
      databasePath,
      enableScheduler: false,
      seedDefaultSources: false,
    });
    handles.push(second);
    const stable = second.database
      .prepare<[], { score: number; score_version: string }>(
        `SELECT score, score_version FROM jobs
         WHERE company LIKE 'Barnes & Noble Education%'`,
      )
      .get();
    expect(stable).toEqual({
      score: 0,
      score_version: createScoreVersion(
        loadCandidateProfile(),
        loadScoringConfig(),
      ),
    });
  });

  it('hides a persisted score as stale until its score version is current', () => {
    const databasePath = createStaleBarnesDatabase();
    const database = openDatabase(databasePath);
    const search = new JobSearchRepository(database, {
      getScoreVersion: () =>
        createScoreVersion(loadCandidateProfile(), loadScoringConfig()),
    });
    const result = search.search({
      q: 'Solaris',
      page: 1,
      pageSize: 10,
      sort: 'score',
      direction: 'desc',
    });
    expect(result.items).toEqual([]);
    database.close();
  });
});

function createStaleBarnesDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-score-reprocess-'));
  directories.push(directory);
  const databasePath = join(directory, 'jobs.sqlite');
  const database = openDatabase(databasePath);
  runMigrations(database);
  const sourceId = insertTestSource(database, {
    employer: 'Indeed',
    sourceType: 'indeed',
  });
  const job = createJobFixture({
    title: 'Solaris / Linux Systems Administrator',
    normalizedTitle: 'solaris linux systems administrator',
    company: 'Barnes & Noble Education, Inc.',
    normalizedCompany: 'barnes noble education inc',
    location: 'Columbia, MO',
    city: 'Columbia',
    state: 'MO',
    remoteType: 'remote',
    description:
      'This is an onsite role located in Columbia, Missouri. Administer Linux systems and remote infrastructure.',
    requirements: 'Linux required.',
  });
  new JobRepository(database).upsertObservation({
    job,
    sourceId,
    rawData: job,
  });
  database
    .prepare(
      `UPDATE jobs SET score = 85.5, recommendation = 'Verified Match',
         score_explanation = 'obsolete score', verification_status = 'verified',
         eligibility_passed = 1, work_arrangement = 'remote',
         score_version = 'obsolete', score_input_hash = 'obsolete' WHERE id = ?`,
    )
    .run(job.id);
  database.close();
  return databasePath;
}
