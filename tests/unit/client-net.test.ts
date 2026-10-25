import { DEFAULT_SIM_CONFIG, movePlayer, type PlayerInput, type WorldSnapshot } from '@veyrath/sim';
import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../../packages/client/src/net/interpolation';
import { Predictor } from '../../packages/client/src/net/prediction';

const right: PlayerInput = { moveX: 1, moveY: 0, attack: false };

describe('Predictor (client prediction + reconciliation)', () => {
  it('predicts exactly what the server will compute for the same inputs', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0);
    for (let seq = 1; seq <= 5; seq++) p.applyLocal(seq, right);
    // Server has applied inputs 1..3 so far.
    let server = { x: 100, y: 100 };
    for (let i = 0; i < 3; i++) server = movePlayer(server.x, server.y, right, DEFAULT_SIM_CONFIG);
    p.reconcile(server.x, server.y, 3);
    expect(p.lastCorrection).toBeCloseTo(0, 5);
    expect(p.pendingCount).toBe(2);
  });

  it('server state wins when the prediction disagrees', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0);
    for (let seq = 1; seq <= 3; seq++) p.applyLocal(seq, right);
    // Server says we were blocked at x=100 and has applied everything.
    p.reconcile(100, 100, 3);
    expect(p.lastCorrection).toBeGreaterThan(20);
    expect(p.pendingCount).toBe(0);
    // Visual offset decays to the authoritative position.
    let pos = p.renderPosition(16)!;
    for (let i = 0; i < 60; i++) pos = p.renderPosition(16)!;
    expect(pos.x).toBeCloseTo(100, 1);
  });

  it('glides between input steps instead of jumping once per tick', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0);
    const step = DEFAULT_SIM_CONFIG.playerSpeed / DEFAULT_SIM_CONFIG.tickRate;
    const tickMs = 1000 / DEFAULT_SIM_CONFIG.tickRate;
    p.applyLocal(1, right, 1000);
    // Right at the step: still at the previous position. Halfway: halfway. After a full tick: there.
    expect(p.renderPosition(0, 1000)!.x).toBeCloseTo(100, 2);
    expect(p.renderPosition(0, 1000 + tickMs / 2)!.x).toBeCloseTo(100 + step / 2, 1);
    expect(p.renderPosition(0, 1000 + tickMs)!.x).toBeCloseTo(100 + step, 2);
    expect(p.renderPosition(0, 1000 + tickMs * 5)!.x).toBeCloseTo(100 + step, 2);
  });

  it('a correction mid-glide does not make the drawn position jump', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0);
    const tickMs = 1000 / DEFAULT_SIM_CONFIG.tickRate;
    p.applyLocal(1, right, 1000);
    const before = p.renderPosition(0, 1000 + tickMs / 2)!;
    p.reconcile(100, 100, 1); // server says the step didn't happen (blocked)
    const after = p.renderPosition(0, 1000 + tickMs / 2)!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.01);
  });

  it('bounds pending inputs', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG, 10);
    p.reconcile(100, 100, 0);
    for (let seq = 1; seq <= 50; seq++) p.applyLocal(seq, right);
    expect(p.pendingCount).toBe(10);
  });
});

function snap(tick: number, x: number): WorldSnapshot {
  return {
    tick,
    players: [
      {
        id: 'p_a',
        name: 'A',
        slot: 0,
        x,
        y: 0,
        connected: true,
        lastAttackTick: -1,
        attackCooldown: 0,
      },
    ],
    enemy: { id: 'e', x, y: 0, hp: 100, maxHp: 100, alive: true, lastHitTick: -1, lastHitBy: null },
  };
}

describe('SnapshotBuffer (interpolation)', () => {
  it('interpolates between bracketing snapshots', () => {
    const buf = new SnapshotBuffer(30);
    const ms = 1000 / 30;
    for (let tick = 1; tick <= 10; tick++) buf.push(snap(tick, tick * 10), tick * ms);
    // At local time of tick 10, with a 3-tick delay, we should render around tick 7.
    const view = buf.sample(10 * ms, 3)!;
    expect(view.renderTick).toBeCloseTo(7, 0);
    expect(view.players[0]!.x).toBeCloseTo(70, 0);
  });

  it('ignores stale/duplicate snapshots and stays bounded', () => {
    const buf = new SnapshotBuffer(30, 5);
    buf.push(snap(5, 50), 0);
    buf.push(snap(4, 40), 1);
    buf.push(snap(5, 99), 2);
    expect(buf.size).toBe(1);
    for (let t = 6; t < 50; t++) buf.push(snap(t, t), t);
    expect(buf.size).toBe(5);
  });
});
