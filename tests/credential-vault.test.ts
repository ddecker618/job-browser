import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: () => Promise.resolve(true),
    encryptStringAsync: (value: string) =>
      Promise.resolve(
        Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
      ),
    decryptStringAsync: (value: Buffer) => {
      const encoded = value.toString().replace(/^encrypted:/, '');
      return Promise.resolve({
        result: Buffer.from(encoded, 'base64').toString(),
        shouldReEncrypt: false,
      });
    },
  },
}));

import { CredentialVault } from '../src/desktop/credentialVault.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('credential vault', () => {
  it('stores USAJOBS credentials encrypted and exposes only status', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-browser-vault-'));
    directories.push(directory);
    const path = join(directory, 'credentials.json');
    const vault = new CredentialVault(path);
    await vault.setUsaJobs({
      email: 'person@example.com',
      apiKey: 'top-secret-key',
    });
    const stored = readFileSync(path, 'utf8');
    expect(stored).not.toContain('person@example.com');
    expect(stored).not.toContain('top-secret-key');
    expect(await vault.status('usajobs')).toEqual({
      configured: true,
      available: true,
    });
    expect(await vault.resolve('usajobs')).toEqual({
      email: 'person@example.com',
      apiKey: 'top-secret-key',
    });
    vault.clearUsaJobs();
    expect(await vault.status('usajobs')).toEqual({
      configured: false,
      available: true,
    });
  });
});
