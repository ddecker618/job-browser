import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobNlpEnrichmentRepository } from '../src/database/jobNlpEnrichmentRepository.js';
import { NlpRelevanceRepository } from '../src/database/nlpRelevanceRepository.js';
import { runNlpWorkerBatch } from '../src/intelligence/nlp/async.js';
import {
  documentHash,
  extractNlpDocument,
} from '../src/intelligence/nlp/document.js';
import {
  deriveSearchRelevance,
  SEARCH_RELEVANCE_INDEX_VERSION,
  withSearchRelevanceIndex,
  type SearchRelevanceDocument,
} from '../src/intelligence/nlp/searchRelevance.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { jobSearchQuerySchema } from '../src/schemas/job-search.js';
import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import { createApp } from '../src/server/app.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

const databases: JobDatabase[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  for (const database of databases.splice(0)) database.close();
});

describe('deriveSearchRelevance (P6)', () => {
  it('is bounded, versioned, and deterministic', async () => {
    const result = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description:
        'Linux administration and Kubernetes administration required.',
      requirements: null,
      preferredQualifications: null,
    });
    const first = deriveSearchRelevance(result);
    const second = deriveSearchRelevance(result);
    expect(first.indexVersion).toBe(SEARCH_RELEVANCE_INDEX_VERSION);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(1);
    expect(first).toEqual(second);
  });

  it('counts canonical skills and orders top skills deterministically', async () => {
    const result = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux administration and Active Directory administration.',
      requirements: '3+ years of Linux and VMware experience required.',
      preferredQualifications: 'Cisco CCNA certification preferred.',
    });
    const relevance = deriveSearchRelevance(result);
    expect(relevance.skillCount).toBeGreaterThan(0);
    expect(relevance.canonicalSkills.length).toBe(relevance.skillCount);
    expect(relevance.topSkills.length).toBeLessThanOrEqual(8);
  });

  it('captures clearance, certification and education signals', async () => {
    const result = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux administration.',
      requirements:
        'Top Secret clearance required. Bachelor degree in computer science.',
      preferredQualifications: 'Cisco CCNA certification preferred.',
    });
    const relevance = deriveSearchRelevance(result);
    expect(relevance.signals.clearances.length).toBeGreaterThan(0);
    expect(relevance.signals.certifications.length).toBeGreaterThan(0);
    expect(relevance.signals.educationLevels.length).toBeGreaterThan(0);
  });

  it('excludes boilerplate facts from the skill count', async () => {
    const rich = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux and Windows Server and VMware administration.',
      requirements:
        'An equal opportunity employer. Must be authorized to work.',
      preferredQualifications: null,
    });
    const relevance = deriveSearchRelevance(rich);
    expect(relevance.signals.clearances).toEqual([]);
  });
});

describe('NlpRelevanceRepository and composite target (P6)', () => {
  it('round-trips a validated relevance document', () => {
    const database = createTestDatabase();
    databases.push(database);
    insertRawJob(database, 'job-rel-1');
    const repository = new NlpRelevanceRepository(database);
    const document = relevanceDocument(0.75, ['Linux', 'Kubernetes']);
    repository.save('job-rel-1', document);
    expect(repository.get('job-rel-1')).toEqual(document);
    expect(repository.get('missing')).toBeNull();
  });

  it('rejects an out-of-range or malformed document', () => {
    const database = createTestDatabase();
    databases.push(database);
    const repository = new NlpRelevanceRepository(database);
    expect(() =>
      repository.save('job-rel-2', relevanceDocument(2, [])),
    ).toThrow();
    expect(() =>
      repository.save('job-rel-3', {
        ...relevanceDocument(0.5),
        canonicalSkills: 'not-an-array',
      } as unknown as SearchRelevanceDocument),
    ).toThrow();
  });

  it('persists relevance alongside enrichment through the worker target', async () => {
    const database = createTestDatabase();
    databases.push(database);
    const parts = {
      title: 'job-worker-rel',
      location: null,
      description: 'Linux and Kubernetes administration.',
      requirements: 'Top Secret clearance required.',
      preferredQualifications: null,
    };
    insertRawJob(database, 'job-worker-rel', parts.description);
    const enrichmentStore = new JobNlpEnrichmentRepository(database);
    const relevanceStore = new NlpRelevanceRepository(database);
    const target = withSearchRelevanceIndex(enrichmentStore, relevanceStore);
    const result = await runNlpWorkerBatch(
      target,
      [
        {
          jobId: 'job-worker-rel',
          sourceTextHash: documentHash(parts),
        },
      ],
      'job-nlp-v1',
      async () => extractNlpDocument(parts),
      { batchSize: 1 },
    );
    expect(result.extracted).toBe(1);
    const stored = relevanceStore.get('job-worker-rel');
    expect(stored).not.toBeNull();
    expect(stored?.score).toBeGreaterThanOrEqual(0);
    expect(stored?.score).toBeLessThanOrEqual(1);
    expect(enrichmentStore.get('job-worker-rel')).not.toBeNull();
    const row = database
      .prepare<
        [],
        { count: number }
      >('SELECT COUNT(*) AS count FROM job_nlp_relevance')
      .get();
    expect(row?.count).toBe(1);
  });
});

describe('JobSearchRepository NLP tie-break (P6)', () => {
  let database: JobDatabase;
  let sourceId: string;
  let sequence: number;
  let flag = false;

  beforeEach(() => {
    database = createTestDatabase();
    databases.push(database);
    sourceId = insertTestSource(database, {
      id: 'source-p6',
      employer: 'P6 Feed',
    });
    sequence = 0;
    flag = false;
  });

  it('keeps the deterministic id tie-break when the flag is off', () => {
    const ids = [5, 1, 4, 2, 3];
    for (const id of ids) insertJob({ id: uuid(id), score: 75 });
    addRelevance(uuid(5), 0.9);
    addRelevance(uuid(1), 0.95);
    const repository = searchRepository();
    const response = repository.search(parse());
    expect(response.items.map((item) => item.id)).toEqual(ids.map(uuid).sort());
  });

  it('ranks equal-score ties by relevance then id when the flag is on', () => {
    for (const id of [5, 1, 4, 2, 3]) {
      insertJob({ id: uuid(id), score: 75 });
    }
    addRelevance(uuid(5), 0.9);
    addRelevance(uuid(1), 0.95);
    addRelevance(uuid(3), 0.4);
    flag = true;
    const response = searchRepository().search(parse());
    expect(response.items.map((item) => item.id)).toEqual([
      uuid(1),
      uuid(5),
      uuid(3),
      uuid(2),
      uuid(4),
    ]);
  });

  it('never changes score values, totals, pages, or facets', () => {
    insertJob({ id: uuid(2), score: 60 });
    insertJob({ id: uuid(1), score: 60 });
    insertJob({ id: uuid(3), score: 90 });
    addRelevance(uuid(1), 0.1);
    addRelevance(uuid(2), 0.99);
    flag = true;
    const response = searchRepository().search(parse());
    const scores = response.items.map((item) => item.score);
    expect(scores).toContain(60);
    expect(scores).toContain(90);
    expect(response.total).toBe(3);
    expect(response.facets.companies.length).toBeGreaterThanOrEqual(1);
  });

  function searchRepository(): JobSearchRepository {
    return new JobSearchRepository(database, {
      forceFallback: true,
      nlpSearchRelevance: () => flag,
    });
  }

  function insertJob(
    overrides: Parameters<typeof createJobFixture>[0] = {},
  ): string {
    sequence += 1;
    const job = createJobFixture({
      id:
        overrides.id ??
        `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      externalId: `external-${String(sequence)}`,
      postingUrl: `https://jobs.example.com/${String(sequence)}`,
      ...overrides,
    });
    new JobRepository(database).upsertObservation({
      job,
      sourceId,
      providerId: 'greenhouse',
      rawData: job,
    });
    return job.id;
  }

  function addRelevance(jobId: string, score: number): void {
    new NlpRelevanceRepository(database).save(jobId, relevanceDocument(score));
  }
});

describe('API gating for NLP search relevance (P6)', () => {
  it('ignores relevance until the app setting enables it', async () => {
    const database = createTestDatabase();
    databases.push(database);
    const sourceId = insertTestSource(database, {
      id: 'source-p6-api',
      employer: 'P6 API Feed',
    });
    database
      .prepare(
        'UPDATE sources SET display_name = ?, provider_id = ? WHERE id = ?',
      )
      .run('P6 API Feed', 'greenhouse', sourceId);
    const insert = (id: string, score: number): string => {
      const job = createJobFixture({
        id,
        title: id,
        score,
        externalId: `api-external-${id}`,
        postingUrl: `https://jobs.example.com/api/${id}`,
      });
      new JobRepository(database).upsertObservation({
        job,
        sourceId,
        providerId: 'greenhouse',
        rawData: job,
      });
      return job.id;
    };
    insert(apiUuid(1), 70);
    insert(apiUuid(2), 70);
    insert(apiUuid(3), 70);
    const scoreVersion = createScoreVersion(
      loadCandidateProfile(undefined, undefined),
      loadScoringConfig(undefined, undefined),
    );
    const stamp = database.prepare(
      'UPDATE jobs SET score_version = ? WHERE id = ?',
    );
    stamp.run(scoreVersion, apiUuid(1));
    stamp.run(scoreVersion, apiUuid(2));
    stamp.run(scoreVersion, apiUuid(3));
    const relevance = new NlpRelevanceRepository(database);
    relevance.save(apiUuid(2), relevanceDocument(0.99));
    relevance.save(apiUuid(1), relevanceDocument(0.05));

    const app = createApp(database, {});
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No port');
    const url = 'http://127.0.0.1:' + String(address.port);
    const search = async () => {
      const response = await fetch(url + '/api/jobs/search?pageSize=10');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: { id: string }[] };
      return body.items.map((item) => item.id);
    };

    expect(await search()).toEqual([apiUuid(1), apiUuid(2), apiUuid(3)]);

    database
      .prepare(
        `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES ('nlp_search_relevance_enabled', 'true', '2026-09-11T00:00:00.000Z')`,
      )
      .run();

    expect(await search()).toEqual([apiUuid(2), apiUuid(1), apiUuid(3)]);
  });
});

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function apiUuid(n: number): string {
  return `00000000-0000-4000-8001-${String(n).padStart(12, '0')}`;
}

function insertRawJob(
  database: JobDatabase,
  id: string,
  description: string | null = 'Linux administration.',
  score = 70,
): void {
  database
    .prepare(
      `INSERT INTO jobs (id,title,normalized_title,company,normalized_company,description,remote_type,employment_type,source_name,source_type,first_seen_at,last_seen_at,active,seniority_level,status,created_at,updated_at,score,score_explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      id,
      id.toLowerCase(),
      'Fixture',
      'fixture',
      description,
      'unknown',
      'unknown',
      'Fixture',
      'fixture',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      1,
      'unknown',
      'new',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      score,
      'fixture score',
    );
}

function relevanceDocument(
  score: number,
  skills: string[] = [],
): SearchRelevanceDocument {
  return {
    indexVersion: SEARCH_RELEVANCE_INDEX_VERSION,
    skillCount: skills.length,
    canonicalSkills: skills.slice(),
    topSkills: skills.slice(0, 8),
    signals: { clearances: [], certifications: [], educationLevels: [] },
    score,
  };
}

function parse(query: Record<string, string> = {}) {
  return jobSearchQuerySchema.parse(query);
}
