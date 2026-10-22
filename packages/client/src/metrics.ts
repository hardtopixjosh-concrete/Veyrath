/** Counts events in a sliding one-second window. */
export class RollingRate {
  private stamps: number[] = [];

  constructor(private readonly windowMs = 1000) {}

  mark(now: number): void {
    this.stamps.push(now);
    this.trim(now);
  }

  perSecond(now: number): number {
    this.trim(now);
    return (this.stamps.length * 1000) / this.windowMs;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.stamps.length && this.stamps[drop]! < cutoff) drop++;
    if (drop > 0) this.stamps.splice(0, drop);
  }
}

/** Per-second rate of a monotonically increasing counter (e.g. total bytes). */
export class CounterRate {
  private lastValue = 0;
  private lastTime = 0;
  rate = 0;

  update(value: number, now: number): void {
    if (this.lastTime === 0) {
      this.lastValue = value;
      this.lastTime = now;
      return;
    }
    const dt = now - this.lastTime;
    if (dt < 500) return;
    this.rate = ((value - this.lastValue) * 1000) / dt;
    this.lastValue = value;
    this.lastTime = now;
  }
}

export class Ema {
  value: number | null = null;

  constructor(private readonly alpha: number) {}

  add(sample: number): number {
    this.value = this.value === null ? sample : this.value + (sample - this.value) * this.alpha;
    return this.value;
  }
}
