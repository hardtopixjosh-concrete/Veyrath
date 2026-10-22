import {
  LIMITS,
  PLAYER_ID_PATTERN,
  PLAYER_NAME_PATTERN,
  ROOM_CODE_PATTERN,
  TOKEN_PATTERN,
} from './constants';
import type { ClientMessage, ServerMessage } from './messages';

export type ParseResult<T> = { ok: true; msg: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

function isMeasure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && PLAYER_NAME_PATTERN.test(value);
}

function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
}

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function isValidPlayerName(value: unknown): value is string {
  return isName(value);
}

export function isValidRoomCode(value: unknown): value is string {
  return isRoomCode(value);
}

/**
 * Validates an untrusted client message. Returns a freshly built object containing only known
 * fields, so nothing unexpected from the wire ever reaches game code.
 */
export function parseClientMessage(
  raw: string,
  byteLength: number = utf8ByteLength(raw),
): ParseResult<ClientMessage> {
  if (byteLength > LIMITS.maxClientMessageBytes) return fail('message too large');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('invalid JSON');
  }
  if (!isRecord(data)) return fail('message must be an object');

  switch (data.t) {
    case 'input': {
      const { seq, moveX, moveY, attack } = data;
      if (!isInt(seq, 0, LIMITS.maxSeq)) return fail('input.seq must be a non-negative integer');
      if (!isAxis(moveX) || !isAxis(moveY)) return fail('input.move must be numbers in [-1, 1]');
      if (typeof attack !== 'boolean') return fail('input.attack must be a boolean');
      return { ok: true, msg: { t: 'input', seq, moveX, moveY, attack } };
    }
    case 'ping': {
      const { id, clientTime } = data;
      if (!isInt(id, 0, LIMITS.maxSeq)) return fail('ping.id must be a non-negative integer');
      if (typeof clientTime !== 'number' || !Number.isFinite(clientTime)) {
        return fail('ping.clientTime must be a finite number');
      }
      return { ok: true, msg: { t: 'ping', id, clientTime } };
    }
    case 'create': {
      const { v, name } = data;
      if (!isInt(v, 0, LIMITS.maxSeq)) return fail('create.v must be an integer');
      if (!isName(name)) return fail('create.name is invalid');
      return { ok: true, msg: { t: 'create', v, name } };
    }
    case 'join': {
      const { v, name, room } = data;
      if (!isInt(v, 0, LIMITS.maxSeq)) return fail('join.v must be an integer');
      if (!isName(name)) return fail('join.name is invalid');
      if (!isRoomCode(room)) return fail('join.room is invalid');
      return { ok: true, msg: { t: 'join', v, name, room } };
    }
    case 'rejoin': {
      const { v, room, playerId, token } = data;
      if (!isInt(v, 0, LIMITS.maxSeq)) return fail('rejoin.v must be an integer');
      if (!isRoomCode(room)) return fail('rejoin.room is invalid');
      if (typeof playerId !== 'string' || !PLAYER_ID_PATTERN.test(playerId)) {
        return fail('rejoin.playerId is invalid');
      }
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        return fail('rejoin.token is invalid');
      }
      return { ok: true, msg: { t: 'rejoin', v, room, playerId, token } };
    }
    case 'leave':
      return { ok: true, msg: { t: 'leave' } };
    case 'stats': {
      const { fps, rttMs, rttJitterMs, snapshotsPerSec, snapshotJitterMs, maxSnapshotGapMs } = data;
      const { corrections, reconnects } = data;
      const measures = [
        fps,
        rttMs,
        rttJitterMs,
        snapshotsPerSec,
        snapshotJitterMs,
        maxSnapshotGapMs,
      ];
      if (!measures.every(isMeasure)) return fail('stats values must be numbers in [0, 1e6]');
      if (!isInt(corrections, 0, LIMITS.maxSeq) || !isInt(reconnects, 0, LIMITS.maxSeq)) {
        return fail('stats counters must be non-negative integers');
      }
      return {
        ok: true,
        msg: {
          t: 'stats',
          fps: fps as number,
          rttMs: rttMs as number,
          rttJitterMs: rttJitterMs as number,
          snapshotsPerSec: snapshotsPerSec as number,
          snapshotJitterMs: snapshotJitterMs as number,
          maxSnapshotGapMs: maxSnapshotGapMs as number,
          corrections,
          reconnects,
        },
      };
    }
    default:
      return fail('unknown message type');
  }
}

const SERVER_TYPES = new Set(['welcome', 'snapshot', 'pong', 'left', 'error']);

/**
 * Light structural check for server messages. The server is trusted, but the client should never
 * crash on a malformed frame.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.t !== 'string' || !SERVER_TYPES.has(data.t)) return null;
  if (data.t === 'snapshot') {
    const world = data.world;
    if (!isRecord(world) || !Array.isArray(world.players) || !isRecord(world.enemy)) return null;
    if (typeof data.ack !== 'number' || typeof world.tick !== 'number') return null;
  }
  return data as unknown as ServerMessage;
}

export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
