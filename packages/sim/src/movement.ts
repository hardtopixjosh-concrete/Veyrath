import type { SimConfig } from './config';
import type { PlayerInput } from './types';

/**
 * Positions are kept at 1/100 unit precision so the authoritative state, the wire snapshot, and the
 * client's replayed prediction are exactly the same numbers.
 */
export function quantize(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Sanitizes a movement vector: non-finite components become 0 and the length is capped at 1. */
export function clampMoveVector(moveX: number, moveY: number): { x: number; y: number } {
  const x = Number.isFinite(moveX) ? clamp(moveX, -1, 1) : 0;
  const y = Number.isFinite(moveY) ? clamp(moveY, -1, 1) : 0;
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/**
 * One tick of player movement. Shared by the server simulation and client-side prediction so both
 * produce identical results for identical inputs.
 */
export function movePlayer(
  x: number,
  y: number,
  input: PlayerInput,
  config: SimConfig,
): { x: number; y: number } {
  const v = clampMoveVector(input.moveX, input.moveY);
  const step = config.playerSpeed / config.tickRate;
  const r = config.playerRadius;
  return {
    x: quantize(clamp(x + v.x * step, r, config.worldWidth - r)),
    y: quantize(clamp(y + v.y * step, r, config.worldHeight - r)),
  };
}

export function spawnPoint(slot: number, config: SimConfig): { x: number; y: number } {
  return {
    x: quantize(config.worldWidth * 0.15),
    y: quantize((config.worldHeight * (slot + 1)) / (config.maxPlayers + 1)),
  };
}

export function inAttackRange(
  px: number,
  py: number,
  ex: number,
  ey: number,
  config: SimConfig,
): boolean {
  const reach = config.playerRadius + config.enemyRadius + config.attackReach;
  return Math.hypot(ex - px, ey - py) <= reach;
}
