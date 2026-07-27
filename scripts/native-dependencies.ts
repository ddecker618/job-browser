import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const commandEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key.toLowerCase() !== 'npm_config_allow_scripts',
  ),
);

export function installElectronNativeDependencies(): void {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules', 'prebuild-install', 'bin.js'),
      '--runtime=electron',
      '--target=42.0.0',
    ],
    {
      cwd: resolve('node_modules', 'better-sqlite3'),
      env: commandEnvironment,
      stdio: 'inherit',
    },
  );
}

export function restoreNodeNativeDependencies(): void {
  const npmCli = process.env['npm_execpath'];
  if (!npmCli)
    throw new Error('npm_execpath is required to rebuild native dependencies');
  execFileSync(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], {
    env: commandEnvironment,
    stdio: 'inherit',
  });
}
