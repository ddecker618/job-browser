import type { SourceRepository } from '../repositories/source-repository.js';
import type { DiscoveryCoordinator } from './discoveryCoordinator.js';
import type { EmployerDiscoveryService } from './employerDiscoveryService.js';
import type { CareerSiteHealthService } from './careerSiteHealthService.js';
import type { JobLifecycleRepository } from '../repositories/job-lifecycle-repository.js';
import type { DiscoveryAlertService } from './discoveryAlertService.js';

const EMPLOYER_DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEALTH_STARTUP_DELAY_MS = 24 * 60 * 60 * 1000;

export class DiscoveryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private healthEligibleAfter: number | null = null;

  public constructor(
    private readonly sources: SourceRepository,
    private readonly coordinator: DiscoveryCoordinator,
    private readonly intervalMs = 30_000,
    private readonly employerDiscovery?: EmployerDiscoveryService,
    private readonly now: () => Date = () => new Date(),
    private readonly careerSiteHealth?: CareerSiteHealthService,
    private readonly jobLifecycle?: JobLifecycleRepository,
    private readonly alerts?: DiscoveryAlertService,
  ) {}

  public start(): void {
    if (this.timer !== null || this.stopped) return;
    const startedAt = this.now();
    this.healthEligibleAfter = startedAt.getTime() + HEALTH_STARTUP_DELAY_MS;
    for (const missed of this.sources.listDue(startedAt.toISOString())) {
      this.sources.updateScheduleAfterRun(missed.id);
    }
    if (this.sources.getEmployerDiscoverySettings().enabled) {
      this.sources.markEmployerDiscoveryEvaluated(startedAt.toISOString());
    }
    this.scheduleNext();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.coordinator.stop();
  }

  public async evaluate(): Promise<void> {
    if (this.stopped) return;
    const evaluatedAt = this.now();
    this.jobLifecycle?.reconcileKnownClosures(evaluatedAt.toISOString());
    if (!this.sources.getSchedulerEnabled()) {
      this.alerts?.evaluateRules();
      return;
    }
    const due = this.sources.listDue(evaluatedAt.toISOString());
    for (const source of due) {
      await this.coordinator.runSource(source.id, 'scheduled');
    }
    if (this.employerDiscovery !== undefined) {
      const employerSettings = this.sources.getEmployerDiscoverySettings();
      if (
        employerSettings.enabled &&
        (employerSettings.lastEvaluatedAt === null ||
          evaluatedAt.getTime() -
            Date.parse(employerSettings.lastEvaluatedAt) >=
            EMPLOYER_DISCOVERY_INTERVAL_MS)
      ) {
        this.sources.markEmployerDiscoveryEvaluated(evaluatedAt.toISOString());
        await this.employerDiscovery.runEligible(25);
      }
    }
    if (
      this.careerSiteHealth !== undefined &&
      (this.healthEligibleAfter === null ||
        evaluatedAt.getTime() >= this.healthEligibleAfter)
    ) {
      await this.careerSiteHealth.runEligible(25);
    }
    this.alerts?.evaluateRules();
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      void this.evaluate().finally(() => {
        if (!this.stopped) this.scheduleNext();
      });
    }, this.intervalMs);
    this.timer.unref();
  }
}
