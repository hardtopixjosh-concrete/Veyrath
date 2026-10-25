import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseServerMessage,
  type ClientMessage,
  type ErrorCode,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@veyrath/protocol';
import { DEFAULT_SIM_CONFIG, type PlayerInput } from '@veyrath/sim';
import { Ema, RollingRate } from '../metrics';
import { SnapshotBuffer } from './interpolation';
import { Predictor } from './prediction';
import type { Transport, TransportFactory } from './transport';

export type SessionPhase = 'idle' | 'connecting' | 'in_room' | 'reconnecting';

export interface SessionEvents {
  onPhase(phase: SessionPhase, detail: string): void;
  onWelcome(welcome: WelcomeMessage, rejoined: boolean): void;
  onSnapshot(snapshot: SnapshotMessage): void;
  onError(code: ErrorCode, message: string, fatal: boolean): void;
}

export interface InputSource {
  sample(): PlayerInput;
}

interface Credentials {
  url: string;
  room: string;
  playerId: string;
  token: string;
  graceMs: number;
}

/** Don't keep queueing inputs onto a socket that is not draining. */
const MAX_LOCAL_BUFFERED_BYTES = 16 * 1024;
const RECONNECT_RETRY_MS = 1000;
/**
 * The server sends ~30 snapshots a second, so this much silence means the connection is dead even
 * if the OS hasn't noticed (a dropped Wi-Fi or VPN link can leave a socket "open" for minutes).
 */
const SILENCE_TIMEOUT_MS = 4000;
/** First connect gets longer: the server may be slow to accept, and nothing streams yet. */
const CONNECT_TIMEOUT_MS = 8000;
/** Max inputs sent in one timer callback to catch up after a stalled main thread. */
const MAX_INPUT_CATCH_UP = 4;

/**
 * Client side of one game session: connect → create/join → send inputs at the tick rate → receive
 * snapshots. On an unexpected drop it automatically rejoins the same player slot for as long as the
 * server's grace period allows. All timers live here and are cleared on every phase exit.
 */
export class GameSession {
  phase: SessionPhase = 'idle';
  welcome: WelcomeMessage | null = null;
  lastSnapshot: SnapshotMessage | null = null;
  readonly predictor = new Predictor(DEFAULT_SIM_CONFIG);
  readonly snapshots = new SnapshotBuffer(DEFAULT_SIM_CONFIG.tickRate);
  readonly snapshotRate = new RollingRate();
  readonly rtt = new Ema(0.2);
  /** Mean absolute deviation of RTT samples. */
  readonly rttJitter = new Ema(0.2);
  /** Mean absolute deviation of snapshot inter-arrival time from the nominal interval. */
  readonly snapshotJitter = new Ema(0.05);
  /** Longest snapshot gap since the last stats report (or since joining). */
  maxSnapshotGapMs = 0;
  private lastSnapshotAt: number | null = null;
  reconnects = 0;

  private transport: Transport | null = null;
  private url = '';
  private credentials: Credentials | null = null;
  private seq = 0;
  private pingId = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeardAt = 0;
  private inputIntervalMs = 1000 / DEFAULT_SIM_CONFIG.tickRate;
  private nextInputAt = 0;
  private reconnectDeadline = 0;
  /** Byte counters survive reconnects so the overlay shows session totals. */
  private retiredBytes = { sent: 0, received: 0 };

  constructor(
    private readonly createTransport: TransportFactory,
    private readonly input: InputSource,
    private readonly events: SessionEvents,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get playerId(): string | null {
    return this.welcome?.playerId ?? null;
  }

  /** Total inputs sent this session (the last input sequence number). */
  get inputsSent(): number {
    return this.seq;
  }

  /** Milliseconds since the last snapshot arrived, or null before the first one. */
  get msSinceSnapshot(): number | null {
    return this.lastSnapshotAt === null ? null : this.now() - this.lastSnapshotAt;
  }

  get bytesSent(): number {
    return this.retiredBytes.sent + (this.transport?.stats.bytesSent ?? 0);
  }

  get bytesReceived(): number {
    return this.retiredBytes.received + (this.transport?.stats.bytesReceived ?? 0);
  }

  get bufferedAmount(): number {
    return this.transport?.stats.bufferedAmount ?? 0;
  }

  /** The server URL of the current (or last) connection attempt. */
  get serverUrl(): string {
    return this.url;
  }

  /** Reclaims a held player slot, e.g. after the game was closed and reopened within the grace time. */
  resume(url: string, room: string, playerId: string, token: string): void {
    this.begin(url, { t: 'rejoin', v: PROTOCOL_VERSION, room, playerId, token });
  }

  createRoom(url: string, name: string): void {
    this.begin(url, { t: 'create', v: PROTOCOL_VERSION, name });
  }

  joinRoom(url: string, name: string, room: string): void {
    this.begin(url, { t: 'join', v: PROTOCOL_VERSION, name, room });
  }

  /** Leave the room deliberately: the server frees the slot immediately (no rejoin). */
  leave(): void {
    if (this.transport?.isOpen && this.phase === 'in_room') {
      this.transport.send(encodeMessage({ t: 'leave' }));
    }
    this.shutdown('idle', 'Left the room');
  }

  /**
   * Sends this client's view of the connection to the server's metrics log, then starts a new
   * max-gap window. Diagnostic only.
   */
  sendStats(fps: number): void {
    if (this.phase !== 'in_room' || !this.transport?.isOpen) return;
    const round = (v: number | null): number => Math.min(1e6, Math.round((v ?? 0) * 10) / 10);
    this.transport.send(
      encodeMessage({
        t: 'stats',
        fps: round(fps),
        rttMs: round(this.rtt.value),
        rttJitterMs: round(this.rttJitter.value),
        snapshotsPerSec: round(this.snapshotRate.perSecond(this.now())),
        snapshotJitterMs: round(this.snapshotJitter.value),
        maxSnapshotGapMs: round(this.maxSnapshotGapMs),
        corrections: this.predictor.corrections,
        reconnects: this.reconnects,
      }),
    );
    this.maxSnapshotGapMs = 0;
  }

  /** Test hook: drop the socket as if the network failed, to exercise automatic rejoin. */
  simulateNetworkDrop(): void {
    this.transport?.close(4000, 'simulated network drop');
  }

  private begin(url: string, first: ClientMessage): void {
    this.shutdown('connecting', `Connecting to ${url}…`);
    this.credentials = null;
    this.url = url;
    this.open(url, first);
  }

  private open(url: string, first: ClientMessage): void {
    const transport = this.createTransport(url, {
      onOpen: () => transport.send(encodeMessage(first)),
      onMessage: (text) => {
        if (transport !== this.transport) return;
        this.lastHeardAt = this.now();
        this.handleMessage(text);
      },
      onClose: (code, reason) => this.handleClose(transport, code, reason),
    });
    this.transport = transport;
    this.lastHeardAt = this.now();
    if (!this.watchdogTimer) this.watchdogTimer = setInterval(() => this.checkSilence(), 1000);
  }

  /** Treats a silent connection as lost so the normal reconnect path runs without waiting for the OS. */
  private checkSilence(): void {
    const transport = this.transport;
    if (!transport) return;
    const limit = this.phase === 'connecting' ? CONNECT_TIMEOUT_MS : SILENCE_TIMEOUT_MS;
    if (this.now() - this.lastHeardAt < limit) return;
    this.transportLost(
      4000,
      this.phase === 'connecting' ? 'Server not reachable' : 'Server stopped responding',
    );
    transport.close(4000, 'no data from server');
  }

  private handleMessage(text: string): void {
    const msg = parseServerMessage(text);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome': {
        const rejoined = this.phase === 'reconnecting';
        if (rejoined) this.reconnects += 1;
        this.welcome = msg;
        this.credentials = {
          url: this.url,
          room: msg.room,
          playerId: msg.playerId,
          token: msg.token,
          graceMs: msg.reconnectGraceMs,
        };
        this.clearReconnectTimer();
        this.predictor.reset();
        this.snapshots.clear();
        this.lastSnapshotAt = null;
        this.setPhase('in_room', `In room ${msg.room}`);
        this.startTimers(msg.tickRate);
        this.events.onWelcome(msg, rejoined);
        return;
      }
      case 'snapshot': {
        if (this.phase !== 'in_room') return;
        const now = this.now();
        this.lastSnapshot = msg;
        this.snapshots.push(msg.world, now);
        this.snapshotRate.mark(now);
        if (this.lastSnapshotAt !== null) {
          const gap = now - this.lastSnapshotAt;
          const nominal = 1000 / (this.welcome?.snapshotRate ?? DEFAULT_SIM_CONFIG.tickRate);
          this.snapshotJitter.add(Math.abs(gap - nominal));
          if (gap > this.maxSnapshotGapMs) this.maxSnapshotGapMs = gap;
        }
        this.lastSnapshotAt = now;
        const me = msg.world.players.find((p) => p.id === this.playerId);
        if (me) this.predictor.reconcile(me.x, me.y, msg.ack, me.attackCooldown);
        this.events.onSnapshot(msg);
        return;
      }
      case 'pong': {
        const sample = this.now() - msg.clientTime;
        if (this.rtt.value !== null) this.rttJitter.add(Math.abs(sample - this.rtt.value));
        this.rtt.add(sample);
        return;
      }
      case 'left':
        return;
      case 'error': {
        this.events.onError(msg.code, msg.message, msg.fatal);
        if (this.phase === 'connecting') {
          this.shutdown('idle', msg.message);
        } else if (this.phase === 'reconnecting' && msg.code === 'rejoin_failed') {
          this.shutdown('idle', 'Could not rejoin: the slot was released');
        } else if (msg.fatal) {
          this.shutdown('idle', msg.message);
        }
        return;
      }
    }
  }

  private handleClose(transport: Transport, code: number, reason: string): void {
    if (transport !== this.transport) return; // an old socket we already replaced or abandoned
    this.transportLost(code, reason);
  }

  private transportLost(code: number, reason: string): void {
    const transport = this.transport;
    if (!transport) return;
    this.retire(transport);
    this.transport = null;
    this.stopTimers();
    const creds = this.credentials;
    if ((this.phase === 'in_room' || this.phase === 'reconnecting') && creds) {
      if (this.phase === 'in_room') this.reconnectDeadline = this.now() + creds.graceMs;
      if (this.now() >= this.reconnectDeadline) {
        this.shutdown('idle', 'Connection lost');
        return;
      }
      this.setPhase('reconnecting', `Connection lost (${code}). Reconnecting…`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.open(creds.url, {
          t: 'rejoin',
          v: PROTOCOL_VERSION,
          room: creds.room,
          playerId: creds.playerId,
          token: creds.token,
        });
      }, RECONNECT_RETRY_MS);
      return;
    }
    if (this.phase !== 'idle') {
      this.shutdown('idle', reason || `Disconnected (code ${code})`);
    }
  }

  private startTimers(tickRate: number): void {
    this.stopTimers();
    this.inputIntervalMs = 1000 / tickRate;
    this.nextInputAt = this.now();
    // Polled at twice the tick rate; pumpInputs keeps the send rate at exactly one per tick.
    this.inputTimer = setInterval(() => this.pumpInputs(), this.inputIntervalMs / 2);
    this.pingTimer = setInterval(() => this.sendPing(), 1000);
    this.sendPing();
  }

  private stopTimers(): void {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.inputTimer = null;
    this.pingTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * One input per elapsed tick interval. If the page's main thread stalled (slow frames), the
   * missed intervals are caught up (bounded) so a low-FPS player doesn't move in slow motion.
   */
  private pumpInputs(): void {
    const now = this.now();
    let sent = 0;
    while (now >= this.nextInputAt && sent < MAX_INPUT_CATCH_UP) {
      this.sendInput();
      this.nextInputAt += this.inputIntervalMs;
      sent += 1;
    }
    if (now - this.nextInputAt > this.inputIntervalMs * MAX_INPUT_CATCH_UP) {
      this.nextInputAt = now + this.inputIntervalMs;
    }
  }

  private sendInput(): void {
    const transport = this.transport;
    if (this.phase !== 'in_room' || !transport?.isOpen) return;
    if (transport.stats.bufferedAmount > MAX_LOCAL_BUFFERED_BYTES) return;
    const input = this.input.sample();
    const seq = ++this.seq;
    const sent = transport.send(
      encodeMessage({
        t: 'input',
        seq,
        moveX: input.moveX,
        moveY: input.moveY,
        attack: input.attack,
      }),
    );
    if (sent) this.predictor.applyLocal(seq, input, this.now());
  }

  private sendPing(): void {
    this.transport?.send(
      encodeMessage({ t: 'ping', id: this.pingId++ & 0x7fffffff, clientTime: this.now() }),
    );
  }

  private retire(transport: Transport): void {
    this.retiredBytes.sent += transport.stats.bytesSent;
    this.retiredBytes.received += transport.stats.bytesReceived;
  }

  private shutdown(phase: SessionPhase, detail: string): void {
    this.stopTimers();
    this.clearReconnectTimer();
    if (phase === 'idle' && this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      this.retire(transport);
      transport.close(1000, 'client closed');
    }
    if (phase === 'idle') {
      this.welcome = null;
      this.credentials = null;
      this.lastSnapshot = null;
      this.predictor.reset();
      this.snapshots.clear();
    }
    this.setPhase(phase, detail);
  }

  private setPhase(phase: SessionPhase, detail: string): void {
    this.phase = phase;
    this.events.onPhase(phase, detail);
  }
}
