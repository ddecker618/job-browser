import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runNlpPerformanceAudit,
} from '../src/intelligence/nlp/performanceAudit.js';

const compiledEvaluation = resolve(
  process.cwd(),
  'dist/src/intelligence/nlp/evaluation.js',
);

const coldImportMs = existsSync(compiledEvaluation)
  ? measureColdImport(compiledEvaluation)
  : null;
const report = runNlpPerformanceAudit({ coldImportMs });
console.log(JSON.stringify(report, null, 2));

function measureColdImport(modulePath: string): number {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(modulePath).href)});`,
    ],
    { stdio: 'ignore' },
  );
  if (result.status !== 0) {
    throw new Error(`Cold NLP module import failed with status ${result.status}`);
  }
  return performance.now() - started;
}
