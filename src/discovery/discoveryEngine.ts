import { performance } from 'node:perf_hooks';

import type { JobDatabase } from '../db/database.js';
import { DiscoveryStore } from '../database/discoveryStore.js';
import { log, type LogWriter } from '../logging/logger.js';
import type {
  DiscoveryOptions,
  DiscoverySummary,
  SearchRequest,
} from '../models/discovery.js';
import type { ProviderRegistry } from '../providers/providerRegistry.js';
import { JobRepository } from '../repositories/job-repository.js';
import { nowUtc } from '../utilities/timestamps.js';

export class DiscoveryEngine {
  private readonly store: DiscoveryStore;
  private readonly jobRepository: JobRepository;

  public constructor(
    database: JobDatabase,
    private readonly registry: ProviderRegistry,
    private readonly writeLog: LogWriter = log,
  ) {
    this.store = new DiscoveryStore(database);
    this.jobRepository = new JobRepository(database);
  }

  public async run(
    providerId: string,
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<DiscoverySummary> {
    const provider = this.registry.get(providerId);
    const run = this.store.startRun(provider, request, options);
    const started = performance.now();
    this.writeLog('info', 'Discovery run started', {
      provider: provider.id,
      runId: run.runId,
      searchParameters: request,
      fixtureOnly: options.fixtureOnly,
    });

    try {
      const search = await provider.search(request, options);
      const fetchResult = await provider.fetch(search);
      const rawJobs = fetchResult.records;
      if (rawJobs.length === 0 && !options.fixtureOnly) {
        const unfiltered = fetchResult.unfilteredCount ?? 0;
        if (unfiltered > 0) {
          throw new Error('No jobs matched current filters');
        } else {
          throw new Error('No open positions found');
        }
      }
      let jobsInserted = 0;
      let rediscoveries = 0;
      let crossSourceMerges = 0;
      let materialUpdates = 0;
      let identityConflicts = 0;
      let jobsFailed = 0;
      const discoveredAt = nowUtc();

      for (const rawJob of rawJobs) {
        try {
          const normalized = provider.normalize(rawJob, discoveredAt);
          const validated = provider.validate(normalized);
          const result = provider.save(
            {
              repository: this.jobRepository,
              sourceId: run.sourceId,
              runId: run.runId,
            },
            validated,
            rawJob,
          );
          jobsInserted += Number(result.inserted);
          rediscoveries += Number(result.rediscovered);
          crossSourceMerges += Number(result.crossSourceMerge);
          materialUpdates += Number(result.materiallyUpdated);
          identityConflicts += Number(result.identityConflict);
        } catch (error) {
          jobsFailed += 1;
          this.writeLog('error', 'Job normalization or persistence failed', {
            provider: provider.id,
            runId: run.runId,
            ...errorContext(error),
          });
        }
      }

      const completeSnapshot =
        fetchResult.complete &&
        !fetchResult.truncated &&
        fetchResult.rejected === 0 &&
        jobsFailed === 0;

      const summary: DiscoverySummary = {
        runId: run.runId,
        sourceId: run.sourceId,
        providerId: provider.id,
        jobsFound: rawJobs.length + fetchResult.rejected,
        jobsInserted,
        jobsUpdated: materialUpdates,
        duplicatesDetected: rediscoveries + crossSourceMerges,
        duplicatesMerged: crossSourceMerges,
        recordsRejected: fetchResult.rejected,
        rediscoveries,
        crossSourceMerges,
        materialUpdates,
        identityConflicts,
        fetchTruncated: fetchResult.truncated,
        completeSnapshot,
        retryCount: 0,
        jobsFailed,
        executionTimeMs: elapsedMilliseconds(started),
      };
      this.store.completeRun(summary);
      this.writeLog('info', 'Discovery run completed', {
        provider: provider.id,
        ...summary,
        searchParameters: request,
        fetchTruncated: fetchResult.truncated,
        fetchComplete: fetchResult.complete,
      });
      return summary;
    } catch (error) {
      const executionTimeMs = elapsedMilliseconds(started);
      const details = errorContext(error);
      this.store.failRun(provider.id, run.sourceId, run.runId, {
        executionTimeMs,
        errorMessage: details.error,
        stackTrace: details.stackTrace,
        htmlSnapshotPath: null,
      });
      this.writeLog('error', 'Discovery run failed', {
        provider: provider.id,
        runId: run.runId,
        executionTimeMs,
        htmlSnapshotPath: null,
        searchParameters: request,
        ...details,
      });
      throw new Error(
        `Discovery failed for provider ${provider.id}: ${details.error}`,
        {
          cause: error,
        },
      );
    }
  }
}

function elapsedMilliseconds(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function errorContext(error: unknown): {
  error: string;
  stackTrace: string | null;
} {
  if (error instanceof Error) {
    return { error: error.message, stackTrace: error.stack ?? null };
  }
  return { error: String(error), stackTrace: null };
}
