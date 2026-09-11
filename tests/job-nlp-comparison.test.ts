import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { NlpComparisonRepository } from '../src/database/nlpComparisonRepository.js';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import {
  buildNlpComparisonReport,
  summarizeNlpComparisons,
} from '../src/intelligence/nlp/comparison.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('persisted NLP comparison (P19)', () => {
  it('preserves both interpretations, reports conflicts, and stays bounded per job', async () => {
    const database = createTestDatabase();
    databases.push(database);
    database.exec(`INSERT INTO jobs (
      id,title,normalized_title,company,normalized_company,description,
      remote_type,employment_type,source_name,source_type,first_seen_at,last_seen_at,
      active,seniority_level,status,created_at,updated_at,clearance_requirement,
      estimated_experience_years
    ) VALUES ('compare-job','Analyst','analyst','Fixture','fixture',
      'Top Secret clearance required. This is a remote role. 5 years experience required.',
      'onsite','unknown','Fixture','fixture','2026-01-01','2026-01-01',1,
      'unknown','new','2026-01-01','2026-01-01','Secret',3)`);
    const enrichment = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description:
        'Top Secret clearance required. This is a remote role. 5 years experience required.',
      requirements: null,
      preferredQualifications: null,
    });
    const report = buildNlpComparisonReport('compare-job', enrichment, {
      clearanceRequirement: 'Secret',
      remoteType: 'onsite',
      location: null,
      estimatedExperienceYears: 3,
    });
    expect(
      report.capabilities.filter((item) => item.state === 'conflict').length,
    ).toBeGreaterThan(0);
    expect(report.authority).toEqual({
      score: 'unchanged',
      eligibility: 'unchanged',
      ranking: 'unchanged',
    });
    const repository = new NlpComparisonRepository(database);
    repository.save(report);
    repository.save(report);
    expect(repository.get('compare-job')).toEqual(report);
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM job_nlp_comparisons')
        .get(),
    ).toEqual({ count: 1 });
    expect(summarizeNlpComparisons([report]).conflictRate).toBeGreaterThan(0);
    database
      .prepare("UPDATE jobs SET description='Changed' WHERE id='compare-job'")
      .run();
    expect(repository.get('compare-job')).toBeNull();
  });
});
