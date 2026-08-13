import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const betterSqlite3Entry = createRequire(import.meta.url).resolve(
  'better-sqlite3',
);

export function leaveCommittedWal(
  databasePath: string,
  value = 'wal-only',
): void {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const fs = require('node:fs');
        const Database = require(process.argv[2]);
        const database = new Database(process.argv[1]);
        const journalMode = database.pragma('journal_mode', { simple: true });
        if (journalMode !== 'wal') throw new Error('Expected WAL mode');
        database.pragma('wal_autocheckpoint = 0');
        database.prepare('INSERT INTO recovery_marker (value) VALUES (?)').run(process.argv[3]);
        fs.writeSync(1, 'committed');
        process.kill(process.pid, 'SIGKILL');
      `,
      databasePath,
      betterSqlite3Entry,
      value,
    ],
    {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    },
  );

  if (result.error !== undefined) throw result.error;
  if (result.stdout !== 'committed') {
    throw new Error(
      `WAL fixture child did not commit as expected: ${result.stderr}`,
    );
  }
  if (result.status === 0) {
    throw new Error('WAL fixture child exited cleanly instead of being killed');
  }
  if (!existsSync(`${databasePath}-wal`)) {
    throw new Error('WAL fixture child did not leave a WAL file');
  }
  if (statSync(`${databasePath}-wal`).size <= 32) {
    throw new Error('WAL fixture child did not leave a committed WAL frame');
  }
}
