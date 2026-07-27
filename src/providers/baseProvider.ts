import type {
  JobRepository,
  UpsertJobResult,
} from '../repositories/job-repository.js';
import {
  normalizedJobSchema,
  type NormalizedJob,
} from '../schemas/normalized-job.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderHealthResult,
  ProviderType,
  ValidationResult,
} from '../models/source-management.js';

export interface ProviderSaveContext {
  repository: JobRepository;
  sourceId: string;
  runId?: string;
}

export interface JobProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;
  validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult>;
  healthCheck(options: DiscoveryOptions): Promise<ProviderHealthResult>;
  search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch>;
  fetch(search: ProviderSearch): Promise<ProviderFetchResult>;
  normalize(rawJob: unknown, discoveredAt: string): NormalizedJob;
  validate(job: NormalizedJob): NormalizedJob;
  save(
    context: ProviderSaveContext,
    job: NormalizedJob,
    rawJob: unknown,
  ): UpsertJobResult;
}

export abstract class BaseProvider implements JobProvider {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly type: ProviderType;
  public abstract readonly capabilities: ProviderCapabilities;

  public validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    return Promise.resolve({
      valid: true,
      message: 'Configuration is valid',
      normalizedConfiguration: configuration,
      preview: null,
    });
  }

  public async healthCheck(
    options: DiscoveryOptions,
  ): Promise<ProviderHealthResult> {
    const validation = await this.validateConfiguration(
      options.configuration ?? {},
    );
    return {
      status: validation.valid ? 'healthy' : 'failed',
      message: validation.message,
      checkedAt: new Date().toISOString(),
    };
  }

  public abstract search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch>;

  public abstract fetch(search: ProviderSearch): Promise<ProviderFetchResult>;

  public abstract normalize(
    rawJob: unknown,
    discoveredAt: string,
  ): NormalizedJob;

  public validate(job: NormalizedJob): NormalizedJob {
    return normalizedJobSchema.parse(job);
  }

  public save(
    context: ProviderSaveContext,
    job: NormalizedJob,
    rawJob: unknown,
  ): UpsertJobResult {
    return context.repository.upsertObservation({
      job,
      sourceId: context.sourceId,
      providerId: this.id,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      rawData: rawJob,
      providerConfidence: providerConfidence(this.type),
    });
  }
}

function providerConfidence(type: ProviderType): number {
  switch (type) {
    case 'government':
      return 0.98;
    case 'ats':
      return 0.95;
    case 'job-board':
      return 0.85;
    case 'structured-data':
      return 0.7;
  }
}

export class ProviderFetchError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderFetchError';
  }

  public readonly htmlSnapshot = null;
}
