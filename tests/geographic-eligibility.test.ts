import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import type { JobDatabase } from '../src/db/database.js';
import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import type { CandidateProfile } from '../src/schemas/candidate-profile.js';
import {
  analyzeGeographicEligibility,
  evaluateGeographicGate,
  recommendationCapFor,
} from '../src/intelligence/geographicEligibility.js';
import type { JobForScoring } from '../src/domain/job.js';
import { IntelligenceEngine } from '../src/intelligence/intelligenceEngine.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import { verifyPosting } from '../src/intelligence/verificationService.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import { insertTestSource } from './helpers/test-database.js';

const analyzedAt = '2026-07-18T12:00:00.000Z';
const CONFIG = loadScoringConfig();

function commutingProfile(): CandidateProfile {
  const profile = loadCandidateProfile();
  return {
    ...profile,
    preferredLocations: [
      { city: 'Highland', state: 'IL' },
      { city: 'St Louis', state: 'MO' },
    ],
    searchRadiusMiles: 25,
    secondarySearchRadiusMiles: 50,
    remotePreference: 'preferred',
  };
}

const PROFILE = commutingProfile();

function verifyAndScore(
  job: ReturnType<typeof createJobFixture>,
  profile: CandidateProfile = PROFILE,
) {
  const text = [
    `${job.title} at ${job.company}`,
    job.location ? `Location: ${job.location}` : '',
    job.description ?? '',
    job.requirements ?? '',
    job.preferredQualifications ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const verification = verifyPosting(text, null, null);
  return scoreJob(job, profile, CONFIG, analyzedAt, verification);
}

function geoFor(
  job: ReturnType<typeof createJobFixture>,
  profile: CandidateProfile = PROFILE,
) {
  return analyzeGeographicEligibility(job, profile);
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('geographic eligibility: worksite parsing', () => {
  it('recognizes a structured City, ST posting', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    expect(geoFor(job).worksites).toEqual([{ city: 'Columbia', state: 'MO' }]);
  });

  it('parses provider location text when structured city/state are missing', () => {
    const job = createJobFixture({
      city: null,
      state: null,
      location: 'Columbia, MO',
    });
    expect(geoFor(job).worksites).toEqual([{ city: 'Columbia', state: 'MO' }]);
  });

  it('splits multiple worksites on separators and comma pairs', () => {
    const job = createJobFixture({
      city: null,
      state: null,
      location: 'Columbia, MO; Edwardsville, IL',
    });
    const geo = geoFor(job);
    expect(geo.worksites).toEqual([
      { city: 'Columbia', state: 'MO' },
      { city: 'Edwardsville', state: 'IL' },
    ]);
    expect(geo.statuses).toEqual(['outside', 'within']);
  });

  it('merges structured city/state with location text and de-duplicates', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO / St. Louis, MO',
    });
    const geo = geoFor(job);
    expect(geo.worksites).toEqual([
      { city: 'Columbia', state: 'MO' },
      { city: 'St. Louis', state: 'MO' },
    ]);
    expect(geo.statuses).toEqual(['outside', 'within']);
  });

  it('does not fabricate a worksite from a bare "Remote" location', () => {
    const job = createJobFixture({
      city: null,
      state: null,
      location: 'Remote',
    });
    expect(geoFor(job).worksites).toEqual([]);
  });
});

describe('geographic eligibility: location knowledge', () => {
  it('classifies an exact-distance worksite within the radius as known_local', () => {
    const job = createJobFixture({
      city: 'Edwardsville',
      state: 'IL',
      location: 'Edwardsville, IL',
    });
    const geo = geoFor(job);
    expect(geo.knowledge).toBe('known_local');
    expect(geo.distanceMiles).toBeLessThanOrEqual(25);
    expect(geo.hasEligibleWorksite).toBe(true);
  });

  it('classifies an exact-distance worksite beyond the radius as known_distant', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    const geo = geoFor(job);
    expect(geo.knowledge).toBe('known_distant');
    expect(geo.distanceMiles).toBeGreaterThan(25);
    expect(geo.hasIneligibleWorksite).toBe(true);
  });

  it('classifies a same-state worksite without atlas distance as known_state_eligible', () => {
    const job = createJobFixture({
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
    });
    const geo = geoFor(job);
    expect(geo.knowledge).toBe('known_state_eligible');
    expect(geo.distanceMiles).toBeNull();
    expect(geo.hasEligibleWorksite).toBe(true);
  });

  it('classifies an out-of-state worksite without atlas distance as known_state_ineligible', () => {
    const job = createJobFixture({
      city: 'Annapolis Junction',
      state: 'MD',
      location: 'Annapolis Junction, MD',
    });
    const geo = geoFor(job);
    expect(geo.knowledge).toBe('known_state_ineligible');
    expect(geo.hasIneligibleWorksite).toBe(true);
  });

  it('classifies a location with no worksite as unknown', () => {
    const job = createJobFixture({ city: null, state: null, location: null });
    const geo = geoFor(job);
    expect(geo.knowledge).toBe('unknown');
    expect(geo.worksites).toEqual([]);
  });

  it('never claims a distance when the local atlas lacks the coordinates', () => {
    const job = createJobFixture({
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
    });
    expect(geoFor(job).distanceMiles).toBeNull();
  });
});

describe('geographic eligibility: hard gate', () => {
  it('does not hard-block a remote role regardless of worksite distance', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    const gate = evaluateGeographicGate('remote', geoFor(job));
    expect(gate.block).toBe(false);
  });

  it('does not hard-block onsite work within the radius', () => {
    const job = createJobFixture({
      city: 'Edwardsville',
      state: 'IL',
      location: 'Edwardsville, IL',
    });
    const gate = evaluateGeographicGate('onsite', geoFor(job));
    expect(gate.block).toBe(false);
    expect(gate.explanation).toBeNull();
  });

  it('does not hard-block hybrid work within the radius', () => {
    const job = createJobFixture({
      city: 'St. Louis',
      state: 'MO',
      location: 'St. Louis, MO',
    });
    const gate = evaluateGeographicGate('hybrid', geoFor(job));
    expect(gate.block).toBe(false);
  });

  it('hard-blocks onsite work beyond the radius', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    const gate = evaluateGeographicGate('onsite', geoFor(job));
    expect(gate.block).toBe(true);
    expect(gate.reason).toBe('location_outside_radius');
  });

  it('hard-blocks hybrid work beyond the radius', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    const gate = evaluateGeographicGate('hybrid', geoFor(job));
    expect(gate.block).toBe(true);
  });

  it('hard-blocks an unknown arrangement when every listed worksite is outside', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
    });
    const gate = evaluateGeographicGate('unknown', geoFor(job));
    expect(gate.block).toBe(true);
  });

  it('does not hard-block when only some worksites are outside', () => {
    const job = createJobFixture({
      city: null,
      state: null,
      location: 'Columbia, MO; St. Louis, MO',
    });
    const gate = evaluateGeographicGate('onsite', geoFor(job));
    expect(gate.block).toBe(false);
  });

  it('does not hard-block a same-state worksite of unknown distance', () => {
    const job = createJobFixture({
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
    });
    const gate = evaluateGeographicGate('onsite', geoFor(job));
    expect(gate.block).toBe(false);
  });

  it('does not hard-block a location with no worksite', () => {
    const job = createJobFixture({ city: null, state: null, location: null });
    const gate = evaluateGeographicGate('onsite', geoFor(job));
    expect(gate.block).toBe(false);
  });

  it('does not hard-block a single unknown worksite', () => {
    const job = createJobFixture({
      city: 'Springfield',
      state: 'IL',
      location: 'Columbia, MO',
    });
    const gate = evaluateGeographicGate('unknown', geoFor(job));
    expect(gate.block).toBe(false);
  });
});

describe('geographic eligibility: recommendation cap', () => {
  it('allows Verified Match for remote work', () => {
    const job = createJobFixture({
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      remoteType: 'remote',
    });
    expect(recommendationCapFor('remote', geoFor(job))).toBe('none');
  });

  it('allows Verified Match for known_local onsite and hybrid work', () => {
    const job = createJobFixture({
      city: 'Edwardsville',
      state: 'IL',
      location: 'Edwardsville, IL',
    });
    expect(recommendationCapFor('onsite', geoFor(job))).toBe('none');
    expect(recommendationCapFor('hybrid', geoFor(job))).toBe('none');
  });

  it('caps unconfirmed location knowledge at Strong Match', () => {
    const sameState = createJobFixture({
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
    });
    const unknown = createJobFixture({ city: null, state: null, location: null });
    expect(recommendationCapFor('onsite', geoFor(sameState))).toBe('strong');
    expect(recommendationCapFor('hybrid', geoFor(unknown))).toBe('strong');
    expect(recommendationCapFor('unknown', geoFor(unknown))).toBe('strong');
  });
});

describe('geographic eligibility: end-to-end scoring', () => {
  it('lets a local onsite role score 100 for location and reach Verified Match', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'onsite',
      city: 'Edwardsville',
      state: 'IL',
      location: 'Edwardsville, IL',
      description:
        'This is an onsite role. Monitor Splunk SIEM alerts and investigate incidents.',
      requirements: 'CompTIA Security+ required.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.categoryScores.location).toBe(100);
    expect(result.recommendationStatus).toBe('Verified Match');
  });

  it('lets a local hybrid role pass without penalty', () => {
    const job = createJobFixture({
      remoteType: 'hybrid',
      city: 'St. Louis',
      state: 'MO',
      location: 'St. Louis, MO',
      description: 'Hybrid role based in St. Louis; office three days per week.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.recommendationStatus).not.toBe('Hard No');
  });

  it('hard-blocks an onsite role beyond the radius with an honest reason', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'onsite',
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      description: 'This is an onsite role located in Columbia, Missouri.',
      requirements: 'CompTIA Security+ required.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
    expect(result.recommendationStatus).toBe('Hard No');
    expect(result.overallScore).toBe(0);
  });

  it('hard-blocks a hybrid role beyond the radius', () => {
    const job = createJobFixture({
      remoteType: 'hybrid',
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      description:
        'Hybrid role; requires in-office attendance in Columbia, Missouri.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
  });

  it('hard-blocks an unknown arrangement whose only worksite is outside', () => {
    const job = createJobFixture({
      remoteType: 'unknown',
      city: 'Houston',
      state: 'TX',
      location: 'Houston, TX',
      description: 'Monitor Splunk SIEM alerts and investigate incidents. Full-time.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
    expect(result.recommendationStatus).toBe('Hard No');
  });

  it('hard-blocks a location-text-only onsite job (structured fields missing)', () => {
    const job = createJobFixture({
      remoteType: 'onsite',
      city: null,
      state: null,
      location: 'Columbia, MO',
      description: 'This is an onsite role located in Columbia, Missouri.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
  });

  it('lets a same-state onsite role pass but never reach Verified Match', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'onsite',
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
      description:
        'This is an onsite role in Springfield, Illinois. Monitor Splunk SIEM alerts.',
      requirements: 'CompTIA Security+ required.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.categoryScores.location).toBe(60);
    expect(result.recommendationStatus).toBe('Strong Match');
  });

  it('caps a high-scoring same-state hybrid role at Strong Match', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'hybrid',
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
      description:
        'Hybrid role in Springfield, Illinois; office three days per week. Monitor Splunk SIEM alerts.',
      requirements: 'CompTIA Security+ required.',
    });
    const result = verifyAndScore(job);
    expect(result.overallScore).toBeGreaterThanOrEqual(85);
    expect(result.recommendationStatus).toBe('Strong Match');
  });

  it('lets an unknown location pass unblocked but never reach Verified Match', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'onsite',
      city: null,
      state: null,
      location: null,
      description:
        'This is an onsite role. Monitor Splunk SIEM alerts and investigate incidents.',
      requirements: 'CompTIA Security+ required.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.categoryScores.location).toBe(30);
    expect(result.recommendationStatus).toBe('Strong Match');
    expect(result.recommendationStatus).not.toBe('Verified Match');
  });

  it('does not block a remote role with a distant headquarters', () => {
    const job = createJobFixture({
      remoteType: 'remote',
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      description:
        'Fully remote role. Monitor Splunk SIEM alerts and investigate incidents.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.recommendationStatus).not.toBe('Hard No');
    expect(result.categoryScores.location).toBe(100);
  });

  it('scores an unknown arrangement as unconfirmed rather than near-perfect remote', () => {
    const job = createJobFixture({
      remoteType: 'unknown',
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
      description: 'Monitor Splunk SIEM alerts and investigate incidents. Full-time.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.categoryScores.remotePreference).toBe(50);
  });

  it('exposes understandable worksite evidence in explanations', () => {
    const job = createJobFixture({
      remoteType: 'onsite',
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      description: 'This is an onsite role located in Columbia, Missouri.',
    });
    const result = verifyAndScore(job);
    const joined = result.explanations.join('\n');
    expect(joined).toContain('Columbia, MO');
    expect(joined).toContain('outside the configured commute boundary');
    expect(joined).toContain('Location eligibility gate failed');
  });

  it('scores location by actual commute eligibility, not by exact-city guesswork', () => {
    const job = createJobFixture({
      remoteType: 'onsite',
      city: 'Columbia',
      state: 'MO',
      location: 'Columbia, MO',
      description: 'This is an onsite role located in Columbia, Missouri.',
    });
    const result = verifyAndScore(job);
    expect(result.categoryScores.location).toBe(0);
  });
});

describe('geographic eligibility: remote region restrictions', () => {
  it('detects a remote region restriction from a full state name', () => {
    const verification = verifyPosting(
      'Remote role. Remote role is restricted to Maryland.',
      null,
      null,
    );
    expect(verification.workArrangement).toBe('remote');
    expect(verification.remoteRegion).toMatchObject({
      restricted: true,
      states: ['MD'],
    });
  });

  it('detects a remote region restriction from a candidate residency clause', () => {
    const verification = verifyPosting(
      'Remote role. Candidates must reside in Texas.',
      null,
      null,
    );
    expect(verification.remoteRegion?.restricted).toBe(true);
    expect(verification.remoteRegion?.states).toEqual(['TX']);
  });

  it('detects a multi-state restriction list', () => {
    const verification = verifyPosting(
      'Remote role. Must reside in one of the following states: Maryland, Virginia.',
      null,
      null,
    );
    expect(verification.remoteRegion?.restricted).toBe(true);
    expect(verification.remoteRegion?.states).toEqual(['MD', 'VA']);
  });

  it('does not treat a nationwide allowance as a restriction', () => {
    const verification = verifyPosting(
      'Fully remote. Work anywhere in the US.',
      null,
      null,
    );
    expect(verification.remoteRegion?.restricted).toBe(false);
  });

  it('does not treat an unknown-place clause as a restriction', () => {
    const verification = verifyPosting(
      'Remote role. Must be located in the United States.',
      null,
      null,
    );
    expect(verification.remoteRegion?.restricted).toBe(false);
  });

  it('hard-blocks a region-restricted remote role when the candidate is outside', () => {
    const job = createJobFixture({
      remoteType: 'remote',
      city: null,
      state: null,
      location: 'Remote',
      description:
        'Remote role is restricted to Maryland. Monitor Splunk SIEM alerts.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('remote_region_ineligible');
    expect(result.recommendationStatus).toBe('Hard No');
  });

  it('lets a region-restricted remote role through when the candidate is inside', () => {
    const job = createJobFixture({
      remoteType: 'remote',
      city: null,
      state: null,
      location: 'Remote',
      description:
        'Remote role is restricted to Illinois. Monitor Splunk SIEM alerts.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
    expect(result.recommendationStatus).not.toBe('Hard No');
  });

  it('keeps an unrestricted remote role eligible', () => {
    const job = createJobFixture({
      remoteType: 'remote',
      city: null,
      state: null,
      location: 'Remote',
      description: 'Fully remote role. Work anywhere in the US.',
    });
    const result = verifyAndScore(job);
    expect(result.eligibilityPassed).toBe(true);
  });
});

describe('geographic eligibility: persisted score invalidation', () => {
  it('re-scores a geographically invalid job to Hard No under the current version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-geo-invalid-'));
    directories.push(directory);
    const databasePath = join(directory, 'jobs.sqlite');
    const database = openDatabase(databasePath);
    try {
      runMigrations(database);
      const sourceId = insertTestSource(database, {
        employer: 'Indeed',
        sourceType: 'indeed',
      });
      const job = createJobFixture({
        title: 'Cybersecurity Analyst',
        normalizedTitle: 'cybersecurity analyst',
        company: 'Skunk Works Inc',
        location: 'Annapolis Junction, MD',
        city: 'Annapolis Junction',
        state: 'MD',
        remoteType: 'onsite',
        description:
          'This is an onsite role located in Annapolis Junction, Maryland. Monitor Splunk SIEM alerts.',
        requirements: 'CompTIA Security+ required.',
      });
      new JobRepository(database).upsertObservation({
        job,
        sourceId,
        rawData: job,
      });
      database
        .prepare(
          `UPDATE jobs SET score = 91.0, recommendation = 'Verified Match',
             score_explanation = 'obsolete geographic score',
             verification_status = 'verified', eligibility_passed = 1,
             work_arrangement = 'remote', score_version = 'obsolete',
             score_input_hash = 'obsolete' WHERE id = ?`,
        )
        .run(job.id);

      new IntelligenceEngine(database).analyze(PROFILE, CONFIG);

      const row = database
        .prepare<
          [string],
          {
            score: number;
            recommendation: string;
            eligibility_passed: number;
            eligibility_rejection: string;
            work_arrangement: string;
            score_version: string;
          }
        >(
          `SELECT score, recommendation, eligibility_passed, eligibility_rejection,
                  work_arrangement, score_version FROM jobs WHERE id = ?`,
        )
        .get(job.id);
      expect(row).toMatchObject({
        score: 0,
        recommendation: 'Hard No',
        eligibility_passed: 0,
        eligibility_rejection: 'location_outside_radius',
        work_arrangement: 'onsite',
        score_version: createScoreVersion(PROFILE, CONFIG),
      });
    } finally {
      database.close();
    }
  });
});

describe('geographic eligibility: current ranking through the Jobs query path', () => {
  function insertJob(
    database: JobDatabase,
    sourceId: string,
    index: number,
    overrides: Parameters<typeof createJobFixture>[0],
  ): ReturnType<typeof createJobFixture> {
    const job = createJobFixture({
      externalId: `ranking-${String(index)}`,
      postingUrl: `https://jobs.example.com/ranking/${String(index)}`,
      ...overrides,
    });
    new JobRepository(database).upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    return job;
  }

  it('keeps geographically impossible jobs out of the eligible ranking', () => {
    const database = openDatabase(':memory:');
    try {
      runMigrations(database);
      const sourceId = insertTestSource(database);

      const impossible = insertJob(database, sourceId, 1, {
        title: 'Cybersecurity Analyst',
        normalizedTitle: 'cybersecurity analyst',
        company: 'Skunk Works Inc',
        location: 'Annapolis Junction, MD',
        city: 'Annapolis Junction',
        state: 'MD',
        remoteType: 'onsite',
        description:
          'This is an onsite role located in Annapolis Junction, Maryland. Monitor Splunk SIEM alerts and investigate incidents.',
        requirements: 'CompTIA Security+ required.',
      });
      const remote = insertJob(database, sourceId, 2, {
        title: 'SOC Analyst',
        normalizedTitle: 'soc analyst',
        company: 'Remote Employer',
        location: 'Remote – United States',
        city: null,
        state: null,
        remoteType: 'remote',
        description:
          'Fully remote role. Monitor Splunk SIEM alerts and investigate incidents.',
        requirements: 'CompTIA Security+ required.',
      });
      const local = insertJob(database, sourceId, 3, {
        title: 'Systems Administrator',
        normalizedTitle: 'systems administrator',
        company: 'Local Employer',
        location: 'Edwardsville, IL',
        city: 'Edwardsville',
        state: 'IL',
        remoteType: 'onsite',
        description:
          'This is an onsite role in Edwardsville, Illinois. Administer Linux systems.',
        requirements: 'CompTIA Security+ required.',
      });
      const unknownLocation = insertJob(database, sourceId, 4, {
        title: 'Network Administrator',
        normalizedTitle: 'network administrator',
        company: 'Unlocated Employer',
        location: null,
        city: null,
        state: null,
        remoteType: 'onsite',
        description:
          'This is an onsite role. Monitor SIEM alerts for the network operations center.',
        requirements: 'CompTIA Security+ required.',
      });

      new IntelligenceEngine(database).analyze(PROFILE, CONFIG);

      const search = new JobSearchRepository(database, {
        getScoreVersion: () => createScoreVersion(PROFILE, CONFIG),
      });
      const eligible = search.search({
        q: '',
        page: 1,
        pageSize: 10,
        sort: 'score',
        direction: 'desc',
      });
      const eligibleIds = eligible.items.map((item) => item.id);
      expect(eligibleIds).not.toContain(impossible.id);
      expect(eligibleIds).toEqual([remote.id, local.id, unknownLocation.id]);

      const scores = eligible.items.map((item) => item.score);
      expect(scores[0]).toBeGreaterThanOrEqual(scores[1] ?? 0);
      expect(scores[1] ?? 0).toBeGreaterThanOrEqual(scores[2] ?? 0);

      const remoteItem = eligible.items.find((item) => item.id === remote.id);
      expect(remoteItem?.recommendation).toBe('Verified Match');

      const unknownItem = eligible.items.find(
        (item) => item.id === unknownLocation.id,
      );
      expect(unknownItem?.recommendation).toBe('Strong Match');

      const all = search.search({
        q: '',
        page: 1,
        pageSize: 10,
        sort: 'score',
        direction: 'desc',
        includeIneligible: true,
      });
      const impossibleItem = all.items.find((item) => item.id === impossible.id);
      expect(impossibleItem).toMatchObject({
        score: 0,
        eligibilityPassed: false,
        eligibilityRejection: 'location_outside_radius',
        recommendation: 'Hard No',
      });
      const eligibleByQuery = all.items.filter(
        (item) => item.eligibilityPassed === true,
      );
      expect(eligibleByQuery.length).toBe(3);
    } finally {
      database.close();
    }
  });

  it('honors the profile remotePreference in the remote preference score', () => {
    const notPreferred = loadCandidateProfile();
    notPreferred.remotePreference = 'not-preferred';
    const job = createJobFixture({
      remoteType: 'remote',
      city: null,
      state: null,
      location: 'Remote',
      description: 'Fully remote role.',
    });
    const result = verifyAndScore(job, notPreferred);
    expect(result.categoryScores.remotePreference).toBe(30);
  });
});

function typedJob(job: ReturnType<typeof createJobFixture>): JobForScoring {
  return job as unknown as JobForScoring;
}

describe('geographic eligibility: arrangement is not fabricated', () => {
  it('exposes an unknown arrangement honestly in the score input', () => {
    const job = createJobFixture({
      remoteType: 'unknown',
      city: 'Springfield',
      state: 'IL',
      location: 'Springfield, IL',
      description: 'Monitor Splunk SIEM alerts and investigate incidents. Full-time.',
    });
    const text = [
      `${job.title} at ${job.company}`,
      job.location ? `Location: ${job.location}` : '',
      job.description ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const verification = verifyPosting(text, null, null);
    expect(verification.workArrangement).toBe('unknown');
    expect(typedJob(job).remoteType).toBe('unknown');
    const geo = analyzeGeographicEligibility(job, PROFILE);
    expect(geo.knowledge).toBe('known_state_eligible');
    const gate = evaluateGeographicGate(verification.workArrangement, geo);
    expect(gate.block).toBe(false);
  });
});

describe('geographic eligibility: remote types remain distinct', () => {
  it('does not treat an onsite job as remote for scoring', () => {
    const job = createJobFixture({
      remoteType: 'onsite',
      city: 'Edwardsville',
      state: 'IL',
      location: 'Edwardsville, IL',
      description: 'This is an onsite role located in Edwardsville, Illinois.',
    });
    const result = verifyAndScore(job);
    expect(result.workArrangement).toBe('onsite');
    expect(result.categoryScores.location).toBe(100);
    expect(result.categoryScores.remotePreference).toBe(40);
  });
});
