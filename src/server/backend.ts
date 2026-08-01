import type { Server } from 'node:http';
import { resolve } from 'node:path';

import express from 'express';

import { createDatabaseBackup } from '../db/backup.js';
import { openDatabase, type JobDatabase } from '../db/database.js';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  listPendingMigrations,
  runMigrations,
} from '../db/migration-runner.js';
import { seedKnownApplications } from '../db/seeds/known-applications.js';
import type { LogWriter } from '../logging/logger.js';
import { log } from '../logging/logger.js';
import { createApp, type AppOptions } from './app.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { JobRepository } from '../repositories/job-repository.js';
import { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import { DiscoveryScheduler } from '../discovery/discoveryScheduler.js';
import { unavailableCredentialResolver } from '../discovery/credentialResolver.js';
import { IntelligenceEngine } from '../intelligence/intelligenceEngine.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { LinkedInProvider } from '../providers/linkedIn.provider.js';
import { DiceProvider } from '../providers/dice.provider.js';
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
  indeedProfile?: string;
  wellfoundProfile?: string;
  ziprecruiterProfile?: string;
  usaJobsProfile?: string;
}

export interface BackendHandle {
  database: JobDatabase;
  server: Server;
  url: string;
  pendingMigrations: string[];
  migrationBackupPath: string | null;
  coordinator: DiscoveryCoordinator;
  backup(): Promise<string>;
  stop(): Promise<void>;
}

export async function startBackend(
  options: BackendOptions = {},
): Promise<BackendHandle> {
  const logger = options.logger ?? log;
  const database = openDatabase(options.databasePath);
  let server: Server | undefined;
  try {
    const quickCheck = database.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok')
      throw new Error(`SQLite integrity check failed: ${String(quickCheck)}`);
    const migrationsDirectory =
      options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY;
    const pendingMigrations = listPendingMigrations(
      database,
      migrationsDirectory,
    );
    let migrationBackupPath: string | null = null;
    if (
      pendingMigrations.length > 0 &&
      options.backupBeforeMigrations === true &&
      options.backupDirectory !== undefined
    ) {
      migrationBackupPath = await createDatabaseBackup(
        database,
        options.backupDirectory,
        'pre-migration',
      );
    }
    runMigrations(database, migrationsDirectory);
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
    new JobRepository(database).refreshMatchedFamilies();
    const currentProfile = loadCandidateProfile(options.candidateProfilePath);
    const currentScoring = loadScoringConfig(options.scoringConfigPath);
    const reprocessed = new IntelligenceEngine(
      database,
      options.logger ?? logger,
    ).reprocessIfStale(currentProfile, currentScoring);
    if (reprocessed !== null) {
      logger('info', 'Stale job scores reprocessed', { ...reprocessed });
    }
    const coordinator = new DiscoveryCoordinator(database, providerRegistry, {
      credentialResolver:
        options.credentialResolver ?? unavailableCredentialResolver,
      ...(options.profilePreferencesPath === undefined
        ? {}
        : { profilePreferencesPath: options.profilePreferencesPath }),
      analyze: () =>
        new IntelligenceEngine(database).analyze(
          loadCandidateProfile(options.candidateProfilePath),
          loadScoringConfig(options.scoringConfigPath),
        ),
    });
    const scheduler =
      options.enableScheduler === true
        ? new DiscoveryScheduler(sourceRepository, coordinator)
        : null;
    scheduler?.start();
    const app = createApp(database, {
      ...options,
      coordinator,
      sourceRepository,
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
      database,
      server,
      url,
      pendingMigrations,
      migrationBackupPath,
      coordinator,
      backup: async () => {
        if (options.backupDirectory === undefined)
          throw new Error('Backup directory is not configured');
        return createDatabaseBackup(database, options.backupDirectory);
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
        database.pragma('wal_checkpoint(TRUNCATE)');
        database.close();
      },
    };
  } catch (error) {
    if (server !== undefined) server.close();
    if (database.open) database.close();
    throw error;
  }
}
