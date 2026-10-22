import { encodeMessage, type ServerMessage } from '@veyrath/protocol';
import type { ServerConfig } from './config';
import { TokenBucket } from './rateLimiter';

/** The subset of a `ws` WebSocket the server uses — lets tests drive a fake socket. */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

const OPEN = 1;

export type SendResult = 'sent' | 'skipped' | 'closed' | 'overflow';

export interface RoomRef {
  roomCode: string;
  memberId: string;
}

export class ClientConnection {
  member: RoomRef | null = null;
  isAlive = true;
  closed = false;
  lobbyTimer: ReturnType<typeof setTimeout> | null = null;

  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  messagesOut = 0;
  invalidMessages = 0;
  rejectedInputs = 0;
  skippedSnapshots = 0;
  rateLimitDrops = 0;

  private readonly bucket: TokenBucket;
  private dropWindowStart: number;
  private dropsInWindow = 0;

  constructor(
    readonly id: number,
    private readonly socket: SocketLike,
    private readonly config: ServerConfig,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.bucket = new TokenBucket(config.rateLimitBurst, config.rateLimitPerSecond, now);
    this.dropWindowStart = now();
  }

  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  send(msg: ServerMessage): SendResult {
    return this.sendRaw(encodeMessage(msg), false);
  }

  /**
   * Sends unless the socket is backed up. `droppable` frames (full snapshots) are skipped while the
   * buffer is above the soft limit — the next snapshot supersedes them anyway. Past the hard limit
   * the connection is terminated rather than allowed to grow without bound.
   */
  sendRaw(data: string, droppable: boolean): SendResult {
    if (this.closed || this.socket.readyState !== OPEN) return 'closed';
    const buffered = this.socket.bufferedAmount;
    if (buffered > this.config.maxBufferedBytes) {
      this.terminate();
      return 'overflow';
    }
    if (droppable && buffered > this.config.snapshotSkipBufferedBytes) {
      this.skippedSnapshots += 1;
      return 'skipped';
    }
    this.socket.send(data);
    this.bytesOut += Buffer.byteLength(data);
    this.messagesOut += 1;
    return 'sent';
  }

  /** Returns false (and counts a drop) when the connection is over its message rate. */
  allowMessage(): boolean {
    if (this.bucket.tryTake()) return true;
    this.rateLimitDrops += 1;
    const t = this.now();
    if (t - this.dropWindowStart > this.config.rateLimitWindowMs) {
      this.dropWindowStart = t;
      this.dropsInWindow = 0;
    }
    this.dropsInWindow += 1;
    return false;
  }

  get rateLimitExceeded(): boolean {
    return this.dropsInWindow > this.config.rateLimitMaxDrops;
  }

  ping(): void {
    if (!this.closed && this.socket.readyState === OPEN) this.socket.ping();
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.socket.close(code, reason);
  }

  terminate(): void {
    this.socket.terminate();
  }
}
