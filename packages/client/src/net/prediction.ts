import { movePlayer, type PlayerInput, type SimConfig } from '@veyrath/sim';

interface PendingInput {
  seq: number;
  input: PlayerInput;
}

/** One tick of the attack cooldown, mirroring the order in the server's stepWorld. */
function stepCooldown(
  cooldown: number,
  attack: boolean,
  cooldownTicks: number,
): { cooldown: number; swung: boolean } {
  const cd = cooldown > 0 ? cooldown - 1 : 0;
  return attack && cd === 0
    ? { cooldown: cooldownTicks, swung: true }
    : { cooldown: cd, swung: false };
}

/**
 * Local-player prediction with server reconciliation. Inputs are applied immediately with the same
 * movement function the server uses; each snapshot resets to the server position and replays the
 * inputs it has not acknowledged yet. Small corrections are blended out visually; large ones snap.
 *
 * The prediction only advances once per input tick (30 Hz). Drawn as-is on a 120–144 Hz screen the
 * local player visibly steps ("motion blur" in the first friend test), so the drawn position glides
 * from the previous step to the current one over one tick interval, like remote players do.
 *
 * The attack cooldown is predicted the same way, so the local swing can be shown the moment the
 * key is pressed instead of a round trip later. Whether the swing hits is still decided only by the
 * server (enemy HP and hit flashes come from snapshots).
 */
export class Predictor {
  private pending: PendingInput[] = [];
  private predicted: { x: number; y: number } | null = null;
  /** Position before the most recent step, and when that step happened. */
  private previous: { x: number; y: number } | null = null;
  private lastStepAt = 0;
  private readonly stepMs: number;
  private offset = { x: 0, y: 0 };
  private cooldown = 0;
  /** When the predicted local swing last started, or null. */
  private lastSwingAt: number | null = null;
  /** Distance between the old prediction and the reconciled one at the last snapshot. */
  lastCorrection = 0;
  corrections = 0;

  constructor(
    private readonly config: SimConfig,
    private readonly maxPending = 120,
    private readonly snapDistance = 120,
  ) {
    this.stepMs = 1000 / config.tickRate;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.pending = [];
    this.predicted = null;
    this.previous = null;
    this.offset = { x: 0, y: 0 };
    this.lastCorrection = 0;
    this.cooldown = 0;
    this.lastSwingAt = null;
  }

  applyLocal(seq: number, input: PlayerInput, now = 0): void {
    if (!this.predicted) return;
    this.previous = this.predicted;
    this.lastStepAt = now;
    this.predicted = movePlayer(this.predicted.x, this.predicted.y, input, this.config);
    const cd = stepCooldown(this.cooldown, input.attack, this.config.attackCooldownTicks);
    this.cooldown = cd.cooldown;
    if (cd.swung) this.lastSwingAt = now;
    this.pending.push({ seq, input });
    if (this.pending.length > this.maxPending) this.pending.shift();
  }

  reconcile(serverX: number, serverY: number, ack: number, serverCooldown?: number): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) this.pending.shift();
    let pos = { x: serverX, y: serverY };
    for (const p of this.pending) pos = movePlayer(pos.x, pos.y, p.input, this.config);
    if (serverCooldown !== undefined) {
      let cd = serverCooldown;
      for (const p of this.pending) {
        cd = stepCooldown(cd, p.input.attack, this.config.attackCooldownTicks).cooldown;
      }
      this.cooldown = cd;
    }

    if (this.predicted) {
      const ex = this.predicted.x - pos.x;
      const ey = this.predicted.y - pos.y;
      this.lastCorrection = Math.hypot(ex, ey);
      if (this.lastCorrection > 0.01) this.corrections += 1;
      if (this.lastCorrection > this.snapDistance) {
        this.offset = { x: 0, y: 0 };
        this.previous = pos;
      } else {
        this.offset.x += ex;
        this.offset.y += ey;
        // Keep the in-progress glide; the correction itself is carried by the offset.
        if (this.previous) this.previous = { x: this.previous.x - ex, y: this.previous.y - ey };
      }
    }
    this.predicted = pos;
  }

  /** Milliseconds since the predicted local swing started, or null if there hasn't been one. */
  swingAgeMs(now: number): number | null {
    return this.lastSwingAt === null ? null : now - this.lastSwingAt;
  }

  /**
   * Position to draw this frame: glides between the last two steps and decays any correction
   * offset over ~100 ms. Without `now` it returns the latest step (no glide).
   */
  renderPosition(frameMs: number, now?: number): { x: number; y: number } | null {
    if (!this.predicted) return null;
    const decay = Math.exp(-frameMs / 100);
    this.offset.x *= decay;
    this.offset.y *= decay;
    let base = this.predicted;
    if (now !== undefined && this.previous) {
      const t = Math.min(1, Math.max(0, (now - this.lastStepAt) / this.stepMs));
      base = {
        x: this.previous.x + (this.predicted.x - this.previous.x) * t,
        y: this.previous.y + (this.predicted.y - this.previous.y) * t,
      };
    }
    return { x: base.x + this.offset.x, y: base.y + this.offset.y };
  }
}
