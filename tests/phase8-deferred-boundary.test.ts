import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDatabase } from './helpers/test-database.js';

describe('Phase 8 deferred boundary', () => {
  it('contains no deferred persistence entities', () => {
    const database = createTestDatabase();
    try {
      const tables = database
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name.toLowerCase());
      for (const forbidden of [
        'users',
        'followups',
        'reminders',
        'application_materials',
        'company_aliases',
        'analytics_cache',
        'predictions',
        'synchronization',
      ]) {
        expect(tables).not.toContain(forbidden);
      }
    } finally {
      database.close();
    }
  });

  it('contains no deferred REST routes or renderer pages', () => {
    const app = readFileSync(
      join(process.cwd(), 'src', 'server', 'app.ts'),
      'utf8',
    );
    const routes = readFileSync(
      join(process.cwd(), 'src', 'client', 'App.tsx'),
      'utf8',
    );
    for (const forbidden of [
      '/api/auth',
      '/api/users',
      '/api/followups',
      '/api/reminders',
      '/api/predictions',
      '/api/sync',
      '/api/company-aliases',
    ]) {
      expect(app).not.toContain(forbidden);
    }
    expect(routes).not.toMatch(
      /path=["'](?:reapplications|followups|reminders|predictions)/i,
    );
    const pages = readdirSync(join(process.cwd(), 'src', 'client', 'pages'));
    expect(
      pages.some((name) =>
        /prediction|followup|reminder|companyalias/i.test(name),
      ),
    ).toBe(false);
  });
});
