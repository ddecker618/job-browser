import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { safeStorage } from 'electron';

import type { CredentialResolver } from '../discovery/credentialResolver.js';

interface UsaJobsCredentials {
  email: string;
  apiKey: string;
}

interface VaultFile {
  usajobs?: string;
}

export class CredentialVault implements CredentialResolver {
  public constructor(private readonly path: string) {}

  public async status(
    providerId: string,
  ): Promise<{ configured: boolean; available: boolean }> {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    return {
      configured: providerId === 'usajobs' && this.readEncrypted() !== null,
      available,
    };
  }

  public async resolve(
    providerId: string,
  ): Promise<Readonly<Record<string, string>> | null> {
    if (providerId !== 'usajobs') return null;
    const encrypted = this.readEncrypted();
    if (encrypted === null || !(await safeStorage.isAsyncEncryptionAvailable()))
      return null;
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const parsed = JSON.parse(decrypted.result) as UsaJobsCredentials;
    if (decrypted.shouldReEncrypt) await this.setUsaJobs(parsed);
    return { email: parsed.email, apiKey: parsed.apiKey };
  }

  public async setUsaJobs(credentials: UsaJobsCredentials): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error(
        'Secure operating-system credential storage is unavailable',
      );
    }
    const encrypted = await safeStorage.encryptStringAsync(
      JSON.stringify(credentials),
    );
    const current = this.readFile();
    current.usajobs = encrypted.toString('base64');
    this.writeFile(current);
  }

  public clearUsaJobs(): void {
    const current = this.readFile();
    delete current.usajobs;
    this.writeFile(current);
  }

  private readEncrypted(): Buffer | null {
    const value = this.readFile().usajobs;
    return value === undefined ? null : Buffer.from(value, 'base64');
  }

  private readFile(): VaultFile {
    if (!existsSync(this.path)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as VaultFile)
        : {};
    } catch {
      return {};
    }
  }

  private writeFile(value: VaultFile): void {
    if (Object.keys(value).length === 0) {
      if (existsSync(this.path)) unlinkSync(this.path);
      return;
    }
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, this.path);
  }
}
