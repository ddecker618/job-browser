import { openDatabase } from './src/db/database.js';
import { JobRepository } from './src/repositories/job-repository.js';

const db = openDatabase('data/job-browser.sqlite');
const repo = new JobRepository(db);
const job = db.prepare('SELECT id, status FROM jobs LIMIT 1').get() as any;
console.log('Before:', job.status, job.id);

try {
  const result = repo.changeStatus(job.id, { status: 'ignored', changedBy: 'test', reason: 'dashboard test' });
  console.log('Result:', result);
} catch (e) {
  console.error('Error:', e);
}

const after = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any;
console.log('After:', after.status);
db.close();
