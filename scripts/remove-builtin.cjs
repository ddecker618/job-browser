const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env['APPDATA'], 'Job Browser', 'data', 'jobs.sqlite');
const db = new Database(dbPath);

const result = db.prepare("DELETE FROM sources WHERE provider_id = 'builtin'").run();
console.log('Deleted Built In, changes:', result.changes);

const remaining = db.prepare('SELECT id, provider_id, display_name FROM sources').all();
for (const r of remaining) {
  console.log(r.id, '|', r.provider_id, '|', r.display_name);
}
db.close();
