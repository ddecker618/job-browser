import { describe, expect, it } from 'vitest';

import {
  ProviderRegistry,
  providerRegistry,
} from '../src/providers/providerRegistry.js';
import { RemoteOkProvider } from '../src/providers/remoteOk.provider.js';

describe('provider registration', () => {
  it('registers and resolves providers by stable id', () => {
    const registry = new ProviderRegistry();
    const provider = new RemoteOkProvider();

    registry.register(provider);

    expect(registry.get('remote-ok')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
    expect(() => registry.register(new RemoteOkProvider())).toThrow(
      'Provider is already registered',
    );
  });

  it('loads provider modules automatically by filename convention', async () => {
    await providerRegistry.loadProviders();

    expect(providerRegistry.list().map((provider) => provider.id)).toEqual([
      'ashby',
      'bamboohr',
      'builtin',
      'cisco',
      'crowdstrike',
      'dice',
      'greenhouse',
      'icims',
      'indeed',
      'lever',
      'linkedin',
      'recruitee',
      'remote-ok',
      'smartrecruiters',
      'structured-data',
      'teamtailor',
      'usajobs',
      'wellfound',
      'workable',
      'workday',
      'ziprecruiter',
    ]);
  });
});
