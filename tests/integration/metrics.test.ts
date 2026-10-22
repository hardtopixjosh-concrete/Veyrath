import { GameServer, type MetricsRecord, type MetricsSink } from '@veyrath/game-server';
import { parseClientMessage } from '@veyrath/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { TestClient, sleep } from '../helpers/net';

const goodStats = {
  t: 'stats',
  fps: 60,
  rttMs: 42.5,
  rttJitterMs: 3.1,
  snapshotsPerSec: 30,
  snapshotJitterMs: 2,
  maxSnapshotGapMs: 80,
  corrections: 3,
  reconnects: 0,
};

class MemoryMetrics implements MetricsSink {
  records: MetricsRecord[] = [];
  write(record: MetricsRecord): void {
    this.records.push(record);
  }
  async close(): Promise<void> {}
}

let server: GameServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('stats message validation', () => {
  it('accepts well-formed stats and rejects bad values', () => {
    expect(parseClientMessage(JSON.stringify(goodStats)).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ ...goodStats, rttMs: -1 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...goodStats, fps: 'fast' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...goodStats, corrections: 1.5 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...goodStats, maxSnapshotGapMs: 1e7 })).ok).toBe(
      false,
    );
    const { fps: _fps, ...missing } = goodStats;
    expect(parseClientMessage(JSON.stringify(missing)).ok).toBe(false);
  });
});

describe('metrics log', () => {
  it('records lifecycle events, client-reported stats and server stats', async () => {
    const metrics = new MemoryMetrics();
    server = new GameServer(
      { host: '127.0.0.1', port: 0, statsIntervalMs: 200, heartbeatIntervalMs: 100 },
      undefined,
      metrics,
    );
    const { port } = await server.start();
    const a = await TestClient.connect(`ws://127.0.0.1:${port}`);
    const welcome = await a.create('Metro');
    await sleep(250); // let a heartbeat measure RTT
    a.send(JSON.stringify(goodStats));
    await sleep(300);
    a.send({ t: 'leave' });
    await a.waitFor((m) => m.t === 'left');
    await a.close();

    const events = metrics.records.filter((r) => r.type === 'event').map((r) => r.event);
    expect(events).toEqual(
      expect.arrayContaining(['room created', 'player joined', 'player left', 'room closed']),
    );
    const client = metrics.records.find((r) => r.type === 'client');
    expect(client).toMatchObject({
      room: welcome.room,
      player: welcome.playerId,
      name: 'Metro',
      rttMs: 42.5,
      corrections: 3,
    });
    expect(typeof client?.serverRttMs).toBe('number');
    const serverRecord = metrics.records.find((r) => r.type === 'server');
    expect(serverRecord).toMatchObject({ rooms: 1, players: 1 });
    expect(serverRecord?.rssMB).toBeGreaterThan(0);
  });

  it('ignores stats from a socket that is not in a room', async () => {
    const metrics = new MemoryMetrics();
    server = new GameServer({ host: '127.0.0.1', port: 0 }, undefined, metrics);
    const { port } = await server.start();
    const c = await TestClient.connect(`ws://127.0.0.1:${port}`);
    c.send(JSON.stringify(goodStats));
    await sleep(100);
    expect(metrics.records.filter((r) => r.type === 'client')).toHaveLength(0);
    await c.close();
  });
});
