import { isValidRoomCode } from '@veyrath/protocol';

export interface SmokeConfig {
  role: 'host' | 'join';
  /** Room to join (join role only). */
  room: string | null;
  durationMs: number;
  /** Join role: simulate a network drop at this time (ms after start), or never. */
  dropAtMs: number | null;
  /** Join role: leave the room at this time (ms after start), or never. */
  leaveAtMs: number | null;
}

export interface ClientConfig {
  serverUrl: string;
  instance: number;
  appVersion: string;
  /** Artificial per-frame busy-wait (ms) to emulate a slow renderer. 0 = off. */
  renderDelayMs: number;
  smoke: SmokeConfig | null;
}

/** The narrow API the Electron preload exposes. Absent when running in a plain browser. */
export interface VeyrathBridge {
  getConfig(): Promise<ClientConfig>;
  smokeReport(report: unknown): void;
}

declare global {
  interface Window {
    veyrath?: VeyrathBridge;
  }
}

const DEFAULT_SERVER_URL = 'ws://127.0.0.1:7777';

function intParam(params: URLSearchParams, key: string, fallback: number): number {
  const n = Number(params.get(key));
  return params.has(key) && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Browser/dev mode: read the same options from the page URL. */
function configFromUrl(search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const role = params.get('smoke');
  const room = params.get('room');
  return {
    serverUrl: params.get('server') ?? DEFAULT_SERVER_URL,
    instance: intParam(params, 'instance', 1),
    appVersion: 'dev-web',
    renderDelayMs: intParam(params, 'renderDelay', 0),
    smoke:
      role === 'host' || role === 'join'
        ? {
            role,
            room: isValidRoomCode(room) ? room : null,
            durationMs: intParam(params, 'duration', 15000),
            dropAtMs: params.has('dropAt') ? intParam(params, 'dropAt', 0) : null,
            leaveAtMs: params.has('leaveAt') ? intParam(params, 'leaveAt', 0) : null,
          }
        : null,
  };
}

export async function loadClientConfig(): Promise<ClientConfig> {
  if (window.veyrath) return window.veyrath.getConfig();
  return configFromUrl(window.location.search);
}
