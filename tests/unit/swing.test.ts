import {
  DEFAULT_SIM_CONFIG,
  addPlayer,
  createWorld,
  stepWorld,
  type PlayerInput,
} from '@veyrath/sim';
import { describe, expect, it } from 'vitest';
import { Predictor } from '../../packages/client/src/net/prediction';
import { swingVisible } from '../../packages/client/src/render';

const attack: PlayerInput = { moveX: 0, moveY: 0, attack: true };
const idle: PlayerInput = { moveX: 0, moveY: 0, attack: false };

describe('predicted local swing', () => {
  it('starts on the input that swings, not a round trip later', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0, 0);
    expect(p.swingAgeMs(1000)).toBeNull();
    p.applyLocal(1, attack, 1000);
    expect(p.swingAgeMs(1000)).toBe(0);
    expect(p.swingAgeMs(1050)).toBe(50);
  });

  it('respects the cooldown exactly like the server, so held attack swings on the same ticks', () => {
    const world = createWorld(1);
    addPlayer(world, 'p_a', 'A', 0);
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(world.players[0]!.x, world.players[0]!.y, 0, 0);

    const predictedSwings: number[] = [];
    const serverSwings: number[] = [];
    for (let seq = 1; seq <= 60; seq++) {
      const now = seq * 33;
      const before = p.swingAgeMs(now);
      p.applyLocal(seq, attack, now);
      if (p.swingAgeMs(now) === 0 && before !== 0) predictedSwings.push(seq);
      stepWorld(world, new Map([['p_a', attack]]));
      if (world.players[0]!.lastAttackTick === world.tick) serverSwings.push(seq);
    }
    expect(predictedSwings).toEqual(serverSwings);
    expect(predictedSwings.length).toBe(Math.ceil(60 / DEFAULT_SIM_CONFIG.attackCooldownTicks));
  });

  it('resyncs the cooldown from the server so a mismatch cannot last', () => {
    const p = new Predictor(DEFAULT_SIM_CONFIG);
    p.reconcile(100, 100, 0, 0);
    p.applyLocal(1, attack, 0); // predicted swing, cooldown now 12
    // Server says it already counted down to 0 (it ticked without our inputs) and acked seq 1.
    p.reconcile(100, 100, 1, 0);
    p.applyLocal(2, attack, 33);
    expect(p.swingAgeMs(33)).toBe(0); // swings again right away, matching the server
    p.applyLocal(3, idle, 66);
    expect(p.swingAgeMs(66)).toBe(33);
  });
});

describe('swingVisible', () => {
  it('remote players show the server record in their interpolated time', () => {
    expect(swingVisible(false, 100, 103, null)).toBe(true);
    expect(swingVisible(false, 100, 106, null)).toBe(false);
    expect(swingVisible(false, -1, 3, null)).toBe(false);
  });

  it('the local player shows the predicted swing immediately', () => {
    expect(swingVisible(true, -1, 0, 0)).toBe(true);
    expect(swingVisible(true, -1, 0, 150)).toBe(true);
    expect(swingVisible(true, -1, 0, 250)).toBe(false);
  });

  it('the local player does not show the same swing again when the server confirms it', () => {
    // Prediction showed the swing 300 ms ago; the server record arrives now.
    expect(swingVisible(true, 100, 102, 300)).toBe(false);
  });

  it('falls back to the server record if the prediction missed a swing', () => {
    expect(swingVisible(true, 100, 102, null)).toBe(true);
    expect(swingVisible(true, 100, 102, 5000)).toBe(true);
  });
});
