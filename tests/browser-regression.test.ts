import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { DiscoveryEngine } from '../src/discovery/discoveryEngine.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../src/models/discovery.js';
import { BuiltInProvider } from '../src/providers/builtin.provider.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { createTestDatabase } from './helpers/test-database.js';

const closeCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock(
  '../src/providers/linkedIn/browserSession.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/providers/linkedIn/browserSession.js')
      >();
    return {
      ...actual,
      closeBrowserSession: vi.fn(() => {
        closeCalls.count += 1;
        return Promise.resolve();
      }),
    };
  },
);

import { navigateWithRetry } from '../src/providers/linkedIn/browserSession.js';
import type { Page } from 'playwright';

let database: JobDatabase;
let registry: ProviderRegistry;

beforeEach(() => {
  closeCalls.count = 0;
  vi.clearAllMocks();
  database = createTestDatabase();
  registry = new ProviderRegistry();
});

afterEach(() => {
  database.close();
});

function createEngine(): DiscoveryEngine {
  return new DiscoveryEngine(database, registry);
}

function request(): SearchRequest {
  return {
    query: 'software',
    location: null,
    remoteOnly: true,
    limit: 10,
  };
}

function fixtureOptions(): DiscoveryOptions {
  return { fixtureOnly: true };
}

class FailingProvider extends BuiltInProvider {
  public override readonly id = 'failing' as 'builtin';
  public override fetch(): Promise<ProviderFetchResult> {
    return Promise.reject(new Error('collect exploded'));
  }
}

class NeverCompletingProvider extends BuiltInProvider {
  public override readonly id = 'never-completing' as 'builtin';
  public override search(): Promise<ProviderSearch> {
    return new Promise(() => undefined);
  }
  public override fetch(): Promise<ProviderFetchResult> {
    return new Promise(() => undefined);
  }
}

class HungProvider extends BuiltInProvider {
  public override readonly id = 'hung' as 'builtin';
  public override search(): Promise<ProviderSearch> {
    return new Promise(() => undefined);
  }
  public override fetch(): Promise<ProviderFetchResult> {
    return new Promise(() => undefined);
  }
}

class AbortableProvider extends BuiltInProvider {
  public override readonly id = 'abortable' as 'builtin';
  private resolveStarted!: () => void;
  public readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  public override search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    this.resolveStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        {
          once: true,
        },
      );
    });
  }
  public override fetch(): Promise<ProviderFetchResult> {
    return Promise.resolve({
      records: [],
      rejected: 0,
      truncated: false,
      complete: true,
      unfilteredCount: 0,
      emptyNotice: null,
    });
  }
}

describe('browser session cleanup guarantees', () => {
  it('does not close a browser session on a clean successful run', async () => {
    registry.register(new BuiltInProvider());
    await createEngine().run('builtin', request(), {
      ...fixtureOptions(),
    });
    expect(closeCalls.count).toBe(0);
  });

  it('leaves cleanup to the provider when a non-browser provider errors', async () => {
    registry.register(new FailingProvider());
    await expect(
      createEngine().run('failing', request(), { ...fixtureOptions() }),
    ).rejects.toThrow('collect exploded');
    expect(closeCalls.count).toBe(0);
  });

  it('closes the browser session exactly once when the run deadline fires', async () => {
    registry.register(new NeverCompletingProvider());
    await expect(
      createEngine().run('never-completing', request(), {
        ...fixtureOptions(),
        runTimeoutMs: 50,
      }),
    ).rejects.toThrow(/deadline/);
    expect(closeCalls.count).toBe(1);
  });

  it('closes the browser session exactly once when a responsive provider is aborted', async () => {
    const controller = new AbortController();
    const provider = new AbortableProvider();
    registry.register(provider);
    const runPromise = createEngine().run('abortable', request(), {
      ...fixtureOptions(),
      signal: controller.signal,
    });
    await provider.started;
    controller.abort();
    await expect(runPromise).rejects.toThrow(
      'Discovery was interrupted when Job Browser stopped',
    );
    expect(closeCalls.count).toBe(1);
  });

  it('closes the browser session exactly once when a hung provider ignores abort', async () => {
    registry.register(new HungProvider());
    const controller = new AbortController();
    const runPromise = createEngine().run('hung', request(), {
      ...fixtureOptions(),
      signal: controller.signal,
      runTimeoutMs: 30_000,
    });
    controller.abort();
    await expect(runPromise).rejects.toThrow(
      'Discovery was interrupted when Job Browser stopped',
    );
    expect(closeCalls.count).toBe(1);
  });
});

describe('navigateWithRetry', () => {
  function fakePage(goto: Page['goto']): Page {
    return { goto } as unknown as Page;
  }

  it('retries transient navigation timeouts and completes', async () => {
    let attempts = 0;
    const page = fakePage((() => {
      attempts += 1;
      if (attempts === 1) throw new Error('timeout');
      return Promise.resolve(null as never);
    }) as Page['goto']);

    await navigateWithRetry(page, 'https://example.test/jobs', {
      timeout: 100,
    });
    expect(attempts).toBe(2);
  });

  it('surfaces the final navigation error after exhausting retries', async () => {
    const page = fakePage((() => {
      throw new Error('socket hang up');
    }) as Page['goto']);

    await expect(
      navigateWithRetry(page, 'https://example.test/jobs', {
        timeout: 100,
        retries: 3,
      }),
    ).rejects.toThrow(/after 3 attempts: socket hang up/);
  });
});
