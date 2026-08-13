import type { DiscoveryCoordinator } from './discoveryCoordinator.js';
import type { CredentialResolver } from './credentialResolver.js';
import { detectCareerSiteProvider } from '../domain/atsFingerprint.js';
import type { CareerSite } from '../models/employer.js';
import type { ProviderRegistry } from '../providers/providerRegistry.js';
import { EmployerRepository } from '../repositories/employerRepository.js';
import { SourceRepository } from '../repositories/source-repository.js';
import type { EmployerDiscoveryIntelligenceService } from './employerDiscoveryIntelligenceService.js';

export interface EmployerDiscoveryRunResult {
  attempted: number;
  succeeded: number;
  sourceCreated: number;
  sourceReused: number;
  unsupported: number;
  failed: number;
  credentialRequired: number;
  skipped: number;
  sites: CareerSite[];
}

export class EmployerDiscoveryService {
  private activeRun: Promise<EmployerDiscoveryRunResult> | null = null;

  public constructor(
    private readonly employers: EmployerRepository,
    private readonly sources: SourceRepository,
    private readonly providers: Pick<ProviderRegistry, 'loadProviders' | 'get'>,
    private readonly coordinator?: DiscoveryCoordinator,
    private readonly credentialResolver?: CredentialResolver,
    private readonly intelligence?: EmployerDiscoveryIntelligenceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public runEligible(limit = 25): Promise<EmployerDiscoveryRunResult> {
    if (this.activeRun !== null) return this.activeRun;
    this.activeRun = this.runEligibleInternal(limit).finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  private async runEligibleInternal(
    limit: number,
  ): Promise<EmployerDiscoveryRunResult> {
    const result: EmployerDiscoveryRunResult = {
      attempted: 0,
      succeeded: 0,
      sourceCreated: 0,
      sourceReused: 0,
      unsupported: 0,
      failed: 0,
      credentialRequired: 0,
      skipped: 0,
      sites: [],
    };
    const evaluatedAt = this.now();
    const eligibleSites =
      this.intelligence === undefined
        ? this.employers.listDiscoveryEligible(evaluatedAt.toISOString(), limit)
        : this.intelligence
            .eligibleSiteIds(limit, evaluatedAt)
            .map((id) => this.employers.getCareerSite(id))
            .filter((site): site is CareerSite => site !== null);
    for (const site of eligibleSites) {
      result.attempted += 1;
      const outcome = await this.runSite(site.id, true, true);
      result.sites.push(outcome.site);
      result[outcome.counter] += 1;
      if (
        outcome.counter === 'sourceCreated' ||
        outcome.counter === 'sourceReused'
      ) {
        result.succeeded += 1;
      }
    }
    return result;
  }

  public async runSite(
    careerSiteId: string,
    execute = false,
    enforceIntelligenceSafety = execute,
  ): Promise<{
    site: CareerSite;
    counter:
      | 'sourceCreated'
      | 'sourceReused'
      | 'unsupported'
      | 'failed'
      | 'credentialRequired'
      | 'skipped';
  }> {
    if (enforceIntelligenceSafety && this.intelligence !== undefined) {
      const initialDecision = this.intelligence.decision(
        careerSiteId,
        this.now(),
      );
      if (initialDecision !== null && !initialDecision.executable) {
        const site = this.employers.getCareerSite(careerSiteId);
        if (site === null)
          throw new Error(`Career site not found: ${careerSiteId}`);
        return { site, counter: 'skipped' };
      }
    }
    const verified = this.employers.verifyCareerSite(careerSiteId);
    const signal = detectCareerSiteProvider(verified.url);
    const attemptedAt = this.now().toISOString();
    if (signal === null || verified.fingerprint?.atsDetectedProvider == null) {
      return {
        site: this.employers.recordDiscoveryAttempt({
          careerSiteId,
          state: 'unsupported',
          result: 'unsupported',
          providerId: null,
          sourceId: null,
          detail: 'Unknown or unsupported ATS; no Source was created',
          attemptedAt,
          nextEligibleAt: null,
        }),
        counter: 'unsupported',
      };
    }

    try {
      await this.providers.loadProviders();
      const provider = this.providers.get(signal.providerId);
      const configuration = signal.configuration ?? {};
      const validation = await provider.validateConfiguration(configuration);
      if (!validation.valid) throw new Error(validation.message);
      const employer = this.employers.getEmployer(verified.employerId);
      if (employer === null) throw new Error('Employer no longer exists');

      let source = this.sources
        .list()
        .find(
          (candidate) =>
            candidate.providerId === signal.providerId &&
            normalizeUrl(candidate.careersUrl) === normalizeUrl(verified.url),
        );
      const reused = source !== undefined;
      if (source === undefined) {
        const credentialStatus = provider.capabilities.requiresCredentials
          ? await this.credentialResolver?.status(provider.id)
          : { configured: true };
        source = this.sources.create(
          {
            displayName: `${employer.name} (${signal.platform})`,
            employer: employer.name,
            providerId: signal.providerId,
            careersUrl: verified.url,
            configuration,
            searchCriteria: {
              query: '',
              location: null,
              remoteOnly: false,
              limit: 25,
            },
            enabled: execute,
            schedule: {
              enabled: false,
              cadence: 'manual',
              dailyLocalTime: null,
            },
          },
          credentialStatus?.configured === false
            ? 'credentials-required'
            : 'valid',
        );
      }

      if (
        this.coordinator !== undefined &&
        source.configurationStatus === 'valid' &&
        source.enabled &&
        execute
      ) {
        if (enforceIntelligenceSafety && this.intelligence !== undefined) {
          const executionDecision = this.intelligence.decision(
            careerSiteId,
            this.now(),
          );
          if (executionDecision !== null && !executionDecision.executable) {
            return { site: verified, counter: 'skipped' };
          }
        }
        await this.coordinator.runSource(source.id, 'manual-source');
      }
      const credentialsRequired =
        source.configurationStatus === 'credentials-required';
      return {
        site: this.employers.recordDiscoveryAttempt({
          careerSiteId,
          state: reused ? 'source-reused' : 'source-created',
          result: credentialsRequired
            ? 'skipped'
            : reused
              ? 'source-reused'
              : 'source-created',
          providerId: signal.providerId,
          sourceId: source.id,
          detail: credentialsRequired
            ? 'Source registered but credentials are required before execution'
            : reused
              ? 'Reused equivalent Source through the canonical discovery path'
              : 'Created Source through the canonical discovery path',
          attemptedAt,
          nextEligibleAt: null,
        }),
        counter: credentialsRequired
          ? 'credentialRequired'
          : reused
            ? 'sourceReused'
            : 'sourceCreated',
      };
    } catch (error) {
      const attempt = verified.discovery.attemptCount + 1;
      const nextEligibleAt = new Date(
        Date.parse(attemptedAt) +
          Math.min(24 * 60, 15 * 2 ** (attempt - 1)) * 60_000,
      ).toISOString();
      return {
        site: this.employers.recordDiscoveryAttempt({
          careerSiteId,
          state: 'backoff',
          result: 'failed',
          providerId: signal.providerId,
          sourceId: null,
          detail: error instanceof Error ? error.message : String(error),
          attemptedAt,
          nextEligibleAt,
        }),
        counter: 'failed',
      };
    }
  }
}

function normalizeUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).toString();
  } catch {
    return value.trim().toLowerCase();
  }
}
