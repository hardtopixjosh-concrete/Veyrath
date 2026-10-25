import { IDLE_INPUT } from '@veyrath/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession, type SessionPhase } from '../../packages/client/src/net/session';
import type { Transport, TransportHandlers } from '../../packages/client/src/net/transport';

/** A transport whose server side the test controls. It never closes by itself (like a dead VPN link). */
class FakeTransport implements Transport {
  sent: Record<string, unknown>[] = [];
  closed = false;
  isOpen = true;
  constructor(readonly handlers: TransportHandlers) {
    queueMicrotask(() => handlers.onOpen());
  }
  get stats() {
    return {
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
      bufferedAmount: 0,
    };
  }
  send(text: string): boolean {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }
  close(): void {
    this.closed = true;
    this.isOpen = false;
  }
  receive(msg: unknown): void {
    this.handlers.onMessage(JSON.stringify(msg));
  }
}

const welcome = (graceMs = 15000) => ({
  t: 'welcome',
  v: 2,
  room: 'ABCDE',
  playerId: 'p_00000001',
  token: '0'.repeat(32),
  slot: 0,
  tickRate: 30,
  snapshotRate: 30,
  reconnectGraceMs: graceMs,
});

let now = 0;
let transports: FakeTransport[] = [];
let phases: SessionPhase[] = [];

function makeSession(): GameSession {
  return new GameSession(
    (_url, handlers) => {
      const t = new FakeTransport(handlers);
      transports.push(t);
      return t;
    },
    { sample: () => IDLE_INPUT },
    {
      onPhase: (p) => phases.push(p),
      onWelcome: () => {},
      onSnapshot: () => {},
      onError: () => {},
    },
    () => now,
  );
}

async function advance(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    now += 100;
    await vi.advanceTimersByTimeAsync(100);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  transports = [];
  phases = [];
});
afterEach(() => vi.useRealTimers());

describe('GameSession silence watchdog', () => {
  it('treats a silent connection as lost and rejoins as the same player', async () => {
    const session = makeSession();
    session.createRoom('ws://test', 'Me');
    await advance(100);
    transports[0]!.receive(welcome());
    expect(session.phase).toBe('in_room');

    // The server goes quiet but the socket never closes.
    await advance(6500);
    expect(transports[0]!.closed).toBe(true);
    expect(phases).toContain('reconnecting');

    // The next attempt sends a rejoin with the held credentials and gets back in.
    expect(transports.length).toBe(2);
    expect(transports[1]!.sent[0]).toMatchObject({ t: 'rejoin', playerId: 'p_00000001' });
    transports[1]!.receive(welcome());
    expect(session.phase).toBe('in_room');
    expect(session.reconnects).toBe(1);
    expect(session.playerId).toBe('p_00000001');
  });

  it('keeps retrying while the network is down, then gives up after the grace period', async () => {
    const session = makeSession();
    session.joinRoom('ws://test', 'Me', 'ABCDE');
    await advance(100);
    transports[0]!.receive(welcome(10000));
    await advance(20000); // nothing ever answers
    expect(transports.length).toBeGreaterThanOrEqual(3);
    expect(session.phase).toBe('idle');
  });

  it('a live connection that keeps receiving snapshots is never dropped', async () => {
    const session = makeSession();
    session.createRoom('ws://test', 'Me');
    await advance(100);
    transports[0]!.receive(welcome());
    for (let i = 0; i < 100; i++) {
      await advance(100);
      transports[0]!.receive({
        t: 'snapshot',
        ack: 0,
        tickMs: 0,
        world: { tick: i, players: [], enemy: {} },
      });
    }
    expect(transports.length).toBe(1);
    expect(session.phase).toBe('in_room');
  });

  it('an unreachable server fails the first connect with a clear message', async () => {
    const session = makeSession();
    session.createRoom('ws://test', 'Me');
    await advance(9000);
    expect(session.phase).toBe('idle');
  });
});
