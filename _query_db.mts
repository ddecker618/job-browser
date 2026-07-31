import Database from 'better-sqlite3';
const db = new Database('data/job-browser.sqlite', { readonly: true });

console.log('=== RUNS TABLE ===');
const runs = db.prepare('SELECT id, source_id, status, started_at, completed_at, jobs_discovered, jobs_inserted, records_rejected, provider_id, trigger, error_message FROM runs ORDER BY started_at DESC LIMIT 20').all();
console.log(JSON.stringify(runs, null, 2));

console.log('\n=== SUMMARY QUERY ===');
const summary = db.prepare(`SELECT 
  MAX(completed_at) AS last_run,
  COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN jobs_discovered ELSE 0 END), 0) AS found_today,
  COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN jobs_inserted ELSE 0 END), 0) AS inserted_today
FROM runs`).get();
console.log(JSON.stringify(summary, null, 2));

console.log('\n=== SOURCES TABLE ===');
const sources = db.prepare("SELECT id, display_name, provider_id, health_status, last_successful_run FROM sources").all();
console.log(JSON.stringify(sources, null, 2));

db.close();
