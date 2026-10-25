import type { GameServer } from '@veyrath/game-server';
import { IDLE_INPUT } from '@veyrath/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { GameSession, type SessionPhase } from '../../packages/client/src/net/session';
import { createWebSocketTransport } from '../../packages/client/src/net/transport';
import { ResumeStore, type KeyValueStore } from '../../packages/client/src/resume';
import { sleep, startServer } from '../helpers/net';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const ticket = {
  url: 'ws://127.0.0.1:7777',
  room: 'ABCDE',
  playerId: 'p_00000001',
  token: 'f'.repeat(32),
  graceMs: 15000,
};

describe('ResumeStore', () => {
  it('returns a fresh ticket and refuses a stale one', () => {
    let now = 1_000_000;
    const store = new ResumeStore(new MemoryStore(), 'k', () => now);
    store.save(ticket);
    now += 5000;
    expect(store.loadUsable()).toMatchObject({ playerId: 'p_00000001' });
    now += 9000; // 14 s since last seen: within 15 s, but inside the safety margin
    expect(store.loadUsable()).toBeNull();
    expect(store.loadUsable()).toBeNull(); // and it was cleared
  });

  it('touch keeps it fresh while connected', () => {
    let now = 0;
    const store = new ResumeStore(new MemoryStore(), 'k', () => now);
    store.save(ticket);
    for (let i = 0; i < 60; i++) {
      now += 1000;
      store.touch();
    }
    now += 3000;
    expect(store.loadUsable()).not.toBeNull();
  });

  it('ignores garbage and works without storage', () => {
    const mem = new MemoryStore();
    mem.setItem('k', '{"url":"http://evil","room":"ABCDE"}');
    expect(new ResumeStore(mem, 'k').loadUsable()).toBeNull();
    mem.setItem('k', 'not json');
    expect(new ResumeStore(mem, 'k').loadUsable()).toBeNull();
    const none = new ResumeStore(null, 'k');
    none.save(ticket);
    expect(none.loadUsable()).toBeNull();
  });
});

describe('resuming after the game was closed and reopened', () => {
  let server: GameServer | null = null;
  const sessions: GameSession[] = [];
  afterEach(async () => {
    for (const s of sessions.splice(0)) s.leave();
    await server?.stop();
    server = null;
  });

  function newSession(phases: SessionPhase[] = []): GameSession {
    const s = new GameSession(
      createWebSocketTransport,
      { sample: () => IDLE_INPUT },
      {
        onPhase: (p) => phases.push(p),
        onWelcome: () => {},
        onSnapshot: () => {},
        onError: () => {},
      },
    );
    sessions.push(s);
    return s;
  }

  async function until(cond: () => boolean, ms = 4000): Promise<void> {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out');
      await sleep(20);
    }
  }

  it('a new session with the saved ticket comes back as the same player', async () => {
    const s = await startServer({ reconnectGraceMs: 5000 });
    server = s.server;
    const first = newSession();
    first.createRoom(s.url, 'Restarty');
    await until(() => first.phase === 'in_room');
    const w = first.welcome!;

    // "Close the game": the socket just drops, no leave message.
    first.simulateNetworkDrop();
    sessions.splice(sessions.indexOf(first), 1);
    await until(() => !!s.server.getRoom(w.room)?.members.get(w.playerId)?.disconnectedAt);

    const reopened = newSession();
    reopened.resume(s.url, w.room, w.playerId, w.token);
    await until(() => reopened.phase === 'in_room');
    expect(reopened.playerId).toBe(w.playerId);
    expect(s.server.getRoom(w.room)!.size).toBe(1); // no ghost + new player
  });

  it('after the grace time the resume is refused and the session ends in the lobby', async () => {
    const s = await startServer({ reconnectGraceMs: 300 });
    server = s.server;
    const first = newSession();
    first.createRoom(s.url, 'Late');
    await until(() => first.phase === 'in_room');
    const w = first.welcome!;
    first.simulateNetworkDrop();
    sessions.splice(sessions.indexOf(first), 1);
    await sleep(800);

    const phases: SessionPhase[] = [];
    const reopened = newSession(phases);
    reopened.resume(s.url, w.room, w.playerId, w.token);
    await until(() => phases.includes('idle'));
    expect(reopened.phase).toBe('idle');
  });
});
