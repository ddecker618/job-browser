import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardRepository } from '../src/database/dashboardRepository.js';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';
import { createApp } from '../src/server/app.js';

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

function newDatabase(): JobDatabase {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database);
  database
    .prepare(
      'INSERT INTO app_settings (setting_key,setting_value_json,updated_at) VALUES (?,?,?)',
    )
    .run(
      'nlp_capability_flags',
      JSON.stringify({
        version: 'nlp-capability-flags-v1',
        jobIntelligenceExplanation: true,
        roleFamilySuggestion: false,
        searchTieBreak: false,
        searchProfileFeedback: false,
      }),
      '2026-09-28',
    );
  return database;
}

function insertJob(
  database: JobDatabase,
  id: string,
  description: string,
): void {
  database
    .prepare(
      `INSERT INTO jobs (
        id,title,normalized_title,company,normalized_company,description,
        remote_type,employment_type,source_name,source_type,first_seen_at,
        last_seen_at,active,seniority_level,status,created_at,updated_at,score,
        score_explanation
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
    )
    .run(
      id,
      'Systems Analyst',
      'systems analyst',
      'Fixture Employer',
      'fixture employer',
      description,
      'unknown',
      'unknown',
      'Fixture',
      'fixture',
      '2026-01-01',
      '2026-01-01',
      'unknown',
      'new',
      '2026-01-01',
      '2026-01-01',
      42,
      'fixture score',
    );
}

function saveResume(
  database: JobDatabase,
  resumeDirectory: string,
  contents: string,
  options: { filename?: string; displayName?: string } = {},
): { id: string; path: string } {
  const id = randomUUID();
  const filename = options.filename ?? `${id}.txt`;
  const path = join(resumeDirectory, filename);
  mkdirSync(resumeDirectory, { recursive: true });
  writeFileSync(path, contents, 'utf8');
  const resume = new DashboardRepository(database).addResume({
    displayName: options.displayName ?? 'P38 test resume',
    originalFilename: options.filename ?? 'saved-resume.txt',
    storagePath: path,
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength(contents),
    parsingStatus: 'parsed',
    parsingError: null,
    extractedSkills: [],
    extractedCertifications: [],
  });
  return { id: resume.id, path };
}

function insertSnapshot(database: JobDatabase, id: string): void {
  new ResumeSnapshotRepository(database).insertSnapshot({
    id,
    sourceResumeId: null,
    liveResumeId: null,
    contentHash: 'historical-hash-' + id,
    storageKey: 'historical-key-' + id,
    originalFilename: 'submitted-resume.txt',
    mimeType: 'text/plain',
    extension: '.txt',
    sizeBytes: 12,
    parserVersion: 'resume-parser-v1',
    normalizationVersion: 'resume-normalization-v1',
    parsingStatus: 'parsed',
    parsingError: null,
    reuseKey: null,
    createdAt: '2026-01-01',
    interpretationId: 'interpretation-' + id,
    interpretationSchemaVersion: 1,
    normalizedPayloadJson: JSON.stringify({
      schemaVersion: 1,
      normalizedText: 'linux',
    }),
    skills: [
      { rawLabel: 'Linux', provenance: 'submitted-fixture', skillId: null },
    ],
    certifications: [],
  });
}

async function startServer(
  database: JobDatabase,
  jobDescription = 'Linux required. Splunk required. AWS preferred.',
): Promise<{ url: string; resumeDirectory: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'current-resume-preview-'));
  directories.push(directory);
  const resumeDirectory = join(directory, 'resumes');
  insertJob(database, 'p38-job', jobDescription);
  const app = createApp(database, {
    resumeDirectory,
    snapshotDirectory: join(directory, 'snapshots'),
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return { url: 'http://127.0.0.1:' + String(address.port), resumeDirectory };
}

async function analyze(url: string): Promise<void> {
  const response = await fetch(url + '/api/jobs/p38-job/intelligence', {
    method: 'POST',
  });
  expect(response.status).toBe(200);
}

function databaseSnapshot(database: JobDatabase): string {
  const tables = database
    .prepare<
      [],
      { name: string }
    >("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const rows = Object.fromEntries(
    tables.map(({ name }) => {
      const identifier = name.replaceAll('"', '""');
      return [name, database.prepare(`SELECT * FROM "${identifier}"`).all()];
    }),
  );
  return JSON.stringify(rows);
}

async function postCurrentPreview(
  url: string,
  body: unknown,
  jobId = 'p38-job',
): Promise<Response> {
  return fetch(
    url +
      '/api/jobs/' +
      encodeURIComponent(jobId) +
      '/intelligence/current-resume-preview',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('P38 current-resume preview API', () => {
  it('compares an explicit saved resume without an Application or data writes', async () => {
    const database = newDatabase();
    const { url, resumeDirectory } = await startServer(database);
    const privateMarker = 'resume-secret-marker@example.invalid';
    const resume = saveResume(
      database,
      resumeDirectory,
      `Linux SIEM ${privateMarker}`,
      {
        displayName: 'Candidate private@example.invalid',
      },
    );
    await analyze(url);
    const before = databaseSnapshot(database);

    const response = await postCurrentPreview(url, { resumeId: resume.id });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      source: string;
      resumeId: string;
      parserVersion: string;
      normalizationVersion: string;
      captureState: string;
      productionEffect: string;
      coverage: {
        rows: { phrase: string; status: string; productionEffect: string }[];
        productionEffect: string;
      } | null;
    };

    expect(body).toMatchObject({
      source: 'current_resume_preview',
      resumeId: resume.id,
      parserVersion: 'resume-parser-v1',
      normalizationVersion: 'resume-normalization-v1',
      captureState: 'current_resume_preview',
      productionEffect: 'none',
    });
    expect(body.coverage?.productionEffect).toBe('none');
    const coverageStatuses = new Set(
      body.coverage?.rows.map((row) => row.status),
    );
    expect(coverageStatuses).toEqual(
      new Set(['DIRECT', 'STRONG_RELATED', 'MISSING', 'UNKNOWN']),
    );
    expect(
      body.coverage?.rows.every((row) => row.productionEffect === 'none'),
    ).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(privateMarker);
    expect(serialized).not.toContain(resume.path);
    expect(serialized).not.toContain('private@example.invalid');
    expect(databaseSnapshot(database)).toBe(before);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM applications').get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM resume_snapshots').get(),
    ).toEqual({ count: 0 });
  });

  it('keeps submitted historical evidence intact while returning a separate preview', async () => {
    const database = newDatabase();
    const { url, resumeDirectory } = await startServer(
      database,
      'Linux required. Windows Server preferred.',
    );
    insertSnapshot(database, 'submitted-snapshot-p38');
    database
      .prepare(
        `INSERT INTO applications (
          id,job_id,status,title_at_application,company_at_application,
          created_at,updated_at,submitted_resume_snapshot_id
        ) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        'submitted-application-p38',
        'p38-job',
        'applied',
        'Systems Analyst',
        'Fixture Employer',
        '2026-01-01',
        '2026-01-01',
        'submitted-snapshot-p38',
      );
    const currentResume = saveResume(
      database,
      resumeDirectory,
      'Windows Server',
      { displayName: 'Current Windows resume' },
    );
    await analyze(url);
    const before = databaseSnapshot(database);

    const current = await postCurrentPreview(url, {
      resumeId: currentResume.id,
    });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      source: 'current_resume_preview',
      resumeId: currentResume.id,
    });
    expect(databaseSnapshot(database)).toBe(before);

    const historical = await fetch(url + '/api/jobs/p38-job/intelligence');
    expect(historical.status).toBe(200);
    const historicalBody = (await historical.json()) as {
      coverageSource: { snapshotId: string } | null;
      coverage: { rows: { status: string }[] } | null;
    };
    expect(historicalBody.coverageSource?.snapshotId).toBe(
      'submitted-snapshot-p38',
    );
    expect(historicalBody.coverage?.rows[0]?.status).toBe('DIRECT');
    expect(databaseSnapshot(database)).toBe(before);
  });

  it('returns bounded errors for malformed, extra, missing, and unavailable resumes', async () => {
    const database = newDatabase();
    const { url, resumeDirectory } = await startServer(database);
    await analyze(url);
    const malformed = await postCurrentPreview(url, { resumeId: 'not-a-uuid' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: 'invalid_resume_id' });

    const extra = await postCurrentPreview(url, {
      resumeId: randomUUID(),
      storagePath: 'C:\\private\\resume.txt',
    });
    expect(extra.status).toBe(400);
    expect(JSON.stringify(await extra.json())).not.toContain('C:\\private');

    const missing = await postCurrentPreview(url, { resumeId: randomUUID() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'resume_not_found' });

    const resume = saveResume(database, resumeDirectory, 'Linux');
    unlinkSync(resume.path);
    const unavailable = await postCurrentPreview(url, { resumeId: resume.id });
    expect(unavailable.status).toBe(422);
    const unavailableCopy = unavailable.clone();
    expect(await unavailable.json()).toMatchObject({
      code: 'current_resume_unavailable',
    });
    expect(JSON.stringify(await unavailableCopy.json())).not.toContain(
      resume.path,
    );
  });

  it('abstains safely on parser failure and exposes only safe selector labels', async () => {
    const database = newDatabase();
    const { url, resumeDirectory } = await startServer(database);
    const secret = 'API_KEY=never-return-this-marker';
    const resume = saveResume(database, resumeDirectory, secret, {
      filename: 'unsupported.rtf',
      displayName: 'C:\\private\\resume secret@example.invalid',
    });
    await analyze(url);
    const before = databaseSnapshot(database);

    const response = await postCurrentPreview(url, { resumeId: resume.id });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      captureState: string;
      coverage: unknown;
      parsingError?: string;
    };
    expect(body.captureState).toBe('failed');
    expect(body.coverage).toBeNull();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Unsupported resume format');
    expect(serialized).not.toContain(resume.path);
    expect(databaseSnapshot(database)).toBe(before);

    const optionsResponse = await fetch(url + '/api/resume-preview-options');
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()) as {
      id: string;
      displayName: string;
    }[];
    expect(options).toEqual([
      { id: resume.id, displayName: '[path redacted] [email redacted]' },
    ]);
    const optionsText = JSON.stringify(options);
    expect(optionsText).not.toContain(secret);
    expect(optionsText).not.toContain('secret@example.invalid');
    expect(optionsText).not.toContain(resume.path);
  });
});
