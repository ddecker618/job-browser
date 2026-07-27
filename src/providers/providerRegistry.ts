import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { JobProvider } from './baseProvider.js';

const DEFAULT_PROVIDER_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export class ProviderRegistry {
  private readonly providers = new Map<string, JobProvider>();

  public register(provider: JobProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider is already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  public get(providerId: string): JobProvider {
    const provider = this.providers.get(providerId);
    if (provider === undefined) {
      throw new Error(`Provider is not registered: ${providerId}`);
    }
    return provider;
  }

  public list(): readonly JobProvider[] {
    return [...this.providers.values()];
  }

  public async loadProviders(
    directory = DEFAULT_PROVIDER_DIRECTORY,
  ): Promise<void> {
    const providerFiles = readdirSync(directory)
      .filter((filename) => /\.provider\.(?:js|ts)$/.test(filename))
      .sort();

    for (const filename of providerFiles) {
      const imported: unknown = await import(
        pathToFileURL(join(directory, filename)).href
      );
      const provider = providerFromModule(imported, filename);
      if (!this.providers.has(provider.id)) this.register(provider);
    }
  }
}

export const providerRegistry = new ProviderRegistry();

function providerFromModule(imported: unknown, filename: string): JobProvider {
  if (!isRecord(imported) || !isJobProvider(imported['default'])) {
    throw new Error(
      `Provider module must export a default JobProvider: ${filename}`,
    );
  }
  return imported['default'];
}

function isJobProvider(value: unknown): value is JobProvider {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['capabilities'] === 'object' &&
    typeof value['validateConfiguration'] === 'function' &&
    typeof value['healthCheck'] === 'function' &&
    typeof value['search'] === 'function' &&
    typeof value['fetch'] === 'function' &&
    typeof value['normalize'] === 'function' &&
    typeof value['validate'] === 'function' &&
    typeof value['save'] === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
