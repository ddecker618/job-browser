import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ApplicationService,
  ApplicationServiceError,
} from '../src/applications/applicationService.js';
import type { JobDatabase } from '../src/db/database.js';
import { ApplicationRepository } from '../src/repositories/application-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';
import {
  captureResumeSnapshot,
  type PreparedResumeSnapshot,
} from '../src/resumes/resumeSnapshotCapture.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

const JOB_ID = '10000000-0000-4000-8000-000000000083';
const NOW = '2026-08-08T12:00:00.000Z';
const BASE = tmpdir();

describe('ApplicationService resume-snapshot submission path', () => {
  let database: JobDatabase;
  let applications: ApplicationRepository;
  let snapshots: ResumeSnapshotRepository;
  let service: ApplicationService;
  let sourceId: string;
  let currentTime: string;
  let applicationSequence: number;
  let eventSequence: number;
  const roots: string[] = [];
  let resumeRoot: string;
  let snapshotRoot: string;

  beforeEach(() => {
    database = createTestDatabase();
    applications = new ApplicationRepository(database);
    snapshots = new ResumeSnapshotRepository(database);
    sourceId = insertTestSource(database, { id: 'source:opaque/submission' });
    insertJob(JOB_ID, sourceId);
    const root = mkdtempSync(join(BASE, 'jb-submission-'));
    roots.push(root);
    resumeRoot = join(root, 'resumes');
    snapshotRoot = join(root, 'snapshots');
    mkdirSync(resumeRoot, { recursive: true });
    mkdirSync(snapshotRoot, { recursive: true });
    const resumePath = join(resumeRoot, 'resume-submission.txt');
    writeFileSync(resumePath, 'Security Engineer resume with SIEM');
    insertResume('resume-submission', resumePath);
    database
      .prepare(
        `INSERT INTO skills (id, name, normalized_name) VALUES (?, ?, ?)`,
      )
      .run('skill-siem', 'SIEM', 'siem');
    currentTime = NOW;
    applicationSequence = 0;
    eventSequence = 0;
    service = new ApplicationService(database, {
      now: () => currentTime,
      randomUUID: () => `server-application-${String(++applicationSequence)}`,
    });
  });

  afterEach(() => {
    database.close();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('commits the Snapshot and the Applied event atomically with a derived projection', async () => {
    const prepared = await capturePrepared();

    const result = service.createApplication(createCommand(), prepared);

    expect(result.replayed).toBe(false);
    expect(prepared.insertInput).not.toBeNull();
    expect(result.application).toMatchObject({
      id: 'server-application-1',
      jobId: JOB_ID,
      status: 'applied',
      submittedResumeSnapshotId: prepared.snapshot.id,
    });
    expect(result.event).toMatchObject({
      eventType: 'applied',
      submittedResumeSnapshotId: prepared.snapshot.id,
    });
    const persisted = snapshots.findById(prepared.snapshot.id);
    expect(persisted?.id).toBe(prepared.snapshot.id);
    expect(persisted?.interpretation.skills[0]?.skillId).toBe('skill-siem');
    expect(snapshots.listStorageKeys()).toEqual([prepared.snapshot.storageKey]);
  });

  it('replays the identical command through Snapshot reuse without a second row', async () => {
    const first = await capturePrepared();
    service.createApplication(createCommand(), first);

    const second = await capturePrepared();
    expect(second.reused).toBe(true);

    const replay = service.createApplication(createCommand(), second);

    expect(replay.replayed).toBe(true);
    expect(replay.application.submittedResumeSnapshotId).toBe(
      first.snapshot.id,
    );
    expect(snapshots.listStorageKeys()).toEqual([first.snapshot.storageKey]);
    second.cleanup();
  });

  it('corrects an Applied association through a replacement Applied event', async () => {
    const original = service.createApplication(createCommand());
    expect(original.application.submittedResumeSnapshotId).toBeNull();

    const correction = await capturePrepared();
    currentTime = '2026-08-10T12:00:00.000Z';
    const targetEvent = original.event.id;

    const replaced = service.appendEvent(
      'server-application-1',
      {
        kind: 'replace',
        eventId: 'correction-event',
        targetEventId: targetEvent,
        replacementEventType: 'applied',
        occurredAt: '2026-08-10T09:00:00.000Z',
        occurrencePrecision: 'exact',
        resumeId: 'resume-submission',
        reason: null,
      },
      correction,
    );

    expect(replaced.event).toMatchObject({
      eventType: 'applied',
      resultingStatus: 'applied',
      supersedesEventId: targetEvent,
      supersedeAction: 'replace',
      submittedResumeSnapshotId: correction.snapshot.id,
    });
    expect(replaced.application.submittedResumeSnapshotId).toBe(
      correction.snapshot.id,
    );
    const timeline = applications.getTimeline('server-application-1');
    const originalNow = timeline.find(
      (candidate) => candidate.id === targetEvent,
    );
    expect(originalNow?.supersededByEventId).toBe('correction-event');
  });

  it('rejects a Snapshot on any non-Applied event even before schema constraints', () => {
    service.createApplication(createCommand());

    expect(() =>
      service.appendEvent(
        'server-application-1',
        lifecycleCommand(),
        preparedSnapshotPlaceholder(),
      ),
    ).toThrow(ApplicationServiceError);
  });

  it('rejects a resumeId supplied to a non-Applied replacement at validation time', () => {
    service.createApplication(createCommand());
    let caught: ApplicationServiceError | null = null;
    try {
      service.appendEvent('server-application-1', {
        kind: 'replace',
        eventId: 'bad-resume-event',
        targetEventId: 'creation-event',
        replacementEventType: 'technical_interview',
        occurredAt: '2026-08-10T09:00:00.000Z',
        occurrencePrecision: 'exact',
        resumeId: 'resume-submission',
      });
    } catch (error) {
      caught = error as ApplicationServiceError;
    }
    expect(caught?.code).toBe('application_validation_failed');
    expect(caught?.details['reason']).toContain(
      'A Resume snapshot can only be attached to an Applied event',
    );
  });

  function createCommand() {
    return {
      eventId: 'creation-event',
      jobId: JOB_ID,
      occurredAt: '2026-08-01T10:00:00-05:00',
      occurrencePrecision: 'exact' as const,
      titleAtApplication: 'Security Engineer',
      companyAtApplication: 'Example Company',
      locationAtApplication: 'Remote',
      applicationUrl: 'https://jobs.example/apply/83',
      sourceId,
      notes: null,
    };
  }

  function lifecycleCommand() {
    return {
      kind: 'lifecycle' as const,
      eventId: `lifecycle-${String(++eventSequence)}`,
      eventType: 'technical_interview' as const,
      occurredAt: '2026-08-10T09:00:00.000Z',
      occurrencePrecision: 'exact' as const,
      notes: null,
    };
  }

  function insertJob(jobId: string, memberSourceId: string | null): void {
    const job = createJobFixture({
      id: jobId,
      externalId: `external:${jobId}`,
      postingUrl: `https://jobs.example/${jobId}`,
      title: 'Current Security Engineer',
      normalizedTitle: 'current security engineer',
      company: 'Current Example Company',
      normalizedCompany: 'current example company',
      location: 'Current Remote',
      status: 'new',
    });
    const selectedSource = memberSourceId ?? sourceId;
    new JobRepository(database).upsertObservation({
      job,
      sourceId: selectedSource,
      providerId: 'observed-provider',
      rawData: job,
    });
    if (memberSourceId === null) {
      database.prepare('DELETE FROM job_sources WHERE job_id = ?').run(jobId);
    }
  }

  function insertResume(resumeId: string, resumePath: string): void {
    database
      .prepare(
        `INSERT INTO resumes (
          id, display_name, original_filename, storage_path, mime_type, size_bytes,
          is_default, parsing_status, extracted_skills_json,
          extracted_certifications_json, parsing_error, created_at, updated_at
        ) VALUES (?, 'Submission', 'resume-submission.txt', ?, 'text/plain', ?,
          0, 'parsed', '[]', '[]', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(resumeId, resumePath, sizeOf(resumePath));
  }

  function capturePrepared(): Promise<PreparedResumeSnapshot> {
    return captureResumeSnapshot({
      database,
      resumeId: 'resume-submission',
      resumeDirectory: resumeRoot,
      snapshotRoot,
      profile: profile(),
      config: config(),
    });
  }

  function preparedSnapshotPlaceholder(): PreparedResumeSnapshot {
    return {
      snapshot: {
        id: 'placeholder-snapshot',
        sourceResumeId: 'resume-submission',
        liveResumeId: 'resume-submission',
        contentHash: 'a'.repeat(64),
        storageKey: 'placeholder-key',
        originalFilename: 'resume-submission.txt',
        mimeType: 'text/plain',
        extension: '.txt',
        sizeBytes: 1,
        parserVersion: 'resume-parser-v1',
        normalizationVersion: 'resume-normalization-v1',
        parsingStatus: 'parsed',
        parsingError: null,
        reuseKey: null,
        createdAt: NOW,
      },
      insertInput: null,
      reused: false,
      cleanup: () => undefined,
    };
  }

  function profile() {
    return candidateProfileSchema.parse({
      id: 'profile-test',
      name: 'Test Candidate',
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: 25,
      secondarySearchRadiusMiles: 50,
      remotePreference: 'preferred',
      desiredSalary: { minimum: 60_000, target: 75_000, currency: 'USD' },
      certifications: [],
      degrees: [],
      skills: ['AWS'],
      clearanceEligibility: 'unknown',
      yearsOfExperience: 4,
      desiredJobTitles: ['Security Analyst'],
      excludedJobTitles: [],
      desiredEmploymentTypes: ['full-time'],
      degreeRequired: false,
      degreeInProgressOk: true,
    });
  }

  function config() {
    return scoringConfigSchema.parse({
      weights: {
        title: 10,
        skills: 30,
        certifications: 20,
        location: 10,
        remotePreference: 10,
        salary: 5,
        experience: 5,
        employmentType: 5,
        recency: 5,
      },
      recommendationThresholds: {
        applyImmediately: 85,
        strongMatch: 70,
        possibleMatch: 50,
      },
      recency: { freshDays: 7, recentDays: 14 },
      skills: [{ name: 'SIEM', aliases: ['siem'] }],
      certifications: [{ name: 'Security+', aliases: ['security+'] }],
    });
  }
});

function sizeOf(path: string): number {
  return statSync(path).size;
}
