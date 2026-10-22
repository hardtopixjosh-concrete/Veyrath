import { isLogLevel, type LogLevel } from './logger';

export interface ServerConfig {
  host: string;
  /** 0 picks a free port (used by tests). */
  port: number;
  /** Send a snapshot every N ticks. */
  snapshotEveryTicks: number;
  /** How long a dropped player's slot is held for `rejoin`. */
  reconnectGraceMs: number;
  /** A connection must create/join/rejoin a room within this time, or after leaving one. */
  lobbyTimeoutMs: number;
  maxConnections: number;
  maxRooms: number;
  /** Per-player queued inputs. Older inputs are dropped beyond this. */
  inputQueueSize: number;
  /** Token bucket shared by all messages from one connection. */
  rateLimitBurst: number;
  rateLimitPerSecond: number;
  /** Close the connection if more than this many messages are dropped for rate within the window. */
  rateLimitMaxDrops: number;
  rateLimitWindowMs: number;
  /** Close the connection after this many invalid messages. */
  maxInvalidMessages: number;
  /** Skip (coalesce) snapshots for a connection whose unsent buffer exceeds this. */
  snapshotSkipBufferedBytes: number;
  /** Terminate a connection whose unsent buffer exceeds this. */
  maxBufferedBytes: number;
  heartbeatIntervalMs: number;
  statsIntervalMs: number;
  logLevel: LogLevel;
  /** JSON-lines metrics output (events, server stats, client-reported stats); off when undefined. */
  metricsFile: string | undefined;
  /** Folder of client update files (latest.yml + installer) served at /updates/; off when undefined. */
  updatesDir: string | undefined;
  /** Fixed base seed for reproducible rooms; random when undefined. */
  seed: number | undefined;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = Object.freeze({
  host: '127.0.0.1',
  port: 7777,
  snapshotEveryTicks: 1,
  reconnectGraceMs: 15_000,
  lobbyTimeoutMs: 30_000,
  maxConnections: 256,
  maxRooms: 64,
  inputQueueSize: 8,
  rateLimitBurst: 90,
  rateLimitPerSecond: 60,
  rateLimitMaxDrops: 120,
  rateLimitWindowMs: 5_000,
  maxInvalidMessages: 20,
  snapshotSkipBufferedBytes: 64 * 1024,
  maxBufferedBytes: 1024 * 1024,
  heartbeatIntervalMs: 5_000,
  statsIntervalMs: 10_000,
  logLevel: 'info',
  metricsFile: undefined,
  updatesDir: undefined,
  seed: undefined,
});

function intFromEnv(value: string | undefined, name: string, min: number, max: number) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got "${value}"`);
  }
  return n;
}

export function configFromEnv(env: Record<string, string | undefined>): ServerConfig {
  const config: ServerConfig = { ...DEFAULT_SERVER_CONFIG };
  if (env.VEYRATH_HOST) config.host = env.VEYRATH_HOST;
  config.port = intFromEnv(env.VEYRATH_PORT, 'VEYRATH_PORT', 0, 65535) ?? config.port;
  config.reconnectGraceMs =
    intFromEnv(env.VEYRATH_RECONNECT_GRACE_MS, 'VEYRATH_RECONNECT_GRACE_MS', 0, 600_000) ??
    config.reconnectGraceMs;
  config.snapshotEveryTicks =
    intFromEnv(env.VEYRATH_SNAPSHOT_EVERY_TICKS, 'VEYRATH_SNAPSHOT_EVERY_TICKS', 1, 30) ??
    config.snapshotEveryTicks;
  config.seed = intFromEnv(env.VEYRATH_SEED, 'VEYRATH_SEED', 0, 0xffffffff) ?? config.seed;
  if (env.VEYRATH_METRICS_FILE) config.metricsFile = env.VEYRATH_METRICS_FILE;
  if (env.VEYRATH_UPDATES_DIR) config.updatesDir = env.VEYRATH_UPDATES_DIR;
  if (env.VEYRATH_LOG_LEVEL) {
    if (!isLogLevel(env.VEYRATH_LOG_LEVEL)) {
      throw new Error(`VEYRATH_LOG_LEVEL must be debug|info|warn|error|silent`);
    }
    config.logLevel = env.VEYRATH_LOG_LEVEL;
  }
  return config;
}
