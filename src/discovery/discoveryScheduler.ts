import type { SourceRepository } from '../repositories/source-repository.js';
import type { DiscoveryCoordinator } from './discoveryCoordinator.js';

export class DiscoveryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  public constructor(
    private readonly sources: SourceRepository,
    private readonly coordinator: DiscoveryCoordinator,
    private readonly intervalMs = 30_000,
  ) {}

  public start(): void {
    if (this.timer !== null || this.stopped) return;
    for (const missed of this.sources.listDue(new Date().toISOString())) {
      this.sources.updateScheduleAfterRun(missed.id);
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
    if (this.stopped || !this.sources.getSchedulerEnabled()) return;
    const due = this.sources.listDue(new Date().toISOString());
    for (const source of due) {
      await this.coordinator.runSource(source.id, 'scheduled');
    }
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
