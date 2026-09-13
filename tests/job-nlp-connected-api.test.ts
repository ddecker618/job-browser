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
    'INSERT INTO app_settings (setting_key,setting_value_json,updated_at) VALUES (?,?,?)',
  ).run(
    'nlp_capability_flags',
    JSON.stringify({
      version: 'nlp-capability-flags-v1',
      jobIntelligenceExplanation: true,
      roleFamilySuggestion: true,
      searchTieBreak: false,
      searchProfileFeedback: false,
    }),
    '2026-09-11',
  );
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
      summary: { factCount: number };
      comparison: {
        comparisonVersion: string;
        capabilities: { state: string }[];
        authority: {
          score: 'unchanged';
          eligibility: 'unchanged';
          ranking: 'unchanged';
        };
      };
      roleFamily: {
        suggestionVersion: string;
        state: string;
        suggestedFamilyKey: string | null;
        authority: { gate: 'never' };
      };
    };
    expect(first.summary.factCount).toBeGreaterThan(0);
    expect(first.comparison.comparisonVersion).toBe('nlp-comparison-v1');
    expect(first.comparison.capabilities).toHaveLength(3);
    expect(first.comparison.authority.score).toBe('unchanged');
    expect(first.roleFamily.suggestionVersion).toBe(
      'role-family-suggestion-v1',
    );
    expect(first.roleFamily.authority.gate).toBe('never');
    expect([
      'agreement',
      'deterministic-only',
      'nlp-only',
      'conflict',
      'unknown',
    ]).toContain(first.roleFamily.state);
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
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_comparisons').get(),
    ).toEqual({ count: 1 });
  });
  it('falls back visibly when the explanation capability is disabled', async () => {
    const { db, url } = await setup();
    db.prepare(
      'UPDATE app_settings SET setting_value_json=? WHERE setting_key=?',
    ).run(
      JSON.stringify({
        version: 'nlp-capability-flags-v1',
        jobIntelligenceExplanation: false,
        roleFamilySuggestion: false,
        searchTieBreak: false,
        searchProfileFeedback: false,
      }),
      'nlp_capability_flags',
    );
    const before = db.prepare('SELECT * FROM jobs').all();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence', {
      method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'nlp_capability_disabled',
    });
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual({ count: 0 });
  });

  it('rolls back role suggestions and search-profile feedback independently', async () => {
    const { db, url } = await setup();
    db.prepare(
      'UPDATE app_settings SET setting_value_json=? WHERE setting_key=?',
    ).run(
      JSON.stringify({
        version: 'nlp-capability-flags-v1',
        jobIntelligenceExplanation: true,
        roleFamilySuggestion: false,
        searchTieBreak: false,
        searchProfileFeedback: false,
      }),
      'nlp_capability_flags',
    );
    const analysis = await fetch(url + '/api/jobs/nlp-test/intelligence', {
      method: 'POST',
    });
    expect(analysis.status).toBe(200);
    expect((await analysis.json()) as { roleFamily: unknown }).toMatchObject({
      roleFamily: null,
    });
    const profileFeedback = await fetch(
      url + '/api/search-profile/intelligence',
    );
    expect(profileFeedback.status).toBe(409);
    expect(await profileFeedback.json()).toMatchObject({
      code: 'nlp_capability_disabled',
    });
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
  it('uses Job Intelligence by default when no capability flags are stored', async () => {
    const { db, url } = await setup();
    db.prepare('DELETE FROM app_settings WHERE setting_key=?').run(
      'nlp_capability_flags',
    );
    const before = db.prepare('SELECT * FROM jobs').all();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      summary: { factCount: number };
      comparison: { authority: { score: string } };
    };
    expect(body.summary.factCount).toBeGreaterThan(0);
    expect(body.comparison.authority.score).toBe('unchanged');
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual({ count: 1 });
  });

  it('serves role-family and search-profile EXPLANATION projections by default', async () => {
    const { db, url } = await setup();
    db.prepare('DELETE FROM app_settings WHERE setting_key=?').run(
      'nlp_capability_flags',
    );
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      roleFamily: {
        suggestionVersion: string;
        state: string;
        suggestedFamilyKey: string | null;
        authority: { gate: 'never' };
      };
    };
    expect(body.roleFamily.suggestionVersion).toBe('role-family-suggestion-v1');
    expect(body.roleFamily.authority.gate).toBe('never');
    expect([
      'agreement',
      'deterministic-only',
      'nlp-only',
      'conflict',
      'unknown',
    ]).toContain(body.roleFamily.state);
    const profile = await fetch(url + '/api/search-profile/intelligence');
    expect(profile.status).toBe(200);
    const projection = (await profile.json()) as {
      version: string;
      roleFamilies: unknown[];
      skillCoverage: { configuredCount: number; recognizedCount: number };
      preferenceAuthority: string;
      productionEffect: string;
    };
    expect(projection.version).toBe('search-profile-intelligence-v1');
    expect(Array.isArray(projection.roleFamilies)).toBe(true);
    expect(projection.skillCoverage.configuredCount).toBeGreaterThanOrEqual(0);
    expect(projection.preferenceAuthority).toBe('deterministic-only');
    expect(projection.productionEffect).toBe('none');
  });

  it('serves current cached analysis read-only via GET without persisting changes', async () => {
    const { db, url } = await setup();
    const posted = await fetch(url + '/api/jobs/nlp-test/intelligence', {
      method: 'POST',
    });
    expect(posted.status).toBe(200);
    const before = db.prepare('SELECT * FROM jobs').all();
    const beforeEnrichments = db
      .prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments')
      .get();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await posted.json());
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual(beforeEnrichments);
  });

  it('returns nlp_no_analysis from GET before anything is analyzed', async () => {
    const { db, url } = await setup();
    const before = db.prepare('SELECT * FROM jobs').all();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 'nlp_no_analysis',
    });
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments').get(),
    ).toEqual({ count: 0 });
  });

  it('refuses stale cached analysis via GET so output is never presented as current', async () => {
    const { db, url } = await setup();
    await fetch(url + '/api/jobs/nlp-test/intelligence', { method: 'POST' });
    db.prepare(
      "UPDATE jobs SET description='Python preferred.' WHERE id='nlp-test'",
    ).run();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 'nlp_no_analysis',
    });
  });

  it('gates GET like POST when the explanation capability is disabled', async () => {
    const { db, url } = await setup();
    db.prepare(
      'UPDATE app_settings SET setting_value_json=? WHERE setting_key=?',
    ).run(
      JSON.stringify({
        version: 'nlp-capability-flags-v1',
        jobIntelligenceExplanation: false,
        roleFamilySuggestion: false,
        searchTieBreak: false,
        searchProfileFeedback: false,
      }),
      'nlp_capability_flags',
    );
    const before = db.prepare('SELECT * FROM jobs').all();
    const response = await fetch(url + '/api/jobs/nlp-test/intelligence');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'nlp_capability_disabled',
    });
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual(before);
  });

  it('exposes read-only NLP worker status', async () => {
    const { url } = await setup();
    const response = await fetch(url + '/api/intelligence/status');
    const body = (await response.json()) as {
      worker: unknown;
      extractionVersion: string;
      documentVersion: string;
    };
    expect(response.status).toBe(200);
    expect(body.worker).toBeNull();
    expect(body.documentVersion).toMatch(/^document-v/);
    expect(body.extractionVersion).toMatch(/^job-nlp-v/);
  });
});
