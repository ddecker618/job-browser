import {
  ASYNC_WORKER_VERSION,
  runNlpBackgroundWorker,
  type AsyncWorkerContext,
} from './async.js';

// ---------------------------------------------------------------------------
// P4 - application-lifecycle background NLP worker.
//
// Owns the scheduling loop and exposes a read-only status projection. Every
// sweep is bounded (maxJobsPerSweep), abortable end-to-end, and single-flight.
// The worker only persists NLP enrichments; it never modifies jobs, scoring,
// eligibility, ranking, or lifecycle records.
// ---------------------------------------------------------------------------

export interface NlpBackgroundWorkerOptions {
  batchSize?: number;
  maxJobsPerSweep?: number;
  sweepDelayMs?: number;
  startDelayMs?: number;
  timeoutPerJobMs?: number;
  staleHint?: () => number | null;
}

export interface NlpSweepSummary {
  startedAt: string;
  finishedAt: string;
  processed: number;
  extracted: number;
  skipped: number;
  failed: number;
  failedJobIds: string[];
  capped: boolean;
  durationMs: number;
  aborted: boolean;
}

export type NlpWorkerState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'stopped';

export interface NlpWorkerStatus {
  workerVersion: typeof ASYNC_WORKER_VERSION;
  state: NlpWorkerState;
  startedAt: string | null;
  lastSweep: NlpSweepSummary | null;
  nextSweepAt: string | null;
  totals: {
    processed: number;
    extracted: number;
    skipped: number;
    failed: number;
  };
  lastFailure: string | null;
  staleRemainingHint: number | null;
}

export class NlpBackgroundWorker {
  private readonly batchSize: number;
  private readonly maxJobsPerSweep: number;
  private readonly sweepDelayMs: number;
  private readonly startDelayMs: number;
  private readonly timeoutPerJobMs: number;

  private state: NlpWorkerState = 'idle';
  private startedAt: string | null = null;
  private nextSweepAt: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;
  private inFlightPromise: Promise<NlpSweepSummary> | null = null;
  private stopped = false;
  private started = false;
  private lastSweep: NlpSweepSummary | null = null;
  private lastFailure: string | null = null;
  private cursor: string | null = null;
  private totals = {
    processed: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
  };

  public constructor(
    private readonly context: AsyncWorkerContext,
    private readonly options: NlpBackgroundWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 25;
    this.maxJobsPerSweep = options.maxJobsPerSweep ?? 500;
    this.sweepDelayMs = options.sweepDelayMs ?? 60_000;
    this.startDelayMs = options.startDelayMs ?? 1_500;
    this.timeoutPerJobMs = options.timeoutPerJobMs ?? 20_000;
  }

  public start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.startedAt = new Date().toISOString();
    this.state = 'waiting';
    this.schedule(this.startDelayMs);
  }

  public async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.state = 'stopping';
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextSweepAt = null;
    this.controller?.abort();
    if (this.inFlightPromise !== null) await this.inFlightPromise;
    this.state = 'stopped';
  }

  public async runSweepOnce(): Promise<NlpSweepSummary> {
    if (this.stopped) {
      throw new Error('NLP background worker has been stopped');
    }
    if (this.inFlightPromise !== null) return this.inFlightPromise;
    const controller = new AbortController();
    this.controller = controller;
    const promise = this.executeSweep(controller);
    this.inFlightPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlightPromise === promise) this.inFlightPromise = null;
      if (this.controller === controller) this.controller = null;
    }
  }

  public status(): NlpWorkerStatus {
    return {
      workerVersion: ASYNC_WORKER_VERSION,
      state: this.state,
      startedAt: this.startedAt,
      lastSweep: this.lastSweep,
      nextSweepAt: this.nextSweepAt,
      totals: { ...this.totals },
      lastFailure: this.lastFailure,
      staleRemainingHint: this.options.staleHint?.() ?? null,
    };
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.nextSweepAt = new Date(Date.now() + delayMs).toISOString();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runSweepOnce()
        .catch(() => undefined)
        .then(() => this.schedule(this.sweepDelayMs));
    }, delayMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private async executeSweep(
    controller: AbortController,
  ): Promise<NlpSweepSummary> {
    this.state = 'running';
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    try {
      const result = await runNlpBackgroundWorker(this.context, {
        batchSize: this.batchSize,
        maxTotal: this.maxJobsPerSweep,
        timeoutPerJobMs: this.timeoutPerJobMs,
        abortSignal: controller.signal,
        afterJobId: this.cursor,
      });
      this.totals.processed += result.processed;
      this.totals.extracted += result.extracted;
      this.totals.skipped += result.skipped;
      this.totals.failed += result.failed;
      const capped = result.hasMore && result.processed >= this.maxJobsPerSweep;
      this.cursor = capped ? result.lastJobId : null;
      const summary: NlpSweepSummary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        processed: result.processed,
        extracted: result.extracted,
        skipped: result.skipped,
        failed: result.failed,
        failedJobIds: result.failedJobIds,
        capped,
        durationMs: result.durationMs,
        aborted: false,
      };
      this.lastSweep = summary;
      return summary;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.lastFailure =
          error instanceof Error ? error.message : String(error);
        throw error;
      }
      const abortedSummary: NlpSweepSummary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        processed: 0,
        extracted: 0,
        skipped: 0,
        failed: 0,
        failedJobIds: [],
        capped: false,
        durationMs: Date.now() - startTime,
        aborted: true,
      };
      this.lastSweep = abortedSummary;
      return abortedSummary;
    } finally {
      this.state = this.stopped ? 'stopped' : 'waiting';
    }
  }
}
