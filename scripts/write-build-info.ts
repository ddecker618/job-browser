import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

let commit = 'local-dev';
try {
  commit = execSync('git rev-parse --short HEAD', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  commit = `build-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

writeFileSync(
  'build-info.json',
  `${JSON.stringify({ commit }, null, 2)}\n`,
  'utf8',
);
console.log(`Build info written to build-info.json: ${commit}`);
