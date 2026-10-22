import type { SimConfig } from './config';

/** One tick of player intent. The server applies at most one of these per player per tick. */
export interface PlayerInput {
  /** -1..1, right is positive. */
  readonly moveX: number;
  /** -1..1, down is positive. */
  readonly moveY: number;
  readonly attack: boolean;
}

export const IDLE_INPUT: PlayerInput = Object.freeze({ moveX: 0, moveY: 0, attack: false });

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly slot: number;
  x: number;
  y: number;
  connected: boolean;
  attackCooldown: number;
  /** Tick on which this player last swung, or -1. */
  lastAttackTick: number;
}

export interface EnemyState {
  readonly id: string;
  x: number;
  y: number;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  respawnTick: number;
  targetX: number;
  targetY: number;
  retargetTick: number;
  lastHitTick: number;
  lastHitBy: string | null;
}

export interface World {
  readonly config: SimConfig;
  readonly seed: number;
  tick: number;
  rngState: number;
  /** Always sorted by slot so iteration order (and therefore the result) is deterministic. */
  players: PlayerState[];
  enemy: EnemyState;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  slot: number;
  x: number;
  y: number;
  connected: boolean;
  lastAttackTick: number;
  attackCooldown: number;
}

export interface EnemySnapshot {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  lastHitTick: number;
  lastHitBy: string | null;
}

/** Full, self-contained world state as sent to clients. */
export interface WorldSnapshot {
  tick: number;
  players: PlayerSnapshot[];
  enemy: EnemySnapshot;
}

export interface HitEvent {
  tick: number;
  playerId: string;
  damage: number;
  hpAfter: number;
  killed: boolean;
}

export interface StepResult {
  hits: HitEvent[];
}
