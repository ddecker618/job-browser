import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobRepository } from '../src/repositories/job-repository.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import type { SearchProfile } from '../src/config/search-profile.js';
import {
  DEFAULT_SEARCH_PROFILE,
  searchProfileSchema,
} from '../src/config/search-profile.js';
import { createApp } from '../src/server/app.js';
import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';
import type { JobDatabase } from '../src/db/database.js';

const databases: JobDatabase[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function seedJob(
  database: JobDatabase,
  title: string,
  sourceId: string,
  id: string,
): void {
  const job = createJobFixture({
    id,
    title,
    score: 60,
    postingUrl: `https://jobs.example.com/${id}`,
    externalId: `ext-${id}`,
  });
  new JobRepository(database).upsertObservation({
    job,
    sourceId,
    providerId: 'greenhouse',
    rawData: job,
  });
}

function seededRepository(database: JobDatabase, profile?: SearchProfile) {
  return new JobSearchRepository(database, {
    searchProfile: profile === undefined ? undefined : () => profile,
  });
}

import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import { JobNlpEnrichmentRepository } from '../src/database/jobNlpEnrichmentRepository.js';
import { NlpRelevanceRepository } from '../src/database/nlpRelevanceRepository.js';
import { deriveSearchRelevance } from '../src/intelligence/nlp/searchRelevance.js';

describe('target-role search integration (P8)', () => {
  let database: JobDatabase;
  let sourceId: string;
  let securityId: string;
  let networkingId: string;

  beforeEach(() => {
    database = createTestDatabase();
    databases.push(database);
    sourceId = insertTestSource(database, {
      id: 'source-p8',
      employer: 'P8 Feed',
    });
    database
      .prepare(
        'UPDATE sources SET display_name = ?, provider_id = ? WHERE id = ?',
      )
      .run('P8 Feed', 'greenhouse', sourceId);
    securityId = '00000000-0000-4000-8000-0000000000a1';
    networkingId = '00000000-0000-4000-8000-0000000000a2';
    seedJob(database, 'Tier 1 SOC Analyst', sourceId, securityId);
    seedJob(database, 'Network Analyst', sourceId, networkingId);
  });

  it('omits the role block and evidence when no target role is requested', () => {
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const result = repository.search({
      q: undefined,
      page: 1,
      pageSize: 25,
      sort: 'score',
      direction: 'desc',
    });

    expect(result.role).toBeNull();
    expect(result.items.every((item) => item.roleEvidence.length === 0)).toBe(
      true,
    );
  });

  it('filters to the target role family and reports approved evidence', () => {
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const result = repository.search({
      q: undefined,
      targetRole: 'security',
      page: 1,
      pageSize: 25,
      sort: 'score',
      direction: 'desc',
    });

    expect(result.role).toEqual({
      familyKey: 'security',
      displayName: 'Security',
      approved: true,
    });
    expect(result.items.map((item) => item.id)).toEqual([securityId]);
    const item = result.items[0];
    expect(item).toBeDefined();
    expect(item!.matchedFamilies).toContain('security');
    expect(item!.roleEvidence).toEqual([
      {
        key: 'security',
        displayName: 'Security',
        how: 'title-match',
        basis:
          'The job title matched the target role family in the structured record.',
      },
    ]);
  });

  it('keeps deterministic ordering while applying a target role', () => {
    const firstId = '00000000-0000-4000-8000-0000000000a3';
    seedJob(database, 'Cybersecurity Analyst', sourceId, firstId);
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const result = repository.search({
      q: undefined,
      targetRole: 'security',
      page: 1,
      pageSize: 25,
      sort: 'score',
      direction: 'desc',
    });

    expect(result.role?.familyKey).toBe('security');
    expect(result.items.map((item) => item.id)).toEqual([securityId, firstId]);
    expect(result.items.every((item) => item.roleEvidence.length === 1)).toBe(
      true,
    );
  });

  it('reports an unapproved (disabled) family without changing the filter', () => {
    const disabledProfile: SearchProfile = searchProfileSchema.parse({
      ...DEFAULT_SEARCH_PROFILE,
      families: DEFAULT_SEARCH_PROFILE.families.map((family) =>
        family.key === 'security' ? { ...family, enabled: false } : family,
      ),
    });
    const repository = seededRepository(database, disabledProfile);
    const result = repository.search({
      q: undefined,
      targetRole: 'security',
      page: 1,
      pageSize: 25,
      sort: 'score',
      direction: 'desc',
    });

    expect(result.role).toEqual({
      familyKey: 'security',
      displayName: 'Security',
      approved: false,
    });
    expect(result.items.map((item) => item.id)).toEqual([securityId]);
  });

  it('matches exact comma-separated keys, including literal SQL wildcards', () => {
    database
      .prepare('UPDATE jobs SET matched_families=? WHERE id=?')
      .run('cybersecurity,security-plus', networkingId);
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'score' as const,
      direction: 'desc' as const,
      targetRole: 'security',
    };
    expect(repository.search(query).items.map((item) => item.id)).toEqual([
      securityId,
    ]);
    expect(repository.search({ ...query, targetRole: '%' }).total).toBe(0);
    database
      .prepare('UPDATE jobs SET matched_families=? WHERE id=?')
      .run('networking, security', networkingId);
    expect(repository.search(query).total).toBe(2);
  });

  it('uses current P6 evidence without changing role membership and ignores stale indexes', async () => {
    const parts = {
      title: 'Tier 1 SOC Analyst',
      location: null,
      description: 'Splunk required.',
      requirements: null,
      preferredQualifications: null,
    };
    database
      .prepare(
        'UPDATE jobs SET location=NULL,description=?,requirements=NULL,preferred_qualifications=NULL WHERE id=?',
      )
      .run(parts.description, securityId);
    const enrichment = await extractNlpDocument(parts);
    new JobNlpEnrichmentRepository(database).save(securityId, enrichment);
    new NlpRelevanceRepository(database).save(
      securityId,
      deriveSearchRelevance(enrichment),
    );
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'score' as const,
      direction: 'desc' as const,
      targetRole: 'security',
    };
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const before = database.prepare('SELECT * FROM jobs ORDER BY id').all();
    const result = repository.search(query);
    expect(result.items.map((item) => item.id)).toEqual([securityId]);
    expect(result.items[0]?.roleEvidence[0]?.indexedSkills?.[0]).toMatchObject({
      skill: 'Splunk',
      evidence: 'Splunk required.',
    });
    expect(database.prepare('SELECT * FROM jobs ORDER BY id').all()).toEqual(
      before,
    );
    database
      .prepare('UPDATE jobs SET description=? WHERE id=?')
      .run('Linux preferred.', securityId);
    expect(
      repository.search(query).items[0]?.roleEvidence[0]?.indexedSkills,
    ).toBeUndefined();
    database
      .prepare(
        'UPDATE job_nlp_enrichments SET enrichment_json=? WHERE job_id=?',
      )
      .run('{}', securityId);
    expect(repository.search(query).items.map((item) => item.id)).toEqual([
      securityId,
    ]);
  });

  it('returns no role block for an unknown family key', () => {
    const repository = seededRepository(database, DEFAULT_SEARCH_PROFILE);
    const result = repository.search({
      q: undefined,
      targetRole: 'not-a-family',
      page: 1,
      pageSize: 25,
      sort: 'score',
      direction: 'desc',
    });

    expect(result.role).toBeNull();
    expect(result.total).toBe(0);
  });

  it('rejects an unknown target role at the API and accepts an approved one', async () => {
    const scoreVersion = createScoreVersion(
      loadCandidateProfile(undefined, undefined),
      loadScoringConfig(undefined, undefined),
    );
    const stamp = database.prepare(
      'UPDATE jobs SET score_version = ? WHERE id = ?',
    );
    stamp.run(scoreVersion, securityId);
    stamp.run(scoreVersion, networkingId);
    const dir = mkdtempSync(join(tmpdir(), 'p8-api-'));
    directories.push(dir);
    const app = createApp(database, {
      resumeDirectory: join(dir, 'resumes'),
      snapshotDirectory: join(dir, 'snapshots'),
    });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No port');
    const url = 'http://127.0.0.1:' + String(address.port);

    const missing = await fetch(
      url + '/api/jobs/search?targetRole=not-a-family',
    );
    expect(missing.status).toBe(400);

    const found = await fetch(url + '/api/jobs/search?targetRole=security');
    expect(found.status).toBe(200);
    const body = (await found.json()) as {
      total: number;
      role: { familyKey: string; approved: boolean };
    };
    expect(body.role.familyKey).toBe('security');
    expect(body.role.approved).toBe(true);
    expect(body.total).toBe(1);
  });
});
