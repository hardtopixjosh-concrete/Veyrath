import { movePlayer, type PlayerInput, type SimConfig } from '@veyrath/sim';

interface PendingInput {
  seq: number;
  input: PlayerInput;
}

/**
 * Local-player prediction with server reconciliation. Inputs are applied immediately with the same
 * movement function the server uses; each snapshot resets to the server position and replays the
 * inputs it has not acknowledged yet. Small corrections are blended out visually; large ones snap.
 */
export class Predictor {
  private pending: PendingInput[] = [];
  private predicted: { x: number; y: number } | null = null;
  private offset = { x: 0, y: 0 };
  /** Distance between the old prediction and the reconciled one at the last snapshot. */
  lastCorrection = 0;
  corrections = 0;

  constructor(
    private readonly config: SimConfig,
    private readonly maxPending = 120,
    private readonly snapDistance = 120,
  ) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.pending = [];
    this.predicted = null;
    this.offset = { x: 0, y: 0 };
    this.lastCorrection = 0;
  }

  applyLocal(seq: number, input: PlayerInput): void {
    if (!this.predicted) return;
    this.predicted = movePlayer(this.predicted.x, this.predicted.y, input, this.config);
    this.pending.push({ seq, input });
    if (this.pending.length > this.maxPending) this.pending.shift();
  }

  reconcile(serverX: number, serverY: number, ack: number): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) this.pending.shift();
    let pos = { x: serverX, y: serverY };
    for (const p of this.pending) pos = movePlayer(pos.x, pos.y, p.input, this.config);

    if (this.predicted) {
      const ex = this.predicted.x - pos.x;
      const ey = this.predicted.y - pos.y;
      this.lastCorrection = Math.hypot(ex, ey);
      if (this.lastCorrection > 0.01) this.corrections += 1;
      if (this.lastCorrection > this.snapDistance) {
        this.offset = { x: 0, y: 0 };
      } else {
        this.offset.x += ex;
        this.offset.y += ey;
      }
    }
    this.predicted = pos;
  }

  /** Position to draw this frame; decays any correction offset over ~100 ms. */
  renderPosition(frameMs: number): { x: number; y: number } | null {
    if (!this.predicted) return null;
    const decay = Math.exp(-frameMs / 100);
    this.offset.x *= decay;
    this.offset.y *= decay;
    return { x: this.predicted.x + this.offset.x, y: this.predicted.y + this.offset.y };
  }
}
