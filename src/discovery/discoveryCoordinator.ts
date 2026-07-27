import type { JobDatabase } from '../db/database.js';
import { DiscoveryStore } from '../database/discoveryStore.js';
import type {
  DiscoveryStatus,
  DiscoveryRunView,
} from '../models/source-management.js';
import type {
  DiscoverySummary,
  DiscoveryTrigger,
} from '../models/discovery.js';
import type { ProviderRegistry } from '../providers/providerRegistry.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { DiscoveryEngine } from './discoveryEngine.js';
import type { CredentialResolver } from './credentialResolver.js';

export interface CoordinatorOptions {
  credentialResolver: CredentialResolver;
  analyze?: () => void;
}

export class DiscoveryCoordinator {
  private readonly sources: SourceRepository;
  private readonly engine: DiscoveryEngine;
  private readonly store: DiscoveryStore;
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  private activeController: AbortController | null = null;
  private statusValue: DiscoveryStatus = idleStatus();

  public constructor(
    database: JobDatabase,
    private readonly registry: ProviderRegistry,
    private readonly options: CoordinatorOptions,
  ) {
    this.sources = new SourceRepository(database);
    this.engine = new DiscoveryEngine(database, registry);
    this.store = new DiscoveryStore(database);
  }

  public status(): DiscoveryStatus {
    return {
      ...this.statusValue,
      queuedSourceIds: [...this.statusValue.queuedSourceIds],
    };
  }

  public recentRuns(sourceId?: string): DiscoveryRunView[] {
    return this.sources.recentRuns(sourceId);
  }

  public runSource(
    sourceId: string,
    trigger: DiscoveryTrigger = 'manual-source',
  ): Promise<DiscoverySummary[]> {
    return this.enqueue([sourceId], trigger, false);
  }

  public runFixture(sourceId: string): Promise<DiscoverySummary[]> {
    return this.enqueue([sourceId], 'cli', true);
  }

  public runFixtures(sourceIds: string[]): Promise<DiscoverySummary[]> {
    return this.enqueue(sourceIds, 'cli', true);
  }

  public runAll(
    trigger: DiscoveryTrigger = 'manual-all',
  ): Promise<DiscoverySummary[]> {
    return this.enqueue(
      this.sources.listEnabled().map((source) => source.id),
      trigger,
      false,
    );
  }

  public async validateSource(
    providerId: string,
    configuration: Record<string, unknown>,
  ) {
    const provider = this.registry.get(providerId);
    return provider.validateConfiguration(configuration);
  }

  public async healthCheck(sourceId: string) {
    const source = this.sources.get(sourceId);
    if (source?.providerId == null)
      throw new Error('Source is not refreshable');
    const provider = this.registry.get(source.providerId);
    try {
      const credentials = await this.options.credentialResolver.resolve(
        provider.id,
      );
      const result = await provider.healthCheck({
        fixtureOnly: false,
        sourceId,
        configuration: source.configuration,
        ...(credentials === null ? {} : { credentials }),
      });
      if (result.status === 'failed' && result.message) {
        result.message = translateError(result.message);
      }
      this.sources.setHealth(sourceId, result.status, result.message);
      return result;
    } catch (error) {
      const userMessage = translateError(error);
      const status = userMessage.startsWith('Authentication')
        ? 'credentials-required'
        : 'failed';
      this.sources.setHealth(sourceId, status, userMessage);
      return {
        status,
        message: userMessage,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.activeController?.abort();
    await this.tail;
  }

  private enqueue(
    sourceIds: string[],
    trigger: DiscoveryTrigger,
    fixtureOnly: boolean,
  ): Promise<DiscoverySummary[]> {
    if (this.stopped)
      return Promise.reject(new Error('Discovery coordinator is stopping'));
    if (sourceIds.length === 0) return Promise.resolve([]);
    if (!this.statusValue.running) {
      this.statusValue = {
        running: true,
        queuedSourceIds: [],
        activeSourceId: null,
        startedAt: new Date().toISOString(),
        completedSources: 0,
        totalSources: 0,
        lastError: null,
      };
    }
    this.statusValue.queuedSourceIds.push(...sourceIds);
    this.statusValue.totalSources += sourceIds.length;
    let resolveResult!: (summaries: DiscoverySummary[]) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<DiscoverySummary[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.tail = this.tail
      .then(async () => {
        try {
          const summaries = await this.execute(sourceIds, trigger, fixtureOnly);
          resolveResult(summaries);
        } catch (error) {
          rejectResult(error);
        }
      })
      .catch(() => undefined);
    return result;
  }

  private async execute(
    sourceIds: string[],
    trigger: DiscoveryTrigger,
    fixtureOnly: boolean,
  ): Promise<DiscoverySummary[]> {
    const summaries: DiscoverySummary[] = [];
    for (const sourceId of sourceIds) {
      if (this.stopped) {
        const queuedIndex = this.statusValue.queuedSourceIds.indexOf(sourceId);
        if (queuedIndex >= 0)
          this.statusValue.queuedSourceIds.splice(queuedIndex, 1);
        this.statusValue.completedSources += 1;
        continue;
      }
      this.statusValue.activeSourceId = sourceId;
      const queuedIndex = this.statusValue.queuedSourceIds.indexOf(sourceId);
      if (queuedIndex >= 0)
        this.statusValue.queuedSourceIds.splice(queuedIndex, 1);
      const source = this.sources.get(sourceId);
      let completedSuccessfully = false;
      let runStarted = false;
      const controller = new AbortController();
      this.activeController = controller;
      try {
        if (source?.providerId == null)
          throw new Error(`Source is not refreshable: ${sourceId}`);
        if (!source.enabled && trigger !== 'manual-job')
          throw new Error(`Source is disabled: ${source.displayName}`);
        const provider = this.registry.get(source.providerId);
        const validation = await provider.validateConfiguration(
          source.configuration,
        );
        if (!validation.valid) throw new Error(validation.message);
        const credentials = await this.options.credentialResolver.resolve(
          provider.id,
        );
        if (provider.capabilities.requiresCredentials && credentials === null) {
          this.sources.setHealth(
            source.id,
            'credentials-required',
            'Credentials are required',
          );
          throw new Error(`${provider.name} credentials are required`);
        }
        controller.signal.throwIfAborted();
        runStarted = true;
        const summary = await this.engine.run(
          provider.id,
          source.searchCriteria,
          {
            fixtureOnly,
            sourceId: source.id,
            configuration:
              validation.normalizedConfiguration ?? source.configuration,
            trigger,
            signal: controller.signal,
            ...(credentials === null ? {} : { credentials }),
          },
        );
        summaries.push(summary);
        completedSuccessfully = true;
        this.sources.setHealth(
          source.id,
          'healthy',
          'Latest discovery completed successfully',
        );
      } catch (error) {
        const translated = translateError(error);
        if (!runStarted)
          this.store.recordPreflightFailure(source, sourceId, trigger, error);
        if (source !== null) {
          const credentialsRequired = translated.startsWith('Authentication');
          this.sources.setHealth(
            source.id,
            credentialsRequired ? 'credentials-required' : 'failed',
            translated,
          );
        }
        this.statusValue.lastError = translated;
      } finally {
        this.activeController = null;
        if (completedSuccessfully && trigger === 'scheduled' && source !== null)
          this.sources.updateScheduleAfterRun(source.id);
        this.statusValue.completedSources += 1;
      }
    }
    if (summaries.length > 0) this.options.analyze?.();
    this.statusValue.activeSourceId = null;
    if (this.statusValue.queuedSourceIds.length === 0) {
      this.statusValue.running = false;
    }
    return summaries;
  }
}

function idleStatus(): DiscoveryStatus {
  return {
    running: false,
    queuedSourceIds: [],
    activeSourceId: null,
    startedAt: null,
    completedSources: 0,
    totalSources: 0,
    lastError: null,
  };
}

export function translateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('404') ||
    message.toLowerCase().includes('not found') ||
    message.includes('Document not found')
  ) {
    return 'HTTP 404: Board not found or inactive';
  }
  if (
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('timed out') ||
    message.toLowerCase().includes('deadline')
  ) {
    return 'Timeout: The server did not respond in time';
  }
  if (
    message.toLowerCase().includes('credentials') ||
    message.toLowerCase().includes('unauthorized') ||
    message.includes('401') ||
    message.toLowerCase().includes('authentication') ||
    message.toLowerCase().includes('auth') ||
    message.endsWith('credentials are required')
  ) {
    return 'Authentication required: Invalid or missing credentials';
  }
  if (message.toLowerCase().includes('forbidden') || message.includes('403')) {
    return 'Authentication required: Access forbidden';
  }
  if (
    message.toLowerCase().includes('rate limit') ||
    message.includes('429') ||
    message.toLowerCase().includes('too many requests')
  ) {
    return 'Rate limited: Too many requests sent to the server';
  }
  if (
    message.toLowerCase().includes('unsupported') ||
    message.toLowerCase().includes('no connector') ||
    message.toLowerCase().includes('unsupported employer')
  ) {
    return 'Unsupported employer: No matching connector found';
  }
  if (
    message.toLowerCase().includes('invalid configuration') ||
    message.toLowerCase().includes('zod') ||
    message.toLowerCase().includes('schema') ||
    message.toLowerCase().includes('invalid characters') ||
    message.toLowerCase().includes('too long') ||
    message.toLowerCase().includes('is required')
  ) {
    return 'Invalid configuration: Check configuration fields';
  }
  if (
    message.toLowerCase().includes('fetch failed') ||
    message.toLowerCase().includes('getaddrinfo') ||
    message.toLowerCase().includes('connrefused')
  ) {
    return 'Provider unavailable: Network error or DNS resolution failed';
  }
  if (
    message.includes('No jobs matched current filters') ||
    message.includes('No jobs matched the configured filters') ||
    message.includes('No open positions found') ||
    message.includes(
      'responded successfully but currently has no open positions',
    )
  ) {
    if (message.includes('No jobs matched current filters')) {
      return 'No jobs matched current filters';
    }
    if (message.includes('No jobs matched the configured filters')) {
      return 'No jobs matched the configured filters.';
    }
    if (message.toLowerCase().includes('greenhouse')) {
      return 'Greenhouse board responded successfully but currently has no open positions.';
    }
    if (
      message.toLowerCase().includes('lever') &&
      message.includes('no open positions')
    ) {
      return 'Lever board responded successfully but currently has no open positions.';
    }
    return 'No open positions found';
  }

  return `Provider unavailable: ${message}`;
}
