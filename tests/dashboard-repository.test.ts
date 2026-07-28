import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import type { AppSettings } from '../src/models/dashboard.js';
import { DashboardRepository } from '../src/database/dashboardRepository.js';
import type { JobDatabase } from '../src/db/database.js';
import { IntelligenceEngine } from '../src/intelligence/intelligenceEngine.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

describe('DashboardRepository', () => {
  let database: JobDatabase;
  let dashboard: DashboardRepository;
  let jobId: string;

  beforeEach(() => {
    database = createTestDatabase();
    dashboard = new DashboardRepository(database);
    const sourceId = insertTestSource(database);
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      company: 'Dashboard Employer',
      normalizedCompany: 'dashboard employer',
      description: 'Monitor Splunk SIEM alerts on Linux.',
    });
    jobId = job.id;
    new JobRepository(database).upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    new IntelligenceEngine(database, () => undefined).analyze(
      loadCandidateProfile(),
      loadScoringConfig(),
    );
  });

  afterEach(() => database.close());

  it('builds dashboard, job detail, analytics, and settings read models', () => {
    expect(dashboard.getSummary()).toMatchObject({
      totalJobs: 1,
      topEmployer: 'Dashboard Employer',
    });
    expect(dashboard.listJobs()).toHaveLength(1);
    const detail = dashboard.getJob(jobId);
    expect(detail?.title).toBe('Cybersecurity Analyst');
    expect(detail?.skills).toEqual(
      expect.arrayContaining(['Splunk', 'SIEM', 'Linux']),
    );

    dashboard.updateJobMetadata(jobId, true, 'Follow up on Monday');
    expect(dashboard.getJob(jobId)).toMatchObject({
      favorite: true,
      notes: 'Follow up on Monday',
    });
    expect(dashboard.getAnalytics().topEmployers).toContainEqual({
      label: 'Dashboard Employer',
      value: 1,
    });

    const defaults: AppSettings = {
      databaseLocation: 'data/test.sqlite',
      defaultSearch: '',
      theme: 'dark' as const,
      defaultSort: 'score' as const,
      loggingLevel: 'info' as const,
      resumeDirectory: 'data/resumes',
      artifactDirectory: 'artifacts',
      targetRoles: [
        'systems administrator',
        'network administrator',
        'network analyst',
        'SOC analyst',
      ],
    };
    dashboard.saveSettings({ ...defaults, defaultSearch: 'security' });
    expect(dashboard.getSettings(defaults).defaultSearch).toBe('security');
  });

  it('manages resume metadata, proposals, and saved filters', () => {
    const resume = dashboard.addResume({
      displayName: 'Security Resume',
      originalFilename: 'resume.txt',
      storagePath: 'data/resumes/test.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
      parsingStatus: 'parsed',
      parsingError: null,
      extractedSkills: ['Splunk'],
      extractedCertifications: ['CompTIA Security+'],
    });
    dashboard.addResumeProposals(resume.id, ['Python'], ['CCNA']);

    const savedResume = dashboard.listResumes()[0];
    expect(savedResume?.displayName).toBe('Security Resume');
    expect(savedResume?.isDefault).toBe(true);
    expect(
      savedResume?.proposals.some(
        (proposal) =>
          proposal.proposedValue === 'Python' && proposal.status === 'pending',
      ),
    ).toBe(true);
    dashboard.renameResume(resume.id, 'Renamed Resume');
    expect(dashboard.getResume(resume.id)?.displayName).toBe('Renamed Resume');

    const filter = dashboard.saveFilter('Strong remote', {
      minScore: 75,
      remote: 'remote',
    });
    expect(dashboard.listSavedFilters()).toContainEqual(filter);
    dashboard.deleteFilter(filter.id);
    expect(dashboard.listSavedFilters()).toEqual([]);
  });
});
