/**
 * Command-line options for the desktop app. Everything is validated here so the renderer only ever
 * receives well-formed values.
 */
export interface LaunchOptions {
  serverUrl: string;
  instance: number;
  renderDelayMs: number;
  devtools: boolean;
  smoke: {
    role: 'host' | 'join';
    room: string | null;
    durationMs: number;
    dropAtMs: number | null;
    leaveAtMs: number | null;
    /** Main process minimizes the window at this time for `minimizeForMs`. */
    minimizeAtMs: number | null;
    minimizeForMs: number;
    /** Save a PNG of the window next to the report file at this time. */
    screenshotAtMs: number | null;
    /** JSON-lines report file. */
    outFile: string | null;
  } | null;
}

const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

function readArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(arg);
    if (match) args.set(match[1]!, match[2] ?? 'true');
  }
  return args;
}

function intArg(args: Map<string, string>, key: string, min: number, max: number): number | null {
  const raw = args.get(key);
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${key} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function serverUrlArg(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return url.href.replace(/\/$/, '');
  } catch {
    // fall through
  }
  throw new Error(`server URL must be ws:// or wss://, got "${value}"`);
}

export function parseLaunchOptions(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchOptions {
  const args = readArgs(argv);
  const role = args.get('smoke');
  if (role !== undefined && role !== 'host' && role !== 'join') {
    throw new Error('--smoke must be host or join');
  }
  const room = args.get('room') ?? null;
  if (room !== null && !ROOM_CODE.test(room)) throw new Error('--room is not a valid room code');

  return {
    serverUrl:
      serverUrlArg(args.get('server')) ??
      serverUrlArg(env.VEYRATH_SERVER_URL) ??
      'ws://127.0.0.1:7777',
    instance: intArg(args, 'instance', 1, 9) ?? 1,
    renderDelayMs: intArg(args, 'render-delay', 0, 200) ?? 0,
    devtools: args.has('devtools'),
    smoke: role
      ? {
          role,
          room,
          durationMs: intArg(args, 'smoke-duration', 1000, 300_000) ?? 20_000,
          dropAtMs: intArg(args, 'drop-at', 0, 300_000),
          leaveAtMs: intArg(args, 'leave-at', 0, 300_000),
          minimizeAtMs: intArg(args, 'minimize-at', 0, 300_000),
          minimizeForMs: intArg(args, 'minimize-for', 0, 300_000) ?? 4000,
          screenshotAtMs: intArg(args, 'screenshot-at', 0, 300_000),
          outFile: args.get('smoke-out') ?? null,
        }
      : null,
  };
}
