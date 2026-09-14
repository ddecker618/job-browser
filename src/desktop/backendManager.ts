import type { BackendHandle, BackendStartupPhase } from '../server/backend.js';
import { startBackend } from '../server/backend.js';
import { openDatabaseAsync } from '../db/database.js';
import { databaseStartupError } from './errors.js';
import type { DesktopPaths } from './paths.js';
import {
  assertDatabaseOutsideInstallDirectory,
  saveRuntimeDatabase,
} from './paths.js';
import { waitForHealth, type StartupStage } from './startup.js';
import type { LogWriter } from '../logging/logger.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';

export class BackendManager {
  private handle: BackendHandle | null = null;
  private shutdownPromise: Promise<void> | null = null;

  public async start(
    paths: DesktopPaths,
    options: {
      development: boolean;
      logger: LogWriter;
      credentialResolver: CredentialResolver;
      onProgress?: (stage: StartupStage) => void;
    },
  ): Promise<BackendHandle> {
    if (this.handle !== null) return this.handle;
    try {
      this.handle = await startBackend({
        databaseOpener: openDatabaseAsync,
        databasePath: paths.database,
        databaseQuarantineDirectory: paths.databaseQuarantine,
        migrationsDirectory: paths.migrations,
        backupDirectory: paths.backups,
        candidateProfilePath: paths.candidateProfile,
        scoringConfigPath: paths.scoringConfig,
        profilePreferencesPath: paths.profilePreferences,
        resumeDirectory: paths.resumes,
        snapshotDirectory: paths.snapshots,
        artifactDirectory: paths.diagnostics,
        clientDirectory: paths.client,
        development: options.development,
        host: '127.0.0.1',
        port: 0,
        logger: options.logger,
        backupBeforeMigrations: true,
        credentialResolver: options.credentialResolver,
        enableScheduler: true,
        seedDefaultSources: true,
        linkedinProfile: paths.linkedinProfile,
        diceProfile: paths.diceProfile,
        handshakeProfile: paths.handshakeProfile,
        indeedProfile: paths.indeedProfile,
        wellfoundProfile: paths.wellfoundProfile,
        ziprecruiterProfile: paths.ziprecruiterProfile,
        usaJobsProfile: paths.usaJobsProfile,
        onStartupProgress: (phase) =>
          options.onProgress?.(startupStageForBackendPhase(phase)),
        onSettingsSaved: (settings) => {
          if (!options.development) {
            assertDatabaseOutsideInstallDirectory(
              settings.databaseLocation,
              paths.resources,
            );
          }
          saveRuntimeDatabase(paths.runtimeSettings, settings.databaseLocation);
        },
      });
      await waitForHealth(this.handle.url);
      return this.handle;
    } catch (error) {
      await this.stop();
      throw databaseStartupError(error) ?? error;
    }
  }

  public get current(): BackendHandle | null {
    return this.handle;
  }

  /**
   * The currently in-flight shutdown, if any. Repeated quit attempts can
   * await this so the backend is not stopped twice in parallel and so
   * later callers see the same completion signal as the first.
   */
  public get currentShutdown(): Promise<void> | null {
    return this.shutdownPromise;
  }

  public async stop(): Promise<void> {
    // A second stop() while a previous shutdown is still running should
    // share the same promise; clearing `handle` before awaiting means
    // other code may see "no backend" while cleanup is still happening.
    if (this.shutdownPromise !== null) {
      await this.shutdownPromise;
      return;
    }
    const handle = this.handle;
    this.handle = null;
    if (handle === null) return;
    const promise = handle.stop();
    this.shutdownPromise = promise;
    try {
      await promise;
    } finally {
      this.shutdownPromise = null;
    }
  }
}

function startupStageForBackendPhase(phase: BackendStartupPhase): StartupStage {
  switch (phase) {
    case 'checking-database':
      return 'Checking database';
    case 'backing-up-database':
      return 'Backing up database';
    case 'applying-database-updates':
      return 'Applying database updates';
    case 'starting-local-service':
      return 'Starting local service';
  }
}
