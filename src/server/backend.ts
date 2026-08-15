import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';

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
  type JobDatabase,
} from '../db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  listPendingMigrations,
  runMigrations,
} from '../db/migration-runner.js';
import { seedKnownApplications } from '../db/seeds/known-applications.js';
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
import { unavailableCredentialResolver } from '../discovery/credentialResolver.js';
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
  try {
    options.onStartupProgress?.('checking-database');
    database = openDatabase(
      databasePath,
      quarantineDirectory === undefined
        ? {}
        : { quarantineDirectory: quarantineDirectory },
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
      options.onStartupProgress?.('backing-up-database');
      migrationBackupPath = await createDatabaseBackup(
        database,
        options.backupDirectory,
        'pre-migration',
      );
    }
    options.onStartupProgress?.('applying-database-updates');
    runMigrations(database, migrationsDirectory);
    seedEmployerRegistry(database);
    options.onStartupProgress?.('starting-local-service');
    seedKnownApplications(database);
    await providerRegistry.loadProviders();
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
    const sourceRepository = new SourceRepository(
      database,
      options.profilePreferencesPath,
    );
    sourceRepository.reconcileProviders(providerRegistry.list());
    if (options.seedDefaultSources === true) {
      sourceRepository.ensureDefaultSources();
    }
    sourceRepository.recoverInterruptedRuns();
    const jobLifecycle = new JobLifecycleRepository(database);
    const lifecycleReconciliation = jobLifecycle.reconcileKnownClosures();
    if (lifecycleReconciliation.changed > 0) {
      logger('info', 'Known job closures reconciled', lifecycleReconciliation);
    }
    new JobRepository(database).refreshMatchedFamilies();
    const currentProfile = loadCandidateProfile(options.candidateProfilePath);
    const currentScoring = loadScoringConfig(options.scoringConfigPath);
    const reconciliation = new IntelligenceEngine(
      database,
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
        scoresReprocessed: reconciliation.analysis?.jobsAnalyzed ?? 0,
      });
    }
    const coordinator = new DiscoveryCoordinator(database, providerRegistry, {
      credentialResolver:
        options.credentialResolver ?? unavailableCredentialResolver,
      ...(options.profilePreferencesPath === undefined
        ? {}
        : { profilePreferencesPath: options.profilePreferencesPath }),
      analyze: () =>
        new IntelligenceEngine(activeDatabase).analyze(
          loadCandidateProfile(options.candidateProfilePath),
          loadScoringConfig(options.scoringConfigPath),
        ),
    });
    const employerRepository = new EmployerRepository(database);
    const employerDiscoveryIntelligence =
      new EmployerDiscoveryIntelligenceService(database);
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
          )
        : null;
    scheduler?.start();
    const app = createApp(database, {
      ...options,
      coordinator,
      sourceRepository,
      employerRepository,
      employerDiscoveryService,
      careerSiteHealthService,
      employerDiscoveryIntelligence,
    });
    if (options.development === true) {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
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
    }
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 0;
    server = await new Promise<Server>((resolveServer, reject) => {
      const candidate = app.listen(port, host, () => resolveServer(candidate));
      candidate.once('error', reject);
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Backend did not select a TCP port');
    const url = `http://${host}:${String(address.port)}`;
    logger('info', 'Backend started', { url, pendingMigrations });
    let stopped = false;
    return {
      database: activeDatabase,
      server,
      url,
      pendingMigrations,
      migrationBackupPath,
      coordinator,
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
        if (scheduler !== null) await scheduler.stop();
        else await coordinator.stop();
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
