import type { BackendHandle, BackendStartupPhase } from '../server/backend.js';
import { startBackend } from '../server/backend.js';
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

  public async stop(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.stop();
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
