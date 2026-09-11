import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobNlpEnrichmentRepository } from '../src/database/jobNlpEnrichmentRepository.js';
import { NlpRelevanceRepository } from '../src/database/nlpRelevanceRepository.js';
import {
  documentHash,
  extractNlpDocument,
} from '../src/intelligence/nlp/document.js';
import { deriveSearchRelevance } from '../src/intelligence/nlp/searchRelevance.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('NLP cache invalidation (P17)', () => {
  it('deletes both derived rows when source text changes and leaves unrelated updates alone', async () => {
    const database = createTestDatabase();
    databases.push(database);
    database.exec(`
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, description,
        remote_type, employment_type, source_name, source_type, first_seen_at,
        last_seen_at, active, seniority_level, status, created_at, updated_at
      ) VALUES (
        'cache-job', 'SOC Analyst', 'soc analyst', 'Fixture', 'fixture',
        'Splunk required.', 'unknown', 'unknown', 'Fixture', 'fixture',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1,
        'unknown', 'new', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `);
    const parts = {
      title: 'SOC Analyst',
      location: null,
      description: 'Splunk required.',
      requirements: null,
      preferredQualifications: null,
    };
    const enrichment = await extractNlpDocument(parts);
    expect(enrichment.sourceTextHash).toBe(documentHash(parts));
    const enrichmentStore = new JobNlpEnrichmentRepository(database);
    const relevanceStore = new NlpRelevanceRepository(database);
    enrichmentStore.save('cache-job', enrichment);
    relevanceStore.save('cache-job', deriveSearchRelevance(enrichment));

    database.prepare('UPDATE jobs SET favorite=1 WHERE id=?').run('cache-job');
    database
      .prepare('UPDATE jobs SET description=description WHERE id=?')
      .run('cache-job');
    expect(enrichmentStore.get('cache-job')).not.toBeNull();
    expect(relevanceStore.get('cache-job')).not.toBeNull();

    database
      .prepare('UPDATE jobs SET description=? WHERE id=?')
      .run('Linux preferred.', 'cache-job');
    expect(enrichmentStore.get('cache-job')).toBeNull();
    expect(relevanceStore.get('cache-job')).toBeNull();
  });

  it('keeps one bounded enrichment and relevance row per job', async () => {
    const database = createTestDatabase();
    databases.push(database);
    database.exec(`
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, description,
        remote_type, employment_type, source_name, source_type, first_seen_at,
        last_seen_at, active, seniority_level, status, created_at, updated_at
      ) VALUES (
        'bounded-job', 'Analyst', 'analyst', 'Fixture', 'fixture',
        'Linux required.', 'unknown', 'unknown', 'Fixture', 'fixture',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1,
        'unknown', 'new', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `);
    const enrichmentStore = new JobNlpEnrichmentRepository(database);
    const relevanceStore = new NlpRelevanceRepository(database);
    const first = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux required.',
      requirements: null,
      preferredQualifications: null,
    });
    enrichmentStore.save('bounded-job', first);
    relevanceStore.save('bounded-job', deriveSearchRelevance(first));
    enrichmentStore.save('bounded-job', first);
    relevanceStore.save('bounded-job', deriveSearchRelevance(first));

    const counts = database
      .prepare<[], { enrichments: number; relevance: number }>(
        `
      SELECT
        (SELECT COUNT(*) FROM job_nlp_enrichments) AS enrichments,
        (SELECT COUNT(*) FROM job_nlp_relevance) AS relevance
    `,
      )
      .get();
    expect(counts).toEqual({ enrichments: 1, relevance: 1 });
  });
});
