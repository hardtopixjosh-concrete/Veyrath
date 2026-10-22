/** Tunable rules for one world. Everything is expressed per tick or in world units. */
export interface SimConfig {
  /** Fixed simulation rate. All per-tick quantities below assume this rate. */
  readonly tickRate: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly maxPlayers: number;
  readonly playerRadius: number;
  /** World units per second at full input. */
  readonly playerSpeed: number;
  /** Extra reach beyond touching (edge-to-edge distance) for a basic attack to land. */
  readonly attackReach: number;
  readonly attackDamage: number;
  readonly attackCooldownTicks: number;
  readonly enemyRadius: number;
  readonly enemySpeed: number;
  readonly enemyMaxHp: number;
  readonly enemyRespawnTicks: number;
  /** The enemy picks a new wander target at least this often. */
  readonly enemyRetargetTicks: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = Object.freeze({
  tickRate: 30,
  worldWidth: 1200,
  worldHeight: 800,
  maxPlayers: 5,
  playerRadius: 16,
  playerSpeed: 220,
  attackReach: 40,
  attackDamage: 10,
  attackCooldownTicks: 12,
  enemyRadius: 24,
  enemySpeed: 60,
  enemyMaxHp: 100,
  enemyRespawnTicks: 90,
  enemyRetargetTicks: 150,
});
