import {
  ClientConnection,
  DEFAULT_SERVER_CONFIG,
  FixedTicker,
  InputQueue,
  TokenBucket,
  configFromEnv,
  type SocketLike,
} from '@veyrath/game-server';
import { IDLE_INPUT } from '@veyrath/sim';
import { describe, expect, it } from 'vitest';
import { sleep } from '../helpers/net';

describe('InputQueue', () => {
  it('rejects duplicate and out-of-order sequence numbers', () => {
    const q = new InputQueue(8);
    expect(q.push(1, IDLE_INPUT)).toBe('accepted');
    expect(q.push(1, IDLE_INPUT)).toBe('duplicate');
    expect(q.push(3, IDLE_INPUT)).toBe('accepted');
    expect(q.push(2, IDLE_INPUT)).toBe('out_of_order');
    expect(q.size).toBe(2);
    expect(q.shift()?.seq).toBe(1);
    expect(q.shift()?.seq).toBe(3);
  });

  it('is bounded and drops the oldest input when full', () => {
    const q = new InputQueue(4);
    for (let seq = 0; seq < 10; seq++) q.push(seq, IDLE_INPUT);
    expect(q.size).toBe(4);
    expect(q.shift()?.seq).toBe(6);
  });

  it('keeps the high-water mark after clear (seq stays monotonic per player)', () => {
    const q = new InputQueue(4);
    q.push(10, IDLE_INPUT);
    q.clear();
    expect(q.push(5, IDLE_INPUT)).toBe('out_of_order');
    expect(q.push(11, IDLE_INPUT)).toBe('accepted');
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then refills at the configured rate', () => {
    let now = 0;
    const bucket = new TokenBucket(5, 10, () => now);
    for (let i = 0; i < 5; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now += 100; // +1 token
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now += 10_000;
    let taken = 0;
    while (bucket.tryTake()) taken++;
    expect(taken).toBe(5); // never exceeds capacity
  });
});

class FakeSocket implements SocketLike {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  terminated = false;
  send(data: string): void {
    this.sent.push(data);
  }
  ping(): void {}
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
}

describe('ClientConnection backpressure', () => {
  const config = {
    ...DEFAULT_SERVER_CONFIG,
    snapshotSkipBufferedBytes: 1000,
    maxBufferedBytes: 5000,
  };

  it('skips droppable snapshots while the socket is backed up, but still sends essential messages', () => {
    const socket = new FakeSocket();
    const conn = new ClientConnection(1, socket, config);
    expect(conn.sendRaw('snap1', true)).toBe('sent');
    socket.bufferedAmount = 2000;
    expect(conn.sendRaw('snap2', true)).toBe('skipped');
    expect(conn.send({ t: 'left' })).toBe('sent');
    expect(conn.skippedSnapshots).toBe(1);
    socket.bufferedAmount = 0;
    expect(conn.sendRaw('snap3', true)).toBe('sent');
    expect(socket.sent).toEqual(['snap1', '{"t":"left"}', 'snap3']);
  });

  it('terminates a connection whose buffer exceeds the hard limit', () => {
    const socket = new FakeSocket();
    const conn = new ClientConnection(1, socket, config);
    socket.bufferedAmount = 6000;
    expect(conn.sendRaw('snap', true)).toBe('overflow');
    expect(socket.terminated).toBe(true);
    expect(conn.sendRaw('snap', true)).toBe('closed');
  });

  it('flags sustained rate-limit abuse', () => {
    const now = 0;
    const conn = new ClientConnection(
      1,
      new FakeSocket(),
      { ...config, rateLimitBurst: 2, rateLimitPerSecond: 1, rateLimitMaxDrops: 3 },
      () => now,
    );
    expect(conn.allowMessage()).toBe(true);
    expect(conn.allowMessage()).toBe(true);
    for (let i = 0; i < 3; i++) expect(conn.allowMessage()).toBe(false);
    expect(conn.rateLimitExceeded).toBe(false);
    expect(conn.allowMessage()).toBe(false);
    expect(conn.rateLimitExceeded).toBe(true);
  });
});

describe('FixedTicker', () => {
  it('holds ~30 Hz on average even when individual ticks are slow', async () => {
    let ticks = 0;
    const ticker = new FixedTicker(30, () => {
      ticks++;
      if (ticks % 5 === 0) {
        const until = performance.now() + 25; // an occasional slow tick
        while (performance.now() < until) {
          // busy
        }
      }
    });
    ticker.start();
    await sleep(2000);
    ticker.stop();
    expect(ticks).toBeGreaterThanOrEqual(56);
    expect(ticks).toBeLessThanOrEqual(62);
    expect(ticker.stats.maxTickMs).toBeGreaterThanOrEqual(24);
  });

  it('stops cleanly and can be stopped twice', async () => {
    let ticks = 0;
    const ticker = new FixedTicker(30, () => ticks++);
    ticker.start();
    await sleep(200);
    ticker.stop();
    ticker.stop();
    const after = ticks;
    await sleep(200);
    expect(ticks).toBe(after);
    expect(ticker.running).toBe(false);
  });
});

describe('configFromEnv', () => {
  it('parses overrides and rejects bad values', () => {
    const c = configFromEnv({
      VEYRATH_PORT: '9000',
      VEYRATH_HOST: '0.0.0.0',
      VEYRATH_LOG_LEVEL: 'warn',
    });
    expect(c).toMatchObject({ port: 9000, host: '0.0.0.0', logLevel: 'warn' });
    expect(() => configFromEnv({ VEYRATH_PORT: 'abc' })).toThrow();
    expect(() => configFromEnv({ VEYRATH_LOG_LEVEL: 'loud' })).toThrow();
  });
});
