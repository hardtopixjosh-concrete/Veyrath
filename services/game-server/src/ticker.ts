export interface TickerStats {
  ticks: number;
  lastTickMs: number;
  /** Exponential moving average of tick work time. */
  avgTickMs: number;
  /** Worst tick work time since the last `resetWindow()`. */
  maxTickMs: number;
  /** Times the loop fell so far behind that it skipped ahead instead of catching up. */
  behindResets: number;
}

/**
 * Drift-correcting fixed-rate loop. Ticks are scheduled against an absolute timeline, so coarse
 * timers (e.g. ~15 ms on Windows) do not change the average rate; late ticks are caught up, up to
 * `maxCatchUpTicks` at once. Independent of any rendering or window state by construction.
 */
export class FixedTicker {
  readonly intervalMs: number;
  readonly stats: TickerStats = {
    ticks: 0,
    lastTickMs: 0,
    avgTickMs: 0,
    maxTickMs: 0,
    behindResets: 0,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;

  constructor(
    rateHz: number,
    private readonly onTick: () => void,
    private readonly maxCatchUpTicks = 5,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.intervalMs = 1000 / rateHz;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.nextTickAt = this.now() + this.intervalMs;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resetWindow(): void {
    this.stats.maxTickMs = 0;
  }

  private schedule(): void {
    this.timer = setTimeout(this.loop, Math.max(0, this.nextTickAt - this.now()));
  }

  private readonly loop = (): void => {
    let ran = 0;
    while (this.now() >= this.nextTickAt && ran < this.maxCatchUpTicks) {
      const started = this.now();
      this.onTick();
      const took = this.now() - started;
      const s = this.stats;
      s.ticks += 1;
      s.lastTickMs = took;
      s.avgTickMs = s.ticks === 1 ? took : s.avgTickMs * 0.95 + took * 0.05;
      if (took > s.maxTickMs) s.maxTickMs = took;
      this.nextTickAt += this.intervalMs;
      ran += 1;
      if (!this.timer) return; // stopped from inside onTick
    }
    if (this.now() - this.nextTickAt > this.intervalMs * this.maxCatchUpTicks) {
      this.nextTickAt = this.now() + this.intervalMs;
      this.stats.behindResets += 1;
    }
    if (this.timer) this.schedule();
  };
}
