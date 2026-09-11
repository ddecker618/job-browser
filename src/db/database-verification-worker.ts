import { parentPort, workerData } from 'node:worker_threads';

import {
  serializeDatabaseVerificationError,
  verifyDatabaseSet,
} from './database-verification.js';

if (parentPort === null) {
  throw new Error('Database verification worker has no parent port');
}

const filename = (workerData as { filename?: unknown }).filename;
if (typeof filename !== 'string' || filename.length === 0) {
  parentPort.postMessage({
    ok: false,
    error: serializeDatabaseVerificationError(
      new Error('Database verification worker received no database path'),
    ),
  });
} else {
  try {
    verifyDatabaseSet(filename);
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: serializeDatabaseVerificationError(error),
    });
  }
}
