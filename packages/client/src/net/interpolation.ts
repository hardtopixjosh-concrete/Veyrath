import type { EnemySnapshot, PlayerSnapshot, WorldSnapshot } from '@veyrath/sim';

interface Entry {
  world: WorldSnapshot;
  receivedAt: number;
}

export interface InterpolatedView {
  renderTick: number;
  players: PlayerSnapshot[];
  enemy: EnemySnapshot;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Bounded buffer of recent snapshots. Remote entities are drawn slightly in the past
 * (`delayTicks`) and interpolated between the two snapshots that bracket that moment, which hides
 * network jitter at the cost of a small, fixed visual delay.
 */
export class SnapshotBuffer {
  private entries: Entry[] = [];
  /** Smoothed estimate of (server tick − local time in ticks). */
  private clockOffset: number | null = null;

  constructor(
    private readonly tickRate: number,
    private readonly maxEntries = 40,
  ) {}

  get size(): number {
    return this.entries.length;
  }

  latest(): WorldSnapshot | null {
    return this.entries[this.entries.length - 1]?.world ?? null;
  }

  clear(): void {
    this.entries = [];
    this.clockOffset = null;
  }

  push(world: WorldSnapshot, receivedAt: number): void {
    const last = this.entries[this.entries.length - 1];
    if (last && world.tick <= last.world.tick) return; // stale or duplicate
    this.entries.push({ world, receivedAt });
    if (this.entries.length > this.maxEntries) this.entries.shift();

    const sample = world.tick - (receivedAt * this.tickRate) / 1000;
    if (this.clockOffset === null || Math.abs(sample - this.clockOffset) > this.tickRate) {
      this.clockOffset = sample;
    } else {
      this.clockOffset += (sample - this.clockOffset) * 0.05;
    }
  }

  /** Estimated current server tick minus the interpolation delay. */
  renderTick(now: number, delayTicks: number): number {
    if (this.clockOffset === null) return 0;
    return (now * this.tickRate) / 1000 + this.clockOffset - delayTicks;
  }

  sample(now: number, delayTicks: number): InterpolatedView | null {
    const newest = this.entries[this.entries.length - 1];
    if (!newest) return null;
    const oldest = this.entries[0]!;
    const target = Math.min(
      Math.max(this.renderTick(now, delayTicks), oldest.world.tick),
      newest.world.tick,
    );

    let a = oldest.world;
    let b = newest.world;
    for (let i = this.entries.length - 1; i > 0; i--) {
      const prev = this.entries[i - 1]!.world;
      if (prev.tick <= target) {
        a = prev;
        b = this.entries[i]!.world;
        break;
      }
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (target - a.tick) / span)) : 1;

    const players = b.players.map((pb) => {
      const pa = a.players.find((p) => p.id === pb.id);
      if (!pa) return pb;
      return { ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) };
    });

    const ea = a.enemy;
    const eb = b.enemy;
    const teleported = ea.alive !== eb.alive || Math.hypot(eb.x - ea.x, eb.y - ea.y) > 150;
    const enemy = teleported ? eb : { ...eb, x: lerp(ea.x, eb.x, t), y: lerp(ea.y, eb.y, t) };

    return { renderTick: target, players, enemy };
  }
}
