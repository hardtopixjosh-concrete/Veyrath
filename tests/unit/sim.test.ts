import {
  DEFAULT_SIM_CONFIG,
  addPlayer,
  createWorld,
  movePlayer,
  removePlayer,
  snapshotWorld,
  stepWorld,
  type PlayerInput,
  type World,
} from '@veyrath/sim';
import { describe, expect, it } from 'vitest';

const cfg = DEFAULT_SIM_CONFIG;

/** Deterministic pseudo-random input script so the test itself has no hidden randomness. */
function scriptedInput(tick: number, player: number): PlayerInput {
  const phase = (tick * (player + 3)) % 97;
  return {
    moveX: Math.sin(phase) > 0.2 ? 1 : Math.sin(phase) < -0.2 ? -1 : 0,
    moveY: Math.cos(phase * 1.3) > 0 ? 0.7 : -0.7,
    attack: phase % 7 === 0,
  };
}

function runWorld(seed: number, ticks: number): string[] {
  const world = createWorld(seed);
  addPlayer(world, 'p_a', 'A', 0);
  addPlayer(world, 'p_b', 'B', 1);
  const frames: string[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(
      world,
      new Map([
        ['p_a', scriptedInput(t, 0)],
        ['p_b', scriptedInput(t, 1)],
      ]),
    );
    frames.push(JSON.stringify(snapshotWorld(world)));
  }
  return frames;
}

/** Puts both the enemy and a player at fixed spots so attacks land predictably. */
function placeNextToEnemy(world: World, id: string): void {
  const p = world.players.find((x) => x.id === id)!;
  p.x = world.enemy.x - 40;
  p.y = world.enemy.y;
}

describe('determinism', () => {
  it('identical seed + identical inputs produce identical worlds every tick', () => {
    const a = runWorld(42, 900);
    const b = runWorld(42, 900);
    expect(a).toEqual(b);
  });

  it('different seeds diverge (the RNG actually drives the enemy)', () => {
    const a = runWorld(1, 300);
    const b = runWorld(2, 300);
    expect(a.at(-1)).not.toEqual(b.at(-1));
  });

  it('player order is by slot regardless of join order', () => {
    const world = createWorld(5);
    addPlayer(world, 'p_late', 'Late', 3);
    addPlayer(world, 'p_early', 'Early', 0);
    expect(world.players.map((p) => p.slot)).toEqual([0, 3]);
  });
});

describe('movement', () => {
  it('moves one tick of speed and clamps to world bounds', () => {
    const step = cfg.playerSpeed / cfg.tickRate;
    expect(movePlayer(100, 100, { moveX: 1, moveY: 0, attack: false }, cfg).x).toBeCloseTo(
      100 + step,
      2,
    );
    const clamped = movePlayer(
      cfg.playerRadius,
      cfg.playerRadius,
      { moveX: -1, moveY: -1, attack: false },
      cfg,
    );
    expect(clamped).toEqual({ x: cfg.playerRadius, y: cfg.playerRadius });
  });

  it('caps diagonal speed at 1 and treats non-finite axes as 0', () => {
    const diag = movePlayer(500, 400, { moveX: 1, moveY: 1, attack: false }, cfg);
    const dist = Math.hypot(diag.x - 500, diag.y - 400);
    expect(dist).toBeLessThanOrEqual(cfg.playerSpeed / cfg.tickRate + 0.02);
    expect(movePlayer(500, 400, { moveX: NaN, moveY: Infinity, attack: false }, cfg)).toEqual({
      x: 500,
      y: 400,
    });
  });

  it('players without input or disconnected players do not move', () => {
    const world = createWorld(9);
    const p = addPlayer(world, 'p_a', 'A', 0);
    const start = { x: p.x, y: p.y };
    stepWorld(world, new Map());
    expect({ x: p.x, y: p.y }).toEqual(start);
    p.connected = false;
    stepWorld(world, new Map([['p_a', { moveX: 1, moveY: 0, attack: false }]]));
    expect({ x: p.x, y: p.y }).toEqual(start);
  });
});

describe('authoritative enemy HP', () => {
  it('an in-range attack reduces HP by exactly the attack damage', () => {
    const world = createWorld(3);
    addPlayer(world, 'p_a', 'A', 0);
    placeNextToEnemy(world, 'p_a');
    const result = stepWorld(world, new Map([['p_a', { moveX: 0, moveY: 0, attack: true }]]));
    expect(result.hits).toHaveLength(1);
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp - cfg.attackDamage);
    expect(world.enemy.lastHitBy).toBe('p_a');
  });

  it('out-of-range attacks do nothing to HP', () => {
    const world = createWorld(3);
    addPlayer(world, 'p_a', 'A', 0);
    world.players[0]!.x = 20;
    world.enemy.x = 1100;
    stepWorld(world, new Map([['p_a', { moveX: 0, moveY: 0, attack: true }]]));
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp);
    expect(world.players[0]!.lastAttackTick).toBe(1); // the swing still happens
  });

  it('enforces the attack cooldown', () => {
    const world = createWorld(3);
    addPlayer(world, 'p_a', 'A', 0);
    for (let i = 0; i < cfg.attackCooldownTicks; i++) {
      placeNextToEnemy(world, 'p_a');
      stepWorld(world, new Map([['p_a', { moveX: 0, moveY: 0, attack: true }]]));
    }
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp - cfg.attackDamage);
    placeNextToEnemy(world, 'p_a');
    stepWorld(world, new Map([['p_a', { moveX: 0, moveY: 0, attack: true }]]));
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp - 2 * cfg.attackDamage);
  });

  it('two players hitting the same tick both count', () => {
    const world = createWorld(3);
    addPlayer(world, 'p_a', 'A', 0);
    addPlayer(world, 'p_b', 'B', 1);
    placeNextToEnemy(world, 'p_a');
    placeNextToEnemy(world, 'p_b');
    const attack = { moveX: 0, moveY: 0, attack: true };
    const result = stepWorld(
      world,
      new Map([
        ['p_a', attack],
        ['p_b', attack],
      ]),
    );
    expect(result.hits.map((h) => h.playerId)).toEqual(['p_a', 'p_b']);
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp - 2 * cfg.attackDamage);
  });

  it('dies at 0 HP and respawns at full HP after the respawn delay', () => {
    const world = createWorld(3);
    addPlayer(world, 'p_a', 'A', 0);
    world.enemy.hp = cfg.attackDamage;
    placeNextToEnemy(world, 'p_a');
    const result = stepWorld(world, new Map([['p_a', { moveX: 0, moveY: 0, attack: true }]]));
    expect(result.hits[0]!.killed).toBe(true);
    expect(world.enemy.alive).toBe(false);
    for (let i = 0; i < cfg.enemyRespawnTicks; i++) stepWorld(world, new Map());
    expect(world.enemy.alive).toBe(true);
    expect(world.enemy.hp).toBe(cfg.enemyMaxHp);
  });
});

describe('membership', () => {
  it('rejects a sixth player and duplicate slots', () => {
    const world = createWorld(1);
    for (let i = 0; i < 5; i++) addPlayer(world, `p_${i}`, `P${i}`, i);
    expect(() => addPlayer(world, 'p_x', 'X', 0)).toThrow();
    removePlayer(world, 'p_2');
    expect(() => addPlayer(world, 'p_y', 'Y', 1)).toThrow();
    expect(addPlayer(world, 'p_z', 'Z', 2).slot).toBe(2);
  });
});
