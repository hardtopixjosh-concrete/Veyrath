import { DEFAULT_SIM_CONFIG, type SimConfig } from './config';
import { inAttackRange, movePlayer, quantize, spawnPoint } from './movement';
import { nextRandom } from './rng';
import type { HitEvent, PlayerInput, PlayerState, StepResult, World, WorldSnapshot } from './types';

export const ENEMY_ID = 'enemy-1';

function random(world: World): number {
  const r = nextRandom(world.rngState);
  world.rngState = r.state;
  return r.value;
}

function randomEnemyPoint(world: World): { x: number; y: number } {
  const { config } = world;
  const margin = config.enemyRadius + 40;
  const minX = config.worldWidth * 0.35;
  return {
    x: quantize(minX + random(world) * (config.worldWidth - margin - minX)),
    y: quantize(margin + random(world) * (config.worldHeight - 2 * margin)),
  };
}

export function createWorld(seed: number, config: SimConfig = DEFAULT_SIM_CONFIG): World {
  const world: World = {
    config,
    seed: seed >>> 0,
    tick: 0,
    rngState: seed >>> 0,
    players: [],
    enemy: {
      id: ENEMY_ID,
      x: 0,
      y: 0,
      hp: config.enemyMaxHp,
      maxHp: config.enemyMaxHp,
      alive: true,
      respawnTick: 0,
      targetX: 0,
      targetY: 0,
      retargetTick: 0,
      lastHitTick: -1,
      lastHitBy: null,
    },
  };
  const start = randomEnemyPoint(world);
  const target = randomEnemyPoint(world);
  Object.assign(world.enemy, { x: start.x, y: start.y, targetX: target.x, targetY: target.y });
  return world;
}

export function addPlayer(world: World, id: string, name: string, slot: number): PlayerState {
  if (world.players.length >= world.config.maxPlayers) throw new Error('world is full');
  if (slot < 0 || slot >= world.config.maxPlayers) throw new Error(`invalid slot ${slot}`);
  if (world.players.some((p) => p.id === id || p.slot === slot)) {
    throw new Error(`duplicate player id or slot: ${id}/${slot}`);
  }
  const spawn = spawnPoint(slot, world.config);
  const player: PlayerState = {
    id,
    name,
    slot,
    x: spawn.x,
    y: spawn.y,
    connected: true,
    attackCooldown: 0,
    lastAttackTick: -1,
  };
  world.players.push(player);
  world.players.sort((a, b) => a.slot - b.slot);
  return player;
}

export function removePlayer(world: World, id: string): boolean {
  const index = world.players.findIndex((p) => p.id === id);
  if (index === -1) return false;
  world.players.splice(index, 1);
  return true;
}

export function getPlayer(world: World, id: string): PlayerState | undefined {
  return world.players.find((p) => p.id === id);
}

/**
 * Advances the world by exactly one fixed tick. `inputs` holds at most one input per player for this
 * tick; players without an input (or disconnected players) stand still.
 */
export function stepWorld(world: World, inputs: ReadonlyMap<string, PlayerInput>): StepResult {
  const { config, enemy } = world;
  const tick = world.tick + 1;
  const hits: HitEvent[] = [];

  for (const player of world.players) {
    if (player.attackCooldown > 0) player.attackCooldown -= 1;
    const input = player.connected ? inputs.get(player.id) : undefined;
    if (!input) continue;

    const next = movePlayer(player.x, player.y, input, config);
    player.x = next.x;
    player.y = next.y;

    if (input.attack && player.attackCooldown === 0) {
      player.attackCooldown = config.attackCooldownTicks;
      player.lastAttackTick = tick;
      if (enemy.alive && inAttackRange(player.x, player.y, enemy.x, enemy.y, config)) {
        enemy.hp = Math.max(0, enemy.hp - config.attackDamage);
        enemy.lastHitTick = tick;
        enemy.lastHitBy = player.id;
        const killed = enemy.hp === 0;
        if (killed) {
          enemy.alive = false;
          enemy.respawnTick = tick + config.enemyRespawnTicks;
        }
        hits.push({
          tick,
          playerId: player.id,
          damage: config.attackDamage,
          hpAfter: enemy.hp,
          killed,
        });
      }
    }
  }

  stepEnemy(world, tick);
  world.tick = tick;
  return { hits };
}

function stepEnemy(world: World, tick: number): void {
  const { config, enemy } = world;
  if (!enemy.alive) {
    if (tick >= enemy.respawnTick) {
      const spawn = randomEnemyPoint(world);
      const target = randomEnemyPoint(world);
      Object.assign(enemy, {
        x: spawn.x,
        y: spawn.y,
        targetX: target.x,
        targetY: target.y,
        hp: enemy.maxHp,
        alive: true,
        retargetTick: tick,
      });
    }
    return;
  }

  const dx = enemy.targetX - enemy.x;
  const dy = enemy.targetY - enemy.y;
  const distance = Math.hypot(dx, dy);
  const step = config.enemySpeed / config.tickRate;
  if (distance <= step) {
    enemy.x = enemy.targetX;
    enemy.y = enemy.targetY;
  } else {
    enemy.x = quantize(enemy.x + (dx / distance) * step);
    enemy.y = quantize(enemy.y + (dy / distance) * step);
  }
  if (distance <= step || tick - enemy.retargetTick >= config.enemyRetargetTicks) {
    const target = randomEnemyPoint(world);
    enemy.targetX = target.x;
    enemy.targetY = target.y;
    enemy.retargetTick = tick;
  }
}

export function snapshotWorld(world: World): WorldSnapshot {
  const { enemy } = world;
  return {
    tick: world.tick,
    players: world.players.map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      x: p.x,
      y: p.y,
      connected: p.connected,
      lastAttackTick: p.lastAttackTick,
      attackCooldown: p.attackCooldown,
    })),
    enemy: {
      id: enemy.id,
      x: enemy.x,
      y: enemy.y,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      alive: enemy.alive,
      lastHitTick: enemy.lastHitTick,
      lastHitBy: enemy.lastHitBy,
    },
  };
}
