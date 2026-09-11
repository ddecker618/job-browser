import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { createApp } from '../src/server/app.js';
const databases: JobDatabase[] = [];
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  runMigrations(db);
  db.prepare(
    "INSERT INTO jobs (id,title,normalized_title,company,normalized_company,description,remote_type,employment_type,source_name,source_type,first_seen_at,last_seen_at,active,seniority_level,status,created_at,updated_at,score,score_explanation) VALUES ('nlp-test','Analyst','analyst','Fixture','fixture','Linux required.','unknown','unknown','Fixture','fixture','2026-01-01','2026-01-01',1,'unknown','new','2026-01-01','2026-01-01',42,'fixture score')",
  ).run();
  const dir = mkdtempSync(join(tmpdir(), 'nlp-connected-'));
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
  return { db, url: 'http://127.0.0.1:' + String(address.port) };
}
describe('connected shadow NLP API', () => {
  it('persists, reuses and invalidates shadow results without production changes', async () => {
    const { db, url } = await setup();
    const before = db.prepare('SELECT * FROM jobs').all();
    const analyze = () =>
      fetch(url + '/api/jobs/nlp-test/intelligence', { method: 'POST' });
    const response = await analyze();
    expect(response.status).toBe(200);
    const first = (await response.json()) as {
      sourceTextHash: string;
      generatedAt: string;
      factCount: number;
    };
    expect(first.factCount).toBeGreaterThan(0);
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
    const second = (await (await analyze()).json()) as typeof first;
    expect(second).toEqual(first);
    db.prepare(
      "UPDATE jobs SET description='Python preferred.' WHERE id='nlp-test'",
    ).run();
    const third = (await (await analyze()).json()) as typeof first;
    expect(third.sourceTextHash).not.toBe(first.sourceTextHash);
    expect(db.prepare('SELECT score FROM jobs').get()).toEqual({ score: 42 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual({ count: 1 });
  });
  it('returns missing and oversized errors without persisting', async () => {
    const { db, url } = await setup();
    expect(
      (await fetch(url + '/api/jobs/missing/intelligence', { method: 'POST' }))
        .status,
    ).toBe(404);
    db.prepare('UPDATE jobs SET description=?').run('x'.repeat(50001));
    expect(
      (await fetch(url + '/api/jobs/nlp-test/intelligence', { method: 'POST' }))
        .status,
    ).toBe(422);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual({ count: 0 });
  });
});
