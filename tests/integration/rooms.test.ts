import type { GameServer } from '@veyrath/game-server';
import { CLOSE_CODES, PROTOCOL_VERSION } from '@veyrath/protocol';
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
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await server?.stop();
  server = null;
});

describe('two clients, one authoritative world', () => {
  it('both players see each other and each other’s movement', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create('Alpha');
    const wb = await b.join(wa.room, 'Bravo');
    expect(wa.playerId).not.toBe(wb.playerId);
    expect(wb.slot).toBe(1);

    const both = (await a.snapshot((m) => m.world.players.length === 2)).world.players;
    const bStart = both.find((p) => p.id === wb.playerId)!;

    for (let i = 0; i < 15; i++) b.input(1, 0);
    const moved = await a.snapshot((m) => {
      const pb = m.world.players.find((p) => p.id === wb.playerId);
      return !!pb && pb.x > bStart.x + 50;
    });
    // A did not move; B moved right by roughly 15 ticks of speed.
    const pa = moved.world.players.find((p) => p.id === wa.playerId)!;
    expect(pa.x).toBe(both.find((p) => p.id === wa.playerId)!.x);

    // B sees the exact same authoritative position for itself at the same tick.
    const fromB = await b.snapshot((m) => m.world.tick >= moved.world.tick);
    const aAtTick = a.snapshotsReceived().find((m) => m.world.tick === fromB.world.tick);
    if (aAtTick) expect(fromB.world.players).toEqual(aAtTick.world.players);
  });

  it('both players attack the same enemy and both clients see the same HP', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    const wb = await b.join(wa.room);
    await a.snapshot((m) => m.world.players.length === 2);

    // Test-only setup: put both players next to the enemy (server-side state).
    const world = s.server.getRoom(wa.room)!.world;
    for (const p of world.players) {
      p.x = world.enemy.x - 30;
      p.y = world.enemy.y + (p.slot === 0 ? -10 : 10);
    }
    const startHp = world.enemy.hp;
    a.input(0, 0, true);
    b.input(0, 0, true);

    const hit = (hp: number) => (m: { world: { enemy: { hp: number } } }) =>
      m.world.enemy.hp === hp;
    const expected = startHp - 20;
    const sa = await a.snapshot(hit(expected));
    const sb = await b.snapshot(hit(expected));
    expect(sa.world.tick).toBe(sb.world.tick);
    expect(sa.world.enemy).toEqual(sb.world.enemy);
    // Both swings were registered by the server (they may land on the same or adjacent ticks).
    for (const p of sa.world.players) expect(p.lastAttackTick).toBeGreaterThan(0);
    expect([wa.playerId, wb.playerId]).toContain(sa.world.enemy.lastHitBy);

    // Every snapshot both clients received for the same tick has the same HP.
    await sleep(200);
    const hpA = new Map(a.snapshotsReceived().map((m) => [m.world.tick, m.world.enemy.hp]));
    let compared = 0;
    for (const m of b.snapshotsReceived()) {
      if (hpA.has(m.world.tick)) {
        expect(m.world.enemy.hp).toBe(hpA.get(m.world.tick));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5);
  });

  it('a client cannot set its own HP, position, or damage — only intent is accepted', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const wa = await a.create();
    const before = await a.snapshot();
    a.send(
      JSON.stringify({ t: 'input', seq: 1, moveX: 0, moveY: 0, attack: false, x: 999, hp: 0 }),
    );
    a.send(JSON.stringify({ t: 'damage', target: 'enemy-1', amount: 100 }));
    const after = await a.snapshot((m) => m.ack >= 1);
    const me = after.world.players.find((p) => p.id === wa.playerId)!;
    expect(me.x).toBe(before.world.players[0]!.x);
    expect(after.world.enemy.hp).toBe(before.world.enemy.hp);
  });
});

describe('room membership', () => {
  it('fills to five players and rejects the sixth', async () => {
    const s = await startServer();
    server = s.server;
    const host = await connect(s.url);
    const { room } = await host.create('P0');
    for (let i = 1; i < 5; i++) await (await connect(s.url)).join(room, `P${i}`);
    const sixth = await connect(s.url);
    sixth.send({ t: 'join', v: PROTOCOL_VERSION, name: 'P5', room });
    const err = await sixth.error('room_full');
    expect(err.fatal).toBe(false);
    expect(s.server.getRoom(room)!.size).toBe(5);
  });

  it('unknown room code is a non-fatal error', async () => {
    const s = await startServer();
    server = s.server;
    const c = await connect(s.url);
    c.send({ t: 'join', v: PROTOCOL_VERSION, name: 'X', room: 'ZZZZZ' });
    await c.error('room_not_found');
    expect(c.closeCode).toBeNull();
  });

  it('protocol version mismatch is rejected cleanly and the server keeps serving', async () => {
    const s = await startServer();
    server = s.server;
    const old = await connect(s.url);
    old.send({ t: 'create', v: PROTOCOL_VERSION + 1, name: 'Old' });
    const err = await old.error('version_mismatch');
    expect(err.fatal).toBe(true);
    expect(await old.closed).toBe(CLOSE_CODES.versionMismatch);
    expect(s.server.getStats().rooms).toBe(0);

    const fresh = await connect(s.url);
    await fresh.create();
    expect(s.server.getStats().rooms).toBe(1);
  });
});

describe('disconnect, rejoin and leave semantics', () => {
  it('a dropped player keeps their slot for the grace period and can rejoin as the same player', async () => {
    const s = await startServer({ reconnectGraceMs: 3000 });
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    const wb = await b.join(wa.room);

    b.ws.terminate(); // abrupt network loss
    await a.snapshot((m) => m.world.players.some((p) => p.id === wb.playerId && !p.connected));
    expect(a.closeCode).toBeNull(); // the other player is unaffected

    const b2 = await connect(s.url);
    const wait = b2.waitFor((m) => m.t === 'welcome');
    b2.send({
      t: 'rejoin',
      v: PROTOCOL_VERSION,
      room: wb.room,
      playerId: wb.playerId,
      token: wb.token,
    });
    const welcome = await wait;
    expect(welcome).toMatchObject({ playerId: wb.playerId, slot: wb.slot, room: wb.room });
    await a.snapshot((m) => m.world.players.some((p) => p.id === wb.playerId && p.connected));
  });

  it('after the grace period the slot is released and rejoin fails', async () => {
    const s = await startServer({ reconnectGraceMs: 300 });
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    const wb = await b.join(wa.room);
    await b.close();
    await a.snapshot((m) => m.world.players.length === 1, 2000);

    const b2 = await connect(s.url);
    b2.send({
      t: 'rejoin',
      v: PROTOCOL_VERSION,
      room: wb.room,
      playerId: wb.playerId,
      token: wb.token,
    });
    await b2.error('rejoin_failed');
  });

  it('rejoin with a wrong token is refused', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const wa = await a.create();
    const thief = await connect(s.url);
    thief.send({
      t: 'rejoin',
      v: PROTOCOL_VERSION,
      room: wa.room,
      playerId: wa.playerId,
      token: 'f'.repeat(32),
    });
    await thief.error('rejoin_failed');
    expect(a.closeCode).toBeNull();
  });

  it('a rejoin replaces a still-open stale connection for the same player', async () => {
    const s = await startServer();
    server = s.server;
    const a = await connect(s.url);
    const wa = await a.create();
    const a2 = await connect(s.url);
    a2.send({
      t: 'rejoin',
      v: PROTOCOL_VERSION,
      room: wa.room,
      playerId: wa.playerId,
      token: wa.token,
    });
    await a2.waitFor((m) => m.t === 'welcome');
    await a.error('replaced');
    expect(await a.closed).toBe(CLOSE_CODES.replaced);
    expect(s.server.getRoom(wa.room)!.size).toBe(1);
  });

  it('leave frees the slot immediately; the last player leaving closes the room', async () => {
    const s = await startServer({ reconnectGraceMs: 60_000 });
    server = s.server;
    const a = await connect(s.url);
    const b = await connect(s.url);
    const wa = await a.create();
    await b.join(wa.room);
    b.send({ t: 'leave' });
    await b.waitFor((m) => m.t === 'left');
    await a.snapshot((m) => m.world.players.length === 1);
    expect(b.closeCode).toBeNull(); // the socket may create/join again
    a.send({ t: 'leave' });
    await a.waitFor((m) => m.t === 'left');
    expect(s.server.getStats().rooms).toBe(0);
  });
});

describe('lifecycle and cleanup', () => {
  it('repeated join/leave/disconnect cycles do not accumulate rooms, timers, listeners or queues', async () => {
    const s = await startServer({ reconnectGraceMs: 0 });
    server = s.server;
    const host = await connect(s.url);
    const { room } = await host.create();

    for (let i = 0; i < 40; i++) {
      const c = await TestClient.connect(s.url);
      await c.join(room, `G${i}`);
      for (let k = 0; k < 5; k++) c.input(1, 0);
      if (i % 2 === 0) {
        c.send({ t: 'leave' });
        await c.waitFor((m) => m.t === 'left');
      }
      await c.close();
      // Dropped (not left) slots are released on the next tick once the grace period (0 here) ends.
      for (let w = 0; w < 50 && s.server.getRoom(room)!.size > 1; w++) await sleep(10);
    }
    for (let i = 0; i < 20; i++) {
      const c = await TestClient.connect(s.url);
      await c.create(`R${i}`);
      await c.close();
    }
    await sleep(200);
    const counts = s.server.debugCounts();
    expect(counts.rooms).toBe(1); // only the host's room
    expect(s.server.getRoom(room)!.size).toBe(1);
    expect(counts.connections).toBe(1);
    expect(counts.lobbyTimers).toBe(0);
    expect(counts.wssConnectionListeners).toBe(1);
    expect(counts.queuedInputs).toBeLessThanOrEqual(s.server.config.inputQueueSize);
  });

  it('idle connections that never join are closed by the lobby timeout', async () => {
    const s = await startServer({ lobbyTimeoutMs: 200 });
    server = s.server;
    const idle = await connect(s.url);
    expect(await idle.closed).toBe(CLOSE_CODES.handshakeTimeout);
    expect(s.server.debugCounts().connections).toBe(0);
  });

  it('the same server can start and stop repeatedly with clients attached', async () => {
    const s = await startServer();
    const srv = s.server;
    let url = s.url;
    for (let round = 0; round < 4; round++) {
      if (round > 0) url = `ws://127.0.0.1:${(await srv.start()).port}`;
      const c = await TestClient.connect(url);
      await c.create();
      await srv.stop();
      expect(await c.closed).toBe(1001);
      expect(srv.debugCounts()).toMatchObject({ rooms: 0, connections: 0 });
      expect(srv.isRunning).toBe(false);
    }
    await srv.stop(); // idempotent
  });
});
