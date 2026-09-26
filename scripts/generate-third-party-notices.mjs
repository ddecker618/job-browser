import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outputPath = join(root, 'THIRD_PARTY_NOTICES.md');
const checkOnly = process.argv.includes('--check');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function declaredLicense(packageJson, lockEntry) {
  if (typeof packageJson.license === 'string') return packageJson.license;
  if (Array.isArray(packageJson.licenses)) {
    return packageJson.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  return lockEntry.license ?? 'Not declared';
}

function repositoryUrl(packageJson) {
  const repository = packageJson.repository;
  if (typeof repository === 'string') return repository;
  if (repository && typeof repository.url === 'string') return repository.url;
  return packageJson.homepage ?? '';
}

function noticeFiles(packagePath) {
  return readdirSync(packagePath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(licen[cs]e|copying|notice)(\..*)?$/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

const packages = Object.entries(lock.packages)
  .filter(([packagePath, metadata]) => {
    if (!packagePath.startsWith('node_modules/')) return false;
    if (metadata.dev === true) return false;
    return existsSync(join(root, packagePath, 'package.json'));
  })
  .map(([packagePath, metadata]) => {
    const absolutePath = join(root, packagePath);
    const packageJson = JSON.parse(
      readFileSync(join(absolutePath, 'package.json'), 'utf8'),
    );
    return {
      name: packageJson.name ?? basename(packagePath),
      version: packageJson.version ?? metadata.version ?? 'unknown',
      license: declaredLicense(packageJson, metadata),
      repository: repositoryUrl(packageJson),
      notices: noticeFiles(absolutePath).map((file) => ({
        file,
        text: readFileSync(join(absolutePath, file), 'utf8').trim(),
      })),
    };
  })
  .sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );

const lines = [
  '# Third-Party Software Notices',
  '',
  `Job Browser includes third-party packages listed below. ${project.author}`,
  'does not claim ownership of those packages. Each package remains governed by',
  'its stated license and attribution terms.',
  '',
  'This file is generated from the installed production dependency tree by',
  '`npm run legal:notices`. Do not edit generated package entries manually.',
  '',
];

for (const pkg of packages) {
  lines.push(`## ${pkg.name} ${pkg.version}`, '');
  lines.push(`- Declared license: ${pkg.license}`);
  if (pkg.repository) lines.push(`- Project source: ${pkg.repository}`);
  lines.push('');
  if (pkg.notices.length === 0) {
    lines.push(
      '_No standalone license or notice file was present in the installed package._',
      '',
    );
    continue;
  }
  for (const notice of pkg.notices) {
    lines.push(`### ${notice.file}`, '');
    for (const line of notice.text.split(/\r?\n/)) {
      const normalizedLine = line.replace(/[ \t]+$/u, '');
      lines.push(normalizedLine ? `    ${normalizedLine}` : '');
    }
    lines.push('');
  }
}

const output = `${lines.join('\n').trimEnd()}\n`;
if (checkOnly) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
    console.error(
      'THIRD_PARTY_NOTICES.md is stale. Run npm run legal:notices and commit the result.',
    );
    process.exitCode = 1;
  } else {
    console.log(`Third-party notices are current (${packages.length} packages).`);
  }
} else {
  writeFileSync(outputPath, output, 'utf8');
  console.log(`Wrote notices for ${packages.length} production packages.`);
}
