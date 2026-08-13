import { detectAts, type AtsDetectorOptions } from '../domain/atsDetector.js';
import type { AtsDetectionResult } from '../models/source-management.js';
import type { CareerSite, CareerSiteHealthStatus } from '../models/employer.js';
import { EmployerRepository } from '../repositories/employerRepository.js';
import type { EmployerDiscoveryService } from './employerDiscoveryService.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_MS = 60 * 60 * 1000;

type Detector = (
  url: string,
  options?: AtsDetectorOptions,
) => Promise<AtsDetectionResult>;

export interface CareerSiteHealthRunResult {
  checked: number;
  healthy: number;
  warning: number;
  broken: number;
  skipped: number;
  sites: CareerSite[];
}

export class CareerSiteHealthService {
  private activeRun: Promise<CareerSiteHealthRunResult> | null = null;

  public constructor(
    private readonly employers: EmployerRepository,
    private readonly discovery?: EmployerDiscoveryService,
    private readonly detector: Detector = detectAts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public runEligible(limit = 25): Promise<CareerSiteHealthRunResult> {
    if (this.activeRun !== null) return this.activeRun;
    this.activeRun = this.runEligibleInternal(limit).finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  public async checkSite(
    careerSiteId: string,
    signal?: AbortSignal,
  ): Promise<CareerSite> {
    const site = this.employers.getCareerSite(careerSiteId);
    if (site === null)
      throw new Error(`Career site not found: ${careerSiteId}`);
    if (site.health.status === 'retired') return site;
    const observedAt = this.now();
    const detection = await this.detector(
      site.url,
      signal === undefined ? {} : { signal },
    );
    if (signal?.aborted === true) return site;
    const transition = classify(site, detection);
    return this.employers.recordHealthObservation({
      careerSiteId,
      requestedUrl: site.url,
      effectiveUrl: detection.finalUrl ?? null,
      httpStatus: detection.httpStatus ?? null,
      resultClassification: transition.classification,
      detectedAtsPlatform: detection.detectedPlatform,
      detectedProvider: detection.suggestedProvider,
      supportState: detection.supportState,
      confidence: detection.confidence,
      evidence: [
        ...(detection.positiveSignals ?? []),
        ...(detection.negativeProbes ?? []),
      ].slice(0, 20),
      resultingStatus: transition.status,
      reason: transition.reason,
      observedAt: observedAt.toISOString(),
      failureCount: transition.failureCount,
      nextCheckAt: new Date(
        observedAt.getTime() +
          (transition.transient ? TRANSIENT_RETRY_MS : CHECK_INTERVAL_MS),
      ).toISOString(),
    });
  }

  public async repairSite(careerSiteId: string): Promise<{
    site: CareerSite;
    repaired: boolean;
    reason: string;
  }> {
    const checked = await this.checkSite(careerSiteId);
    if (
      checked.health.status !== 'healthy' ||
      checked.health.effectiveUrl !== checked.url ||
      checked.fingerprint?.atsDetectedProvider === null
    ) {
      return {
        site: checked,
        repaired: false,
        reason:
          'Automatic repair requires a stable healthy URL and supported provider',
      };
    }
    if (this.discovery === undefined) {
      return {
        site: checked,
        repaired: false,
        reason: 'Discovery service is unavailable',
      };
    }
    const outcome = await this.discovery.runSite(careerSiteId, false);
    return {
      site: outcome.site,
      repaired: outcome.site.discovery.sourceId !== null,
      reason:
        outcome.site.discovery.sourceId === null
          ? 'No safe Source mapping was available'
          : 'Equivalent Source was created or reused without deleting prior Sources',
    };
  }

  private async runEligibleInternal(
    limit: number,
  ): Promise<CareerSiteHealthRunResult> {
    const result: CareerSiteHealthRunResult = {
      checked: 0,
      healthy: 0,
      warning: 0,
      broken: 0,
      skipped: 0,
      sites: [],
    };
    for (const site of this.employers.listHealthEligible(
      this.now().toISOString(),
      limit,
    )) {
      const checked = await this.checkSite(site.id);
      result.checked += 1;
      result.sites.push(checked);
      if (checked.health.status === 'healthy') result.healthy += 1;
      else if (checked.health.status === 'warning') result.warning += 1;
      else if (checked.health.status === 'broken') result.broken += 1;
      else result.skipped += 1;
    }
    return result;
  }
}

function classify(
  site: CareerSite,
  detection: AtsDetectionResult,
): {
  status: CareerSiteHealthStatus;
  classification: string;
  reason: string;
  failureCount: number;
  transient: boolean;
} {
  const nextFailureCount = site.health.failureCount + 1;
  if (
    detection.failureCategory === 'invalid_url' ||
    [404, 410].includes(detection.httpStatus ?? 0)
  ) {
    return {
      status: 'broken',
      classification: 'broken',
      reason: detection.explanation,
      failureCount: nextFailureCount,
      transient: false,
    };
  }
  if (
    detection.failureCategory === 'timeout' ||
    detection.failureCategory === 'unreachable' ||
    detection.failureCategory === 'blocked' ||
    (detection.httpStatus !== null &&
      detection.httpStatus !== undefined &&
      detection.httpStatus >= 500)
  ) {
    return {
      status: nextFailureCount >= 3 ? 'broken' : 'warning',
      classification: 'transient-failure',
      reason: detection.explanation,
      failureCount: nextFailureCount,
      transient: true,
    };
  }
  const effectiveUrl = detection.finalUrl ?? detection.resolvedUrl;
  const redirected = normalizeUrl(effectiveUrl) !== normalizeUrl(site.url);
  const previousProvider = site.fingerprint?.atsDetectedProvider ?? null;
  const providerChanged =
    previousProvider !== null &&
    previousProvider !== detection.suggestedProvider;
  if (providerChanged) {
    return {
      status: 'warning',
      classification: 'ats-changed',
      reason: `ATS changed from ${previousProvider} to ${detection.suggestedProvider ?? 'Unknown'}`,
      failureCount: 0,
      transient: false,
    };
  }
  if (redirected) {
    return {
      status: 'warning',
      classification: 'redirected',
      reason: `CareerSite redirects to ${effectiveUrl}`,
      failureCount: 0,
      transient: false,
    };
  }
  if (detection.suggestedProvider === null) {
    return {
      status: 'warning',
      classification: 'unsupported',
      reason: detection.explanation,
      failureCount: 0,
      transient: false,
    };
  }
  return {
    status: 'healthy',
    classification: 'healthy',
    reason: detection.explanation,
    failureCount: 0,
    transient: false,
  };
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}
