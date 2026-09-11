import Database from 'better-sqlite3';

import { runLocalProductionLoadAudit } from '../src/intelligence/nlp/productionLoadAudit.js';

const databasePath = process.argv[2];
if (!databasePath) {
  throw new Error(
    'Usage: tsx scripts/audit-local-nlp-production.ts <database-copy> [limit]',
  );
}
const limit = process.argv[3] === undefined ? 500 : Number(process.argv[3]);
const database = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});
try {
  const report = await runLocalProductionLoadAudit(database, { limit });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  database.close();
}
