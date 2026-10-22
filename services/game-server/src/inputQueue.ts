import type { PlayerInput } from '@veyrath/sim';

export type InputPushResult = 'accepted' | 'accepted_dropped_oldest' | 'duplicate' | 'out_of_order';

export interface QueuedInput {
  seq: number;
  input: PlayerInput;
}

/**
 * Bounded per-player input queue. Sequence numbers must strictly increase: duplicates and
 * out-of-order inputs are rejected. When full, the oldest input is dropped — the client's
 * reconciliation absorbs the difference because acks only ever move forward.
 */
export class InputQueue {
  private items: QueuedInput[] = [];
  private highestSeq = -1;

  constructor(readonly maxSize: number) {}

  get size(): number {
    return this.items.length;
  }

  get highestReceivedSeq(): number {
    return this.highestSeq;
  }

  push(seq: number, input: PlayerInput): InputPushResult {
    if (seq === this.highestSeq) return 'duplicate';
    if (seq < this.highestSeq) return 'out_of_order';
    this.highestSeq = seq;
    this.items.push({ seq, input });
    if (this.items.length > this.maxSize) {
      this.items.shift();
      return 'accepted_dropped_oldest';
    }
    return 'accepted';
  }

  shift(): QueuedInput | undefined {
    return this.items.shift();
  }

  /** Drops queued inputs but keeps the sequence high-water mark (seq stays monotonic per player). */
  clear(): void {
    this.items = [];
  }
}
