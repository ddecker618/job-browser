import type { BackendHandle } from '../server/backend.js';
import { startBackend } from '../server/backend.js';
import type { DesktopPaths } from './paths.js';
import { saveRuntimeDatabase } from './paths.js';
import { waitForHealth } from './startup.js';
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
    },
  ): Promise<BackendHandle> {
    if (this.handle !== null) return this.handle;
    this.handle = await startBackend({
      databasePath: paths.database,
      migrationsDirectory: paths.migrations,
      backupDirectory: paths.backups,
      candidateProfilePath: paths.candidateProfile,
      scoringConfigPath: paths.scoringConfig,
      profilePreferencesPath: paths.profilePreferences,
      resumeDirectory: paths.resumes,
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
      indeedProfile: paths.indeedProfile,
      wellfoundProfile: paths.wellfoundProfile,
      ziprecruiterProfile: paths.ziprecruiterProfile,
      usaJobsProfile: paths.usaJobsProfile,
      onSettingsSaved: (settings) =>
        saveRuntimeDatabase(paths.runtimeSettings, settings.databaseLocation),
    });
    try {
      await waitForHealth(this.handle.url);
      return this.handle;
    } catch (error) {
      await this.stop();
      throw error;
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
