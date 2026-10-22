/** Bump on any incompatible wire change. Client and server must match exactly. */
export const PROTOCOL_VERSION = 2;

export const LIMITS = Object.freeze({
  /** Hard cap on any client→server message (enforced by the socket and again by the parser). */
  maxClientMessageBytes: 1024,
  maxPlayersPerRoom: 5,
  maxNameLength: 16,
  roomCodeLength: 5,
  /** Input sequence numbers are non-negative 31-bit integers. */
  maxSeq: 0x7fffffff,
});

/** Unambiguous characters only (no 0/O, 1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
export const PLAYER_NAME_PATTERN = /^[\p{L}\p{N} _.-]{1,16}$/u;
export const PLAYER_ID_PATTERN = /^p_[0-9a-f]{8}$/;
export const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** WebSocket close codes used by the server (4000–4999 is the application range). */
export const CLOSE_CODES = Object.freeze({
  versionMismatch: 4001,
  badMessage: 4002,
  handshakeTimeout: 4008,
  replaced: 4009,
  rateLimited: 4029,
  slowConsumer: 4030,
});
