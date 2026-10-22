import type { SnapshotMessage } from '@veyrath/protocol';
import {
  DEFAULT_SIM_CONFIG,
  IDLE_INPUT,
  clampMoveVector,
  inAttackRange,
  type PlayerInput,
} from '@veyrath/sim';
import type { SmokeConfig } from './config';
import type { GameSession, InputSource } from './net/session';

/**
 * Automated two-client check. Each instance plays itself (walks to the enemy and attacks), records
 * what it observes, and reports a JSON summary that scripts/smoke-two-clients.mjs compares across
 * both clients. Only active when launched with a smoke config.
 */

export class Autopilot implements InputSource {
  constructor(private readonly session: GameSession) {}

  sample(): PlayerInput {
    const snap = this.session.lastSnapshot;
    const me = snap?.world.players.find((p) => p.id === this.session.playerId);
    if (!snap || !me) return IDLE_INPUT;
    const enemy = snap.world.enemy;
    if (!enemy.alive) return IDLE_INPUT;
    const config = DEFAULT_SIM_CONFIG;
    // Each slot approaches from a different side so players don't stack.
    const angle = Math.PI + (me.slot * 2 * Math.PI) / config.maxPlayers;
    const standoff = config.playerRadius + config.enemyRadius + config.attackReach * 0.5;
    const dx = enemy.x + Math.cos(angle) * standoff - me.x;
    const dy = enemy.y + Math.sin(angle) * standoff - me.y;
    const dist = Math.hypot(dx, dy);
    const move = dist < 8 ? { x: 0, y: 0 } : clampMoveVector(dx / dist, dy / dist);
    return {
      moveX: move.x,
      moveY: move.y,
      attack: inAttackRange(me.x, me.y, enemy.x, enemy.y, config),
    };
  }
}

interface OtherPlayer {
  firstX: number;
  firstY: number;
  maxDisplacement: number;
}

export class SmokeRecorder {
  private readonly startedAt = performance.now();
  private snapshots = 0;
  private lastSnapshotAt = 0;
  private maxSnapshotGapMs = 0;
  private readonly others = new Map<string, OtherPlayer>();
  private readonly hpByTick: Record<number, number> = {};
  private hpSamples = 0;
  private readonly hitters = new Set<string>();
  private readonly attackTicks = new Map<string, Set<number>>();
  /** [epoch second, snapshots received, highest tick] — compared against window minimize times. */
  private readonly timeline: [number, number, number][] = [];
  private frames = 0;
  private frameMsTotal = 0;
  private originalPlayerId: string | null = null;
  private room: string | null = null;
  private welcomes = 0;
  private droppedAt: number | null = null;
  private rejoinedSamePlayer: boolean | null = null;
  private left = false;
  private phaseLossesAfterJoin = 0;
  private inputWindowClosed = false;
  private inputWindow: { start: number; startSeq: number; end: number; endSeq: number } | null =
    null;
  private readonly errors: string[] = [];

  constructor(
    private readonly config: SmokeConfig,
    private readonly session: GameSession,
    private readonly report: (payload: unknown) => void,
  ) {}

  elapsed(): number {
    return performance.now() - this.startedAt;
  }

  onWelcome(playerId: string, room: string, rejoined: boolean): void {
    this.welcomes += 1;
    if (!this.originalPlayerId) {
      const t = this.elapsed();
      const seq = this.session.inputsSent;
      this.inputWindow = { start: t, startSeq: seq, end: t, endSeq: seq };
      this.originalPlayerId = playerId;
      this.room = room;
      this.report({ type: 'room', role: this.config.role, room, playerId });
    }
    if (rejoined) this.rejoinedSamePlayer = playerId === this.originalPlayerId;
  }

  onPhase(phase: string): void {
    if (this.originalPlayerId && !this.left && phase !== 'in_room') this.phaseLossesAfterJoin += 1;
  }

  onError(code: string, message: string): void {
    if (this.errors.length < 20) this.errors.push(`${code}: ${message}`);
  }

  onFrame(frameMs: number): void {
    this.frames += 1;
    this.frameMsTotal += frameMs;
  }

  onSnapshot(msg: SnapshotMessage): void {
    const now = performance.now();
    if (this.lastSnapshotAt)
      this.maxSnapshotGapMs = Math.max(this.maxSnapshotGapMs, now - this.lastSnapshotAt);
    this.lastSnapshotAt = now;
    this.snapshots += 1;

    const { world } = msg;
    const second = Math.floor(Date.now() / 1000);
    const last = this.timeline[this.timeline.length - 1];
    if (last && last[0] === second) {
      last[1] += 1;
      last[2] = world.tick;
    } else if (this.timeline.length < 600) {
      this.timeline.push([second, 1, world.tick]);
    }

    if (this.hpSamples < 4000) {
      this.hpByTick[world.tick] = world.enemy.hp;
      this.hpSamples += 1;
    }
    if (world.enemy.lastHitBy) this.hitters.add(world.enemy.lastHitBy);

    for (const p of world.players) {
      if (p.lastAttackTick >= 0) {
        let set = this.attackTicks.get(p.id);
        if (!set) this.attackTicks.set(p.id, (set = new Set()));
        if (set.size < 1000) set.add(p.lastAttackTick);
      }
      if (p.id === this.session.playerId) continue;
      const o = this.others.get(p.id);
      if (!o) {
        this.others.set(p.id, { firstX: p.x, firstY: p.y, maxDisplacement: 0 });
      } else {
        o.maxDisplacement = Math.max(o.maxDisplacement, Math.hypot(p.x - o.firstX, p.y - o.firstY));
      }
    }
  }

  markDropped(): void {
    this.closeInputWindow();
    this.droppedAt = this.elapsed();
  }

  markLeft(): void {
    this.closeInputWindow();
    this.left = true;
  }

  /** Freezes the input-rate window (at the first drop, leave, or finish — whichever is first). */
  private closeInputWindow(): void {
    if (this.inputWindow && !this.inputWindowClosed) {
      this.inputWindowClosed = true;
      this.inputWindow.end = this.elapsed();
      this.inputWindow.endSeq = this.session.inputsSent;
    }
  }

  finish(): void {
    this.closeInputWindow();
    const w = this.inputWindow;
    const inputsPerSecond =
      w && w.end > w.start
        ? Math.round(((w.endSeq - w.startSeq) * 10000) / (w.end - w.start)) / 10
        : 0;
    const world = this.session.lastSnapshot?.world;
    this.report({
      type: 'final',
      role: this.config.role,
      room: this.room,
      playerId: this.originalPlayerId,
      phaseAtEnd: this.session.phase,
      elapsedMs: Math.round(this.elapsed()),
      snapshots: this.snapshots,
      maxSnapshotGapMs: Math.round(this.maxSnapshotGapMs),
      inputsPerSecond,
      rttMs: Math.round((this.session.rtt.value ?? 0) * 10) / 10,
      rttJitterMs: Math.round((this.session.rttJitter.value ?? 0) * 10) / 10,
      snapshotJitterMs: Math.round((this.session.snapshotJitter.value ?? 0) * 10) / 10,
      corrections: this.session.predictor.corrections,
      avgFps: this.frames ? Math.round((1000 * this.frames) / this.frameMsTotal) : 0,
      welcomes: this.welcomes,
      reconnects: this.session.reconnects,
      droppedAtMs: this.droppedAt === null ? null : Math.round(this.droppedAt),
      rejoinedSamePlayer: this.rejoinedSamePlayer,
      left: this.left,
      phaseLossesAfterJoin: this.phaseLossesAfterJoin,
      playersAtEnd: world?.players.length ?? null,
      otherPlayers: Object.fromEntries(
        [...this.others].map(([id, o]) => [id, Math.round(o.maxDisplacement)]),
      ),
      enemyHitBy: [...this.hitters],
      attackCounts: Object.fromEntries([...this.attackTicks].map(([id, s]) => [id, s.size])),
      hpByTick: this.hpByTick,
      timeline: this.timeline,
      errors: this.errors,
    });
  }
}

/** Drives the scripted session timeline for one smoke client. */
export function runSmokeScript(
  config: SmokeConfig,
  session: GameSession,
  recorder: SmokeRecorder,
  serverUrl: string,
): void {
  if (config.role === 'host') {
    session.createRoom(serverUrl, 'Host');
  } else if (config.room) {
    session.joinRoom(serverUrl, 'Joiner', config.room);
  } else {
    recorder.onError('smoke', 'join role needs a room code');
    recorder.finish();
    return;
  }

  if (config.dropAtMs !== null) {
    setTimeout(() => {
      recorder.markDropped();
      session.simulateNetworkDrop();
    }, config.dropAtMs);
  }
  if (config.leaveAtMs !== null) {
    setTimeout(() => {
      recorder.markLeft();
      session.leave();
    }, config.leaveAtMs);
  }
  setTimeout(() => {
    recorder.finish();
    // Leave after reporting so the server frees the slot instead of holding it for rejoin.
    if (session.phase === 'in_room') {
      recorder.markLeft();
      session.leave();
    }
  }, config.durationMs);
}
