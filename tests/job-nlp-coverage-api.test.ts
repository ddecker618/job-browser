import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { createApp } from '../src/server/app.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';

interface CoverageBody {
  coverage: {
    rows: { status: string; productionEffect: string }[];
    productionEffect: string;
  } | null;
  coverageSource: { snapshotId: string } | null;
  coverageContext: {
    captureState: 'no_application' | 'no_snapshot' | 'parsed' | 'failed';
    parsingError: string | null;
  } | null;
}

const databases: JobDatabase[] = [];
const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function newDatabase(): JobDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  runMigrations(db);
  db.prepare(
    'INSERT INTO app_settings (setting_key,setting_value_json,updated_at) VALUES (?,?,?)',
  ).run(
    'nlp_capability_flags',
    JSON.stringify({
      version: 'nlp-capability-flags-v1',
      jobIntelligenceExplanation: true,
      roleFamilySuggestion: false,
      searchTieBreak: false,
      searchProfileFeedback: false,
    }),
    '2026-09-11',
  );
  return db;
}

function insertJob(db: JobDatabase, id: string, description: string): void {
  db.prepare(
    'INSERT INTO jobs (id,title,normalized_title,company,normalized_company,description,remote_type,employment_type,source_name,source_type,first_seen_at,last_seen_at,active,seniority_level,status,created_at,updated_at,score,score_explanation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)',
  ).run(
    id,
    'Analyst',
    'analyst',
    'Fixture',
    'fixture',
    description,
    'unknown',
    'unknown',
    'Fixture',
    'fixture',
    '2026-01-01',
    '2026-01-01',
    'unknown',
    'applied',
    '2026-01-01',
    '2026-01-01',
    42,
    'fixture score',
  );
}

function insertApplication(
  db: JobDatabase,
  id: string,
  jobId: string,
  snapshotId: string | null,
): void {
  db.prepare(
    'INSERT INTO applications (id,job_id,status,title_at_application,company_at_application,created_at,updated_at,submitted_resume_snapshot_id) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    id,
    jobId,
    'applied',
    'Analyst',
    'Fixture',
    '2026-01-01',
    '2026-01-01',
    snapshotId,
  );
}

function insertSnapshot(
  db: JobDatabase,
  id: string,
  options: {
    parsingStatus?: 'parsed' | 'failed';
    parsingError?: string | null;
    normalizedText?: string | null;
  } = {},
): void {
  const parsingStatus = options.parsingStatus ?? 'parsed';
  new ResumeSnapshotRepository(db).insertSnapshot({
    id,
    sourceResumeId: null,
    liveResumeId: null,
    contentHash: 'hash',
    storageKey: 'key-' + id,
    originalFilename: 'resume.txt',
    mimeType: 'text/plain',
    extension: '.txt',
    sizeBytes: 5,
    parserVersion: 'resume-parser-v1',
    normalizationVersion: 'resume-normalization-v1',
    parsingStatus,
    parsingError: options.parsingError ?? null,
    reuseKey: null,
    createdAt: '2026-01-01',
    interpretationId: 'interpretation-' + id,
    interpretationSchemaVersion: 1,
    normalizedPayloadJson: JSON.stringify({
      schemaVersion: 1,
      normalizedText: options.normalizedText ?? 'linux',
    }),
    skills:
      parsingStatus === 'parsed'
        ? [
            {
              rawLabel: 'Linux',
              provenance: 'resume-extract:name',
              skillId: null,
            },
          ]
        : [],
    certifications: [],
  });
}

async function startServer(db: JobDatabase): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-coverage-'));
  dirs.push(dir);
  const app = createApp(db, {
    resumeDirectory: join(dir, 'resumes'),
    snapshotDirectory: join(dir, 'snapshots'),
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  return 'http://127.0.0.1:' + String(address.port);
}

async function analyze(base: string, jobId: string): Promise<CoverageBody> {
  const response = await fetch(base + '/api/jobs/' + jobId + '/intelligence', {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return (await response.json()) as CoverageBody;
}

function coverageOf(body: CoverageBody) {
  if (body.coverage === null) {
    throw new Error('Expected coverage to be present');
  }
  return body.coverage;
}

describe('P11 connected coverage API', () => {
  it('uses the submitted immutable snapshot and leaves the job score unchanged', async () => {
    const db = newDatabase();
    insertJob(db, 'coverage-job', 'Linux required.');
    insertSnapshot(db, 'snapshot-coverage');
    insertApplication(
      db,
      'application-coverage',
      'coverage-job',
      'snapshot-coverage',
    );
    const base = await startServer(db);
    const body = await analyze(base, 'coverage-job');
    const coverage = coverageOf(body);
    expect(coverage.rows[0]).toMatchObject({
      status: 'DIRECT',
      productionEffect: 'none',
    });
    expect(coverage.productionEffect).toBe('none');
    expect(body.coverageSource?.snapshotId).toBe('snapshot-coverage');
    expect(body.coverageContext).toEqual({
      captureState: 'parsed',
      parsingError: null,
    });
    expect(
      db.prepare("SELECT score FROM jobs WHERE id='coverage-job'").get(),
    ).toEqual({ score: 42 });
  });

  it('returns no_application coverageContext when no application exists', async () => {
    const db = newDatabase();
    insertJob(db, 'no-app-job', 'Linux required.');
    const base = await startServer(db);
    const body = await analyze(base, 'no-app-job');
    expect(body.coverage).toBeNull();
    expect(body.coverageSource).toBeNull();
    expect(body.coverageContext).toEqual({
      captureState: 'no_application',
      parsingError: null,
    });
    expect(
      db.prepare("SELECT score FROM jobs WHERE id='no-app-job'").get(),
    ).toEqual({ score: 42 });
  });

  it('returns no_snapshot coverageContext when application has no linked snapshot', async () => {
    const db = newDatabase();
    insertJob(db, 'no-snap-job', 'Linux required.');
    insertApplication(db, 'application-no-snap', 'no-snap-job', null);
    const base = await startServer(db);
    const body = await analyze(base, 'no-snap-job');
    expect(body.coverage).toBeNull();
    expect(body.coverageSource).toBeNull();
    expect(body.coverageContext).toEqual({
      captureState: 'no_snapshot',
      parsingError: null,
    });
    expect(
      db.prepare("SELECT score FROM jobs WHERE id='no-snap-job'").get(),
    ).toEqual({ score: 42 });
  });

  it('abstains across all rows and returns failed coverageContext for a failed snapshot', async () => {
    const db = newDatabase();
    insertJob(db, 'failed-job', 'Linux required.');
    insertSnapshot(db, 'snapshot-failed', {
      parsingStatus: 'failed',
      parsingError: 'Unsupported resume format',
      normalizedText: null,
    });
    insertApplication(
      db,
      'application-failed',
      'failed-job',
      'snapshot-failed',
    );
    const base = await startServer(db);
    const body = await analyze(base, 'failed-job');
    const coverage = coverageOf(body);
    expect(coverage.rows.length).toBeGreaterThan(0);
    expect(coverage.rows.every((row) => row.status === 'UNKNOWN')).toBe(true);
    expect(coverage.productionEffect).toBe('none');
    expect(body.coverageSource?.snapshotId).toBe('snapshot-failed');
    expect(body.coverageContext).toEqual({
      captureState: 'failed',
      parsingError: 'Unsupported resume format',
    });
    expect(
      db.prepare("SELECT score FROM jobs WHERE id='failed-job'").get(),
    ).toEqual({ score: 42 });
  });
});
