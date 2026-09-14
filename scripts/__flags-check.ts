import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const source = join('C:', 'Users', 'dusti', 'AppData', 'Roaming', 'Job Browser', 'data', 'jobs.sqlite');
const dir = mkdtempSync(join(tmpdir(), 'flags-'));
try {
  const copy = join(dir, 'jobs.sqlite');
  copyFileSync(source, copy);
  const db = new Database(copy, { readonly: true });
  const rows = db
    .prepare("SELECT setting_key, setting_value_json, updated_at FROM app_settings WHERE setting_key = 'nlp_capability_flags'")
    .all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}