import type { WorldSnapshot } from '@veyrath/sim';

// ---- client → server -------------------------------------------------------------------------

export interface CreateRoomMessage {
  t: 'create';
  v: number;
  name: string;
}

export interface JoinRoomMessage {
  t: 'join';
  v: number;
  name: string;
  room: string;
}

/** Reclaims a held slot after a dropped connection, within the server's reconnect grace period. */
export interface RejoinMessage {
  t: 'rejoin';
  v: number;
  room: string;
  playerId: string;
  token: string;
}

/** One tick of intent. `seq` must strictly increase for the lifetime of a player. */
export interface InputMessage {
  t: 'input';
  seq: number;
  moveX: number;
  moveY: number;
  attack: boolean;
}

export interface PingMessage {
  t: 'ping';
  id: number;
  /** Opaque to the server; echoed back so the client can compute RTT. */
  clientTime: number;
}

export interface LeaveMessage {
  t: 'leave';
}

/**
 * Periodic (every few seconds) client-side network/render measurements, logged by the server so a
 * remote test produces one metrics file with both ends' view. Purely diagnostic: never affects play.
 */
export interface ClientStatsMessage {
  t: 'stats';
  fps: number;
  rttMs: number;
  /** Mean absolute deviation of RTT samples. */
  rttJitterMs: number;
  snapshotsPerSec: number;
  /** Mean absolute deviation of snapshot inter-arrival time from the nominal interval. */
  snapshotJitterMs: number;
  /** Longest gap between two snapshots since the previous stats message. */
  maxSnapshotGapMs: number;
  corrections: number;
  reconnects: number;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | RejoinMessage
  | InputMessage
  | PingMessage
  | LeaveMessage
  | ClientStatsMessage;

// ---- server → client -------------------------------------------------------------------------

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  room: string;
  playerId: string;
  /** Secret for `rejoin`. Only ever sent to the owning client. */
  token: string;
  slot: number;
  tickRate: number;
  snapshotRate: number;
  reconnectGraceMs: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  /** Last input seq from the receiving player that the server has applied. */
  ack: number;
  /** Average server tick duration (ms) — for the debug overlay. */
  tickMs: number;
  world: WorldSnapshot;
}

export interface PongMessage {
  t: 'pong';
  id: number;
  clientTime: number;
  serverTime: number;
}

export interface LeftMessage {
  t: 'left';
}

export type ErrorCode =
  | 'version_mismatch'
  | 'bad_message'
  | 'room_not_found'
  | 'room_full'
  | 'server_full'
  | 'rejoin_failed'
  | 'already_in_room'
  | 'rate_limited'
  | 'handshake_timeout'
  | 'replaced'
  | 'server_shutdown';

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
  /** The server closes the connection after a fatal error. */
  fatal: boolean;
}

export type ServerMessage =
  WelcomeMessage | SnapshotMessage | PongMessage | LeftMessage | ErrorMessage;
