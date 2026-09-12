import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import express from 'express';
import { rateLimit } from 'express-rate-limit';

import { createDatabaseBackup } from '../db/backup.js';
import {
  createPersistenceSetBackup,
  listBackups,
  type BackupMetadata,
  type PersistenceSetPaths,
} from '../db/persistenceSetBackup.js';
import {
  defaultDatabasePath,
  openDatabase,
  type OpenDatabaseOptions,
  type JobDatabase,
} from '../db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  listPendingMigrations,
  runMigrations,
} from '../db/migration-runner.js';
import { seedKnownApplications } from '../db/seeds/known-applications.js';
import { ensureInstalledAt } from '../database/adoptionMarkers.js';
import { seedEmployerRegistry } from '../db/seeds/employerRegistry.js';
import type { LogWriter } from '../logging/logger.js';
import { log } from '../logging/logger.js';
import { createApp, type AppOptions } from './app.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { JobRepository } from '../repositories/job-repository.js';
import { JobLifecycleRepository } from '../repositories/job-lifecycle-repository.js';
import { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import { DiscoveryScheduler } from '../discovery/discoveryScheduler.js';
import { EmployerDiscoveryService } from '../discovery/employerDiscoveryService.js';
import { CareerSiteHealthService } from '../discovery/careerSiteHealthService.js';
import { EmployerRepository } from '../repositories/employerRepository.js';
import { EmployerDiscoveryIntelligenceService } from '../discovery/employerDiscoveryIntelligenceService.js';
import { DiscoveryAlertService } from '../discovery/discoveryAlertService.js';
import { DiscoveryAnalyticsService } from '../discovery/discoveryAnalyticsService.js';
import { unavailableCredentialResolver } from '../discovery/credentialResolver.js';
import { NlpBackgroundWorker } from '../intelligence/nlp/backgroundWorker.js';
import { DatabaseJobNlpCandidateSource } from '../intelligence/nlp/jobCandidateProvider.js';
import { extractNlpDocument } from '../intelligence/nlp/document.js';
import { withSearchRelevanceIndex } from '../intelligence/nlp/searchRelevance.js';
import { JobNlpEnrichmentRepository } from '../database/jobNlpEnrichmentRepository.js';
import { NlpRelevanceRepository } from '../database/nlpRelevanceRepository.js';
import { NlpComparisonRepository } from '../database/nlpComparisonRepository.js';
import { withNlpComparisonPersistence } from '../intelligence/nlp/comparison.js';
import { NLP_EXTRACTION_VERSION } from '../schemas/job-nlp.js';
import { IntelligenceEngine } from '../intelligence/intelligenceEngine.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { LinkedInProvider } from '../providers/linkedIn.provider.js';
import { DiceProvider } from '../providers/dice.provider.js';
import { HandshakeProvider } from '../providers/handshake.provider.js';
import { IndeedProvider } from '../providers/indeed.provider.js';
import { WellfoundProvider } from '../providers/wellfound.provider.js';
import { ZipRecruiterProvider } from '../providers/ziprecruiter.provider.js';
import { UsaJobsProvider } from '../providers/usajobs.provider.js';

export interface BackendOptions extends AppOptions {
  databaseOpener?: DatabaseOpener;
  databasePath?: string;
  migrationsDirectory?: string;
  backupDirectory?: string;
  clientDirectory?: string;
  development?: boolean;
  host?: string;
  port?: number;
  logger?: LogWriter;
  backupBeforeMigrations?: boolean;
  enableScheduler?: boolean;
  seedDefaultSources?: boolean;
  linkedinProfile?: string;
  diceProfile?: string;
  handshakeProfile?: string;
  indeedProfile?: string;
  wellfoundProfile?: string;
  ziprecruiterProfile?: string;
  usaJobsProfile?: string;
  clientRequestsPerMinute?: number;
  databaseQuarantineDirectory?: string;
  onStartupProgress?: (phase: BackendStartupPhase) => void;
  startupMaintenanceDelayMs?: number;
}

export type BackendStartupPhase =
  | 'checking-database'
  | 'backing-up-database'
  | 'applying-database-updates'
  | 'starting-local-service';

export interface BackendHandle {
  database: JobDatabase;
  server: Server;
  url: string;
  pendingMigrations: string[];
  migrationBackupPath: string | null;
  coordinator: DiscoveryCoordinator;
  startupMaintenance: Promise<void>;
  backup(): Promise<string>;
  listBackups(): BackupMetadata[];
  stop(): Promise<void>;
}

export async function startBackend(
  options: BackendOptions = {},
): Promise<BackendHandle> {
  const logger = options.logger ?? log;
  const databasePath = options.databasePath ?? defaultDatabasePath();
  const quarantineDirectory =
    options.databaseQuarantineDirectory ??
    (databasePath === ':memory:'
      ? undefined
      : resolve(dirname(databasePath), 'quarantine', 'database'));
  let database: JobDatabase | undefined;
  let server: Server | undefined;
  let startupMaintenanceTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveStartupMaintenance: (() => void) | null = null;
  let startupMaintenance: Promise<void> = Promise.resolve();
  let stopped = false;
  try {
    options.onStartupProgress?.('checking-database');
    const databaseOpener = options.databaseOpener ?? openDatabase;
    database = await timeStartupPhase(logger, 'checking-database', () =>
      databaseOpener(
        databasePath,
        quarantineDirectory === undefined
          ? {}
          : { quarantineDirectory: quarantineDirectory },
      ),
    );
    const activeDatabase = database;
    const migrationsDirectory =
      options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY;
    const pendingMigrations = listPendingMigrations(
      database,
      migrationsDirectory,
    );
    const persistenceSetPaths: PersistenceSetPaths | null =
      options.backupDirectory !== undefined &&
      options.resumeDirectory !== undefined &&
      options.snapshotDirectory !== undefined &&
      options.candidateProfilePath !== undefined &&
      options.scoringConfigPath !== undefined
        ? {
            databasePath,
            resumeDirectory: options.resumeDirectory,
            snapshotDirectory: options.snapshotDirectory,
            candidateProfilePath: options.candidateProfilePath,
            scoringConfigPath: options.scoringConfigPath,
            ...(options.profilePreferencesPath === undefined
              ? {}
              : { profilePreferencesPath: options.profilePreferencesPath }),
            backupDirectory: options.backupDirectory,
          }
        : null;
    let migrationBackupPath: string | null = null;
    if (
      pendingMigrations.length > 0 &&
      options.backupBeforeMigrations === true &&
      options.backupDirectory !== undefined
    ) {
      const backupDirectory = options.backupDirectory;
      options.onStartupProgress?.('backing-up-database');
      migrationBackupPath = await timeStartupPhase(
        logger,
        'backing-up-database',
        () =>
          createDatabaseBackup(
            activeDatabase,
            backupDirectory,
            'pre-migration',
          ),
      );
    }
    options.onStartupProgress?.('applying-database-updates');
    timeStartupPhase(logger, 'applying-database-updates', () => {
      runMigrations(activeDatabase, migrationsDirectory);
      seedEmployerRegistry(activeDatabase);
    });
    options.onStartupProgress?.('starting-local-service');
    await timeStartupPhase(logger, 'starting-local-service', async () => {
      seedKnownApplications(activeDatabase);
      ensureInstalledAt(activeDatabase);
      await providerRegistry.loadProviders();
    });
    await yieldStartup();
    timeStartupPhase(logger, 'configuring-provider-profiles', () => {
      if (options.linkedinProfile) {
        const linkedIn = providerRegistry.get('linkedin');
        if (linkedIn instanceof LinkedInProvider) {
          linkedIn.setBrowserProfileDir(options.linkedinProfile);
        }
      }
      if (options.diceProfile) {
        const dice = providerRegistry.get('dice');
        if (dice instanceof DiceProvider) {
          dice.setBrowserProfileDir(options.diceProfile);
        }
      }
      if (options.handshakeProfile) {
        const handshake = providerRegistry.get('handshake');
        if (handshake instanceof HandshakeProvider) {
          handshake.setBrowserProfileDir(options.handshakeProfile);
        }
      }
      if (options.indeedProfile) {
        const indeed = providerRegistry.get('indeed');
        if (indeed instanceof IndeedProvider) {
          indeed.setBrowserProfileDir(options.indeedProfile);
        }
      }
      if (options.wellfoundProfile) {
        const wellfound = providerRegistry.get('wellfound');
        if (wellfound instanceof WellfoundProvider) {
          wellfound.setBrowserProfileDir(options.wellfoundProfile);
        }
      }
      if (options.ziprecruiterProfile) {
        const ziprecruiter = providerRegistry.get('ziprecruiter');
        if (ziprecruiter instanceof ZipRecruiterProvider) {
          ziprecruiter.setBrowserProfileDir(options.ziprecruiterProfile);
        }
      }
      if (options.usaJobsProfile) {
        const usajobs = providerRegistry.get('usajobs');
        if (usajobs instanceof UsaJobsProvider) {
          usajobs.setBrowserProfileDir(options.usaJobsProfile);
        }
      }
    });
    await yieldStartup();
    const sourceRepository = timeStartupPhase(
      logger,
      'initializing-source-state',
      () => {
        const repository = new SourceRepository(
          activeDatabase,
          options.profilePreferencesPath,
        );
        repository.reconcileProviders(providerRegistry.list());
        if (options.seedDefaultSources === true) {
          repository.ensureDefaultSources();
        }
        repository.recoverInterruptedRuns();
        return repository;
      },
    );
    await yieldStartup();
    const startupServices = timeStartupPhase(
      logger,
      'constructing-startup-services',
      () => {
        const jobLifecycle = new JobLifecycleRepository(activeDatabase);
        const discoveryAlertService = new DiscoveryAlertService(activeDatabase);
        const discoveryAnalyticsService = new DiscoveryAnalyticsService(
          activeDatabase,
        );
        const coordinator = new DiscoveryCoordinator(
          activeDatabase,
          providerRegistry,
          {
            credentialResolver:
              options.credentialResolver ?? unavailableCredentialResolver,
            writeLog: logger,
            ...(options.profilePreferencesPath === undefined
              ? {}
              : { profilePreferencesPath: options.profilePreferencesPath }),
            analyze: () =>
              new IntelligenceEngine(activeDatabase).analyze(
                loadCandidateProfile(options.candidateProfilePath),
                loadScoringConfig(options.scoringConfigPath),
              ),
            evaluateAlerts: () => discoveryAlertService.evaluateRules(),
          },
        );
        const employerRepository = new EmployerRepository(activeDatabase);
        const employerDiscoveryIntelligence =
          new EmployerDiscoveryIntelligenceService(activeDatabase);
        const employerDiscoveryService = new EmployerDiscoveryService(
          employerRepository,
          sourceRepository,
          providerRegistry,
          coordinator,
          options.credentialResolver ?? unavailableCredentialResolver,
          employerDiscoveryIntelligence,
        );
        const careerSiteHealthService = new CareerSiteHealthService(
          employerRepository,
          employerDiscoveryService,
          options.atsDetector,
        );
        const scheduler =
          options.enableScheduler === true
            ? new DiscoveryScheduler(
                sourceRepository,
                coordinator,
                30_000,
                employerDiscoveryService,
                undefined,
                careerSiteHealthService,
                jobLifecycle,
                discoveryAlertService,
              )
            : null;
        return {
          careerSiteHealthService,
          coordinator,
          discoveryAlertService,
          discoveryAnalyticsService,
          employerDiscoveryIntelligence,
          employerDiscoveryService,
          employerRepository,
          jobLifecycle,
          scheduler,
        };
      },
    );

    await yieldStartup();
    const nlpBackgroundWorker = timeStartupPhase(
      logger,
      'constructing-nlp-worker',
      () => {
        const nlpCandidateSource = new DatabaseJobNlpCandidateSource(
          activeDatabase,
        );
        const nlpEnrichmentStore = new JobNlpEnrichmentRepository(
          activeDatabase,
        );
        const nlpRelevanceStore = new NlpRelevanceRepository(activeDatabase);
        const nlpPersistenceTarget = withNlpComparisonPersistence(
          activeDatabase,
          withSearchRelevanceIndex(nlpEnrichmentStore, nlpRelevanceStore),
          new NlpComparisonRepository(activeDatabase),
        );
        return new NlpBackgroundWorker(
          {
            target: nlpPersistenceTarget,
            extractionVersion: NLP_EXTRACTION_VERSION,
            builder: async (candidate, signal) => {
              const parts = nlpCandidateSource.load(candidate.jobId);
              if (parts === null) {
                throw new Error(`Job ${candidate.jobId} no longer exists`);
              }
              return extractNlpDocument(parts, signal);
            },
            candidateProvider: (afterJobId, limit) =>
              Promise.resolve(nlpCandidateSource.page(afterJobId, limit)),
          },
          {
            staleHint: () =>
              nlpCandidateSource.countMissingOrVersionMismatch(
                NLP_EXTRACTION_VERSION,
              ),
          },
        );
      },
    );
    await yieldStartup();
    const app = timeStartupPhase(logger, 'creating-api-application', () =>
      createApp(activeDatabase, {
        ...options,
        coordinator: startupServices.coordinator,
        sourceRepository,
        employerRepository: startupServices.employerRepository,
        employerDiscoveryService: startupServices.employerDiscoveryService,
        careerSiteHealthService: startupServices.careerSiteHealthService,
        employerDiscoveryIntelligence:
          startupServices.employerDiscoveryIntelligence,
        discoveryAlertService: startupServices.discoveryAlertService,
        discoveryAnalyticsService: startupServices.discoveryAnalyticsService,
        nlpBackgroundWorker,
      }),
    );
    await yieldStartup();
    if (options.development === true) {
      await timeStartupPhase(
        logger,
        'attaching-development-client',
        async () => {
          const { createServer } = await import('vite');
          const vite = await createServer({
            server: { middlewareMode: true },
            appType: 'spa',
          });
          app.use(vite.middlewares);
        },
      );
    } else {
      timeStartupPhase(logger, 'attaching-production-client', () => {
        const clientDirectory =
          options.clientDirectory ?? resolve(process.cwd(), 'dist', 'client');
        app.use(
          rateLimit({
            windowMs: 60_000,
            limit: options.clientRequestsPerMinute ?? 1_200,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: { error: 'Too many client requests; retry in one minute' },
          }),
        );
        app.use(express.static(clientDirectory));
        app.use((_request, response) =>
          response.sendFile(resolve(clientDirectory, 'index.html')),
        );
      });
    }
    await yieldStartup();
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 0;
    server = await timeStartupPhase(
      logger,
      'binding-local-service',
      () =>
        new Promise<Server>((resolveServer, reject) => {
          const candidate = app.listen(port, host, () =>
            resolveServer(candidate),
          );
          candidate.once('error', reject);
        }),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Backend did not select a TCP port');
    const url = `http://${host}:${String(address.port)}`;
    logger('info', 'Backend started', { url, pendingMigrations });
    startupMaintenance = new Promise<void>((resolveMaintenance) => {
      resolveStartupMaintenance = resolveMaintenance;
      startupMaintenanceTimer = setTimeout(() => {
        startupMaintenanceTimer = null;
        if (stopped) {
          resolveMaintenance();
          return;
        }
        Promise.resolve()
          .then(() => {
            runStartupMaintenanceStep(
              logger,
              'reconcile-known-closures',
              () => {
                const lifecycleReconciliation =
                  startupServices.jobLifecycle.reconcileKnownClosures();
                if (lifecycleReconciliation.changed > 0) {
                  logger(
                    'info',
                    'Known job closures reconciled',
                    lifecycleReconciliation,
                  );
                }
              },
            );
            runStartupMaintenanceStep(
              logger,
              'refresh-matched-families',
              () => {
                new JobRepository(activeDatabase).refreshMatchedFamilies();
              },
            );
            runStartupMaintenanceStep(
              logger,
              'reconcile-stale-intelligence',
              () => {
                const currentProfile = loadCandidateProfile(
                  options.candidateProfilePath,
                );
                const currentScoring = loadScoringConfig(
                  options.scoringConfigPath,
                );
                const reconciliation = new IntelligenceEngine(
                  activeDatabase,
                  options.logger ?? logger,
                ).reconcileStaleData(currentProfile, currentScoring);
                if (
                  reconciliation.roleDetailsProcessed > 0 ||
                  reconciliation.scoresInvalidated > 0 ||
                  reconciliation.analysis !== null
                ) {
                  logger('info', 'Stale role details and scores reconciled', {
                    roleDetailsProcessed: reconciliation.roleDetailsProcessed,
                    roleDetailsUpdated: reconciliation.roleDetailsUpdated,
                    roleDetailsSkipped: reconciliation.roleDetailsSkipped,
                    scoresInvalidated: reconciliation.scoresInvalidated,
                    scoresReprocessed:
                      reconciliation.analysis?.jobsAnalyzed ?? 0,
                  });
                }
              },
            );
            runStartupMaintenanceStep(
              logger,
              'evaluate-discovery-alerts',
              () => {
                startupServices.discoveryAlertService.evaluateRules();
              },
            );
            runStartupMaintenanceStep(
              logger,
              'start-discovery-scheduler',
              () => {
                startupServices.scheduler?.start();
              },
            );
            runStartupMaintenanceStep(logger, 'start-nlp-worker', () => {
              nlpBackgroundWorker.start();
            });
          })
          .catch((error: unknown) => {
            logger('error', 'Startup maintenance failed', {
              error: error instanceof Error ? error.message : String(error),
              stackTrace: error instanceof Error ? (error.stack ?? null) : null,
            });
          })
          .finally(resolveMaintenance);
      }, options.startupMaintenanceDelayMs ?? 10_000);
    });
    return {
      database: activeDatabase,
      server,
      url,
      pendingMigrations,
      migrationBackupPath,
      coordinator: startupServices.coordinator,
      startupMaintenance,
      backup: async () => {
        if (persistenceSetPaths === null)
          throw new Error('Backup directory is not configured');
        const result = await createPersistenceSetBackup(
          activeDatabase,
          persistenceSetPaths,
        );
        return result.backupId;
      },
      listBackups: () => {
        return listBackups(activeDatabase);
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        if (startupMaintenanceTimer !== null) {
          clearTimeout(startupMaintenanceTimer);
          startupMaintenanceTimer = null;
          resolveStartupMaintenance?.();
        }
        await startupMaintenance;
        if (startupServices.scheduler !== null)
          await startupServices.scheduler.stop();
        else await startupServices.coordinator.stop();
        await nlpBackgroundWorker.stop();
        await new Promise<void>((resolveStop, reject) => {
          server?.close((error) =>
            error === undefined ? resolveStop() : reject(error),
          );
        });
        try {
          activeDatabase.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          if (activeDatabase.open) activeDatabase.close();
        }
      },
    };
  } catch (error) {
    if (server !== undefined) server.close();
    if (database?.open === true) database.close();
    throw error;
  }
}

function timeStartupPhase<T>(
  logger: LogWriter,
  phase: string,
  action: () => T,
): T {
  const startedAt = performance.now();
  try {
    const result = action();
    if (isPromiseLike(result)) {
      return result.then((value) => {
        logStartupPhaseCompleted(logger, phase, startedAt);
        return value;
      }) as T;
    }
    logStartupPhaseCompleted(logger, phase, startedAt);
    return result;
  } catch (error) {
    logger('error', 'Startup phase failed', {
      phase,
      durationMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function runStartupMaintenanceStep(
  logger: LogWriter,
  phase: string,
  action: () => void,
): void {
  const startedAt = performance.now();
  try {
    action();
    logger('info', 'Startup maintenance phase completed', {
      phase,
      durationMs: elapsedMs(startedAt),
    });
  } catch (error) {
    logger('error', 'Startup maintenance phase failed', {
      phase,
      durationMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? (error.stack ?? null) : null,
    });
  }
}

function logStartupPhaseCompleted(
  logger: LogWriter,
  phase: string,
  startedAt: number,
): void {
  logger('info', 'Startup phase completed', {
    phase,
    durationMs: elapsedMs(startedAt),
  });
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function yieldStartup(): Promise<void> {
  return new Promise((resolveYield) => setImmediate(resolveYield));
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

type DatabaseOpener = (
  filename: string,
  options: OpenDatabaseOptions,
) => JobDatabase | Promise<JobDatabase>;

export {
  restorePersistenceSet,
  verifyBackupSet,
  loadBackupManifest,
  dryRunRestore,
  listBackups as listBackupMetadata,
  type BackupManifest,
  type BackupMetadata,
  type PersistenceSetPaths,
  type RestoreResult,
  type RestoreDryRunReport,
  type FileRole,
  type BackupFileRecord,
} from '../db/persistenceSetBackup.js';
