import { GameServer, type ServerConfig } from '@veyrath/game-server';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorMessage,
  type ServerMessage,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@veyrath/protocol';
import WebSocket from 'ws';

export async function startServer(
  overrides: Partial<ServerConfig> = {},
): Promise<{ server: GameServer; url: string }> {
  const server = new GameServer({ host: '127.0.0.1', port: 0, seed: 1234, ...overrides });
  const { port } = await server.start();
  return { server, url: `ws://127.0.0.1:${port}` };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Minimal scripted client over a real WebSocket. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;
  readonly closed: Promise<number>;
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      for (const l of [...this.listeners]) l();
    });
    this.closed = new Promise((resolve) => {
      ws.on('close', (code) => {
        this.closeCode = code;
        for (const l of [...this.listeners]) l();
        resolve(code);
      });
    });
  }

  static connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMessage | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  input(moveX: number, moveY: number, attack = false, seq = ++this.seq): number {
    this.seq = Math.max(this.seq, seq);
    this.send({ t: 'input', seq, moveX, moveY, attack });
    return seq;
  }

  /** Resolves with the first message matching `pred` received at or after `fromIndex`. */
  waitFor<T extends ServerMessage = ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 3000,
    fromIndex = this.messages.length,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let index = fromIndex;
      const check = (): void => {
        for (; index < this.messages.length; index++) {
          const m = this.messages[index]!;
          if (pred(m)) {
            cleanup();
            resolve(m as T);
            return;
          }
        }
        if (this.closeCode !== null) {
          cleanup();
          reject(new Error(`socket closed (${this.closeCode}) while waiting`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }

  snapshot(pred: (s: SnapshotMessage) => boolean = () => true, timeoutMs = 3000) {
    return this.waitFor<SnapshotMessage>((m) => m.t === 'snapshot' && pred(m), timeoutMs);
  }

  error(code?: ErrorMessage['code'], timeoutMs = 3000, fromIndex = 0) {
    return this.waitFor<ErrorMessage>(
      (m) => m.t === 'error' && (code === undefined || m.code === code),
      timeoutMs,
      fromIndex,
    );
  }

  async create(name = 'Alpha'): Promise<WelcomeMessage> {
    const wait = this.waitFor<WelcomeMessage>((m) => m.t === 'welcome' || m.t === 'error');
    this.send({ t: 'create', v: PROTOCOL_VERSION, name });
    const msg = await wait;
    if (msg.t !== 'welcome') throw new Error(`create failed: ${JSON.stringify(msg)}`);
    return msg;
  }

  async join(room: string, name = 'Bravo'): Promise<WelcomeMessage> {
    const wait = this.waitFor<WelcomeMessage>((m) => m.t === 'welcome' || m.t === 'error');
    this.send({ t: 'join', v: PROTOCOL_VERSION, name, room });
    const msg = await wait;
    if (msg.t !== 'welcome') throw new Error(`join failed: ${JSON.stringify(msg)}`);
    return msg;
  }

  snapshotsReceived(): SnapshotMessage[] {
    return this.messages.filter((m): m is SnapshotMessage => m.t === 'snapshot');
  }

  async close(): Promise<void> {
    if (this.closeCode === null) {
      this.ws.close();
      await this.closed;
    }
  }
}
