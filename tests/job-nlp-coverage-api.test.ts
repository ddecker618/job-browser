import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { createApp } from '../src/server/app.js';
import { ResumeSnapshotRepository } from '../src/repositories/resume-snapshot-repository.js';
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
describe('P11 connected coverage API', () => {
  it('uses the submitted immutable snapshot and leaves the job score unchanged', async () => {
    const db = openDatabase(':memory:');
    databases.push(db);
    runMigrations(db);
    db.prepare(
      "INSERT INTO jobs (id,title,normalized_title,company,normalized_company,description,remote_type,employment_type,source_name,source_type,first_seen_at,last_seen_at,active,seniority_level,status,created_at,updated_at,score,score_explanation) VALUES ('coverage-job','Analyst','analyst','Fixture','fixture','Linux required.','unknown','unknown','Fixture','fixture','2026-01-01','2026-01-01',1,'unknown','applied','2026-01-01','2026-01-01',42,'fixture score')",
    ).run();
    new ResumeSnapshotRepository(db).insertSnapshot({
      id: 'snapshot-coverage',
      sourceResumeId: null,
      liveResumeId: null,
      contentHash: 'hash',
      storageKey: 'key',
      originalFilename: 'resume.txt',
      mimeType: 'text/plain',
      extension: '.txt',
      sizeBytes: 5,
      parserVersion: 'resume-parser-v1',
      normalizationVersion: 'resume-normalization-v1',
      parsingStatus: 'parsed',
      parsingError: null,
      reuseKey: null,
      createdAt: '2026-01-01',
      interpretationId: 'interpretation-coverage',
      interpretationSchemaVersion: 1,
      normalizedPayloadJson: JSON.stringify({
        schemaVersion: 1,
        normalizedText: 'linux',
      }),
      skills: [
        { rawLabel: 'Linux', provenance: 'resume-extract:name', skillId: null },
      ],
      certifications: [],
    });
    db.prepare(
      "INSERT INTO applications (id,job_id,status,title_at_application,company_at_application,created_at,updated_at,submitted_resume_snapshot_id) VALUES ('application-coverage','coverage-job','applied','Analyst','Fixture','2026-01-01','2026-01-01','snapshot-coverage')",
    ).run();
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
    const response = await fetch(
      'http://127.0.0.1:' +
        String(address.port) +
        '/api/jobs/coverage-job/intelligence',
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      coverage: {
        rows: { status: string; productionEffect: string }[];
        productionEffect: string;
      };
      coverageSource: { snapshotId: string };
    };
    expect(body.coverage.rows[0]).toMatchObject({
      status: 'DIRECT',
      productionEffect: 'none',
    });
    expect(body.coverage.productionEffect).toBe('none');
    expect(body.coverageSource.snapshotId).toBe('snapshot-coverage');
    expect(
      db.prepare("SELECT score FROM jobs WHERE id='coverage-job'").get(),
    ).toEqual({ score: 42 });
  });
});
