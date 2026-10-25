import type { GameServer } from '@veyrath/game-server';
import { CLOSE_CODES, LIMITS, PROTOCOL_VERSION } from '@veyrath/protocol';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { TestClient, sleep, startServer } from '../helpers/net';

let server: GameServer | null = null;
const clients: TestClient[] = [];

async function connect(url: string): Promise<TestClient> {
  const c = await TestClient.connect(url);
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.stop();
  server = null;
});

describe('bounded and rejected input', () => {
  it('oversized frames are refused at the socket and the server keeps running', async () => {
    const s = await startServer();
    server = s.server;
    const c = await connect(s.url);
    await c.create();
    c.send('x'.repeat(LIMITS.maxClientMessageBytes + 1));
    expect(await c.closed).toBe(1009); // "message too big"
    const other = await connect(s.url);
    await other.create();
    expect(s.server.isRunning).toBe(true);
  });

  it('repeated invalid messages get a few errors, then the connection is closed', async () => {
    const s = await startServer({ maxInvalidMessages: 10 });
    server = s.server;
    const c = await connect(s.url);
    for (let i = 0; i < 15; i++)
      c.send(i % 2 ? '{not json' : JSON.stringify({ t: 'input', seq: -5 }));
    expect(await c.closed).toBe(CLOSE_CODES.badMessage);
    const errors = c.messages.filter((m) => m.t === 'error');
    expect(errors.length).toBeLessThanOrEqual(4); // replies are capped too
    expect(s.server.getStats().totals.invalidMessages).toBeGreaterThan(10);
  });

  it('binary frames are rejected as invalid', async () => {
    const s = await startServer();
    server = s.server;
    const c = await connect(s.url);
    c.ws.send(Buffer.from([1, 2, 3]));
    await c.error('bad_message');
  });

  it('input spam is rate limited, the queue stays bounded, and sustained abuse disconnects', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const { room } = await a.create();
    let maxQueued = 0;
    for (let seq = 1; seq <= 600; seq++) {
      a.input(1, 0, false, seq);
      if (seq % 50 === 0) {
        await sleep(1);
        maxQueued = Math.max(maxQueued, s.server.debugCounts().queuedInputs);
      }
    }
    expect(await a.closed).toBe(CLOSE_CODES.rateLimited);
    expect(maxQueued).toBeLessThanOrEqual(s.server.config.inputQueueSize);
    const stats = s.server.getStats();
    expect(stats.totals.rateLimitDrops).toBeGreaterThan(s.server.config.rateLimitMaxDrops);
    // The player is held for rejoin, not crashed; the room still exists.
    expect(s.server.getRoom(room)).toBeDefined();
  });

  it('a well-behaved 30 Hz client is never rate limited', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    await a.create();
    for (let i = 0; i < 60; i++) {
      a.input(0.5, 0);
      if (i % 30 === 0) a.send({ t: 'ping', id: i, clientTime: i });
      await sleep(33);
    }
    expect(s.server.getStats().totals.rateLimitDrops).toBe(0);
    expect(a.closeCode).toBeNull();
  });

  it('duplicate and out-of-order inputs are ignored; ack never goes backwards', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const wa = await a.create();
    const start = (await a.snapshot()).world.players[0]!.x;

    a.input(1, 0, false, 10);
    a.input(1, 0, false, 10); // duplicate
    a.input(1, 0, false, 7); // out of order
    a.input(1, 0, false, 11);
    const snap = await a.snapshot((m) => m.ack === 11);
    // Exactly two inputs applied.
    const step = 220 / 30;
    const me = snap.world.players.find((p) => p.id === wa.playerId)!;
    expect(me.x).toBeCloseTo(start + 2 * step, 1);
    expect(s.server.getStats().totals.rejectedInputs).toBe(2);

    const acks = a.snapshotsReceived().map((m) => m.ack);
    for (let i = 1; i < acks.length; i++) expect(acks[i]!).toBeGreaterThanOrEqual(acks[i - 1]!);
  });

  it('input before joining a room is ignored without crashing', async () => {
    const s = await startServer();
    server = s.server;
    const c = await connect(s.url);
    c.input(1, 1, true, 1);
    c.send({ t: 'leave' });
    await sleep(100);
    expect(c.closeCode).toBeNull();
    expect(s.server.getStats().totals.rejectedInputs).toBe(1);
  });
});

describe('server behavior when clients stop rendering or reading', () => {
  async function measureTicks(server: GameServer, ms: number): Promise<number> {
    const before = server.getStats().ticks;
    await sleep(ms);
    return server.getStats().ticks - before;
  }

  it('keeps ticking at full rate when a client stops sending input (e.g. frozen or minimized)', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    const wb = await b.join(wa.room);
    const first = await a.snapshot((m) => m.world.players.length === 2);
    const aStart = first.world.players.find((p) => p.id === wa.playerId)!;

    // A goes silent. B keeps playing.
    const moving = (async () => {
      for (let i = 0; i < 45; i++) {
        b.input(0, 1);
        await sleep(33);
      }
    })();
    const ticks = await measureTicks(s.server, 1500);
    await moving;

    expect(ticks).toBeGreaterThanOrEqual(40); // ~45 expected at 30 Hz
    const last = a.snapshotsReceived().at(-1)!;
    const aNow = last.world.players.find((p) => p.id === wa.playerId)!;
    const bNow = last.world.players.find((p) => p.id === wb.playerId)!;
    expect({ x: aNow.x, y: aNow.y }).toEqual({ x: aStart.x, y: aStart.y });
    expect(bNow.y).toBeGreaterThan(first.world.players.find((p) => p.id === wb.playerId)!.y + 100);
  });

  it('a client that stops reading its socket does not slow the server or other players', async () => {
    const s = await startServer({ snapshotSkipBufferedBytes: 16 * 1024 });
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    await b.join(wa.room);
    await a.snapshot((m) => m.world.players.length === 2);

    // Stop reading on B's TCP socket: its data piles up in kernel + server buffers.
    const bSocket = (b.ws as unknown as { _socket: Socket })._socket;
    bSocket.pause();
    const aBefore = a.snapshotsReceived().length;
    const ticks = await measureTicks(s.server, 2000);
    const aReceived = a.snapshotsReceived().length - aBefore;
    bSocket.resume();

    expect(ticks).toBeGreaterThanOrEqual(55); // ~60 expected
    expect(aReceived).toBeGreaterThanOrEqual(50);
    expect(s.server.getStats().avgTickMs).toBeLessThan(5);
    // Whatever B's backlog is, it is bounded by the hard limit (or B was cut off).
    const room = s.server.getRoom(wa.room)!;
    for (const m of room.members.values()) {
      if (m.conn)
        expect(m.conn.bufferedAmount).toBeLessThanOrEqual(s.server.config.maxBufferedBytes);
    }
  });

  it('dead peers that stop answering heartbeats are terminated and held for rejoin', async () => {
    const s = await startServer({
      heartbeatIntervalMs: 150,
      deadPeerTimeoutMs: 400,
      reconnectGraceMs: 10_000,
    });
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    const wb = await b.join(wa.room);
    // Simulate a vanished peer: B's socket stops processing (no pong replies).
    (b.ws as unknown as { _socket: Socket })._socket.pause();
    await a.snapshot(
      (m) => m.world.players.some((p) => p.id === wb.playerId && !p.connected),
      3000,
    );
    expect(s.server.getRoom(wa.room)!.members.has(wb.playerId)).toBe(true);
    expect(a.closeCode).toBeNull();
  });

  it('server-full and connection limits reject cleanly', async () => {
    const s = await startServer({ maxRooms: 1, maxConnections: 2 });
    server = s.server;
    const a = await connect(s.url);
    await a.create();
    const b = await connect(s.url);
    b.send({ t: 'create', v: PROTOCOL_VERSION, name: 'B' });
    await b.error('server_full');
    const c = await connect(s.url);
    expect(await c.closed).toBe(1013);
  });
});
