import type { EnemySnapshot, PlayerSnapshot, SimConfig } from '@veyrath/sim';
import type { ScreenTransform } from './heroes3d';

const SLOT_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#f06292'];

export interface RenderView {
  players: PlayerSnapshot[];
  enemy: EnemySnapshot | null;
  localPlayerId: string | null;
  /** Predicted position for the local player (drawn instead of the interpolated one). */
  localPosition: { x: number; y: number } | null;
  /** Milliseconds since the local player's predicted swing started, or null. */
  localSwingAgeMs: number | null;
  renderTick: number;
  /** True when the 3D hero layer draws the bodies: the 2D canvas then draws only rings and names. */
  modelHeroes: boolean;
}

/** Height of a drawn 3D hero on screen in world units (matches heroes3d at the 35° view). */
const MODEL_HERO_SCREEN_HEIGHT = 50;

/** How long a swing ring stays on screen: 6 ticks at 30 Hz. */
const SWING_VISIBLE_MS = 200;
const SWING_VISIBLE_TICKS = 6;

/**
 * Whether to draw a player's swing ring. Remote players use the server's record (drawn in the
 * interpolated past, so it lines up with where they are drawn). The local player uses the
 * predicted swing so it appears on the key press; the server's later record of the same swing is
 * ignored, and only shown if the prediction missed it.
 */
export function swingVisible(
  isLocal: boolean,
  lastAttackTick: number,
  renderTick: number,
  localSwingAgeMs: number | null,
): boolean {
  const serverSwing = lastAttackTick >= 0 && renderTick - lastAttackTick < SWING_VISIBLE_TICKS;
  if (!isLocal) return serverSwing;
  if (localSwingAgeMs !== null && localSwingAgeMs < SWING_VISIBLE_MS) return true;
  const predictedRecently = localSwingAgeMs !== null && localSwingAgeMs < 1000;
  return serverSwing && !predictedRecently;
}

/** Placeholder 2D renderer: circles for players, a square for the enemy. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private originX = 0;
  private originY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly config: SimConfig,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
  }

  /** The world → screen mapping of the last drawn frame (CSS pixels). */
  get transform(): ScreenTransform {
    return {
      scale: this.scale,
      originX: this.originX,
      originY: this.originY,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
  }

  private fit(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const pad = 16;
    this.scale = Math.min(
      (w - pad * 2) / this.config.worldWidth,
      (h - pad * 2) / this.config.worldHeight,
    );
    this.originX = (w - this.config.worldWidth * this.scale) / 2;
    this.originY = (h - this.config.worldHeight * this.scale) / 2;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(view: RenderView | null): void {
    this.fit();
    const { ctx, config } = this;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    ctx.save();
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);

    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, config.worldWidth, config.worldHeight);
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= config.worldWidth; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, config.worldHeight);
    }
    for (let y = 0; y <= config.worldHeight; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(config.worldWidth, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, config.worldWidth, config.worldHeight);

    if (view) {
      if (view.enemy) this.drawEnemy(view.enemy, view.renderTick);
      for (const p of view.players) {
        const isLocal = p.id === view.localPlayerId;
        const pos = isLocal && view.localPosition ? view.localPosition : p;
        const swinging = swingVisible(
          isLocal,
          p.lastAttackTick,
          view.renderTick,
          view.localSwingAgeMs,
        );
        this.drawPlayer(p, pos.x, pos.y, isLocal, swinging, view.modelHeroes);
      }
    }
    ctx.restore();
  }

  private drawEnemy(e: EnemySnapshot, renderTick: number): void {
    const { ctx, config } = this;
    if (!e.alive) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('enemy respawning…', config.worldWidth / 2, 30);
      return;
    }
    const r = config.enemyRadius;
    const flash = e.lastHitTick >= 0 && renderTick - e.lastHitTick < 4;
    ctx.fillStyle = flash ? '#ffffff' : '#e5534b';
    ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);

    const barW = 60;
    ctx.fillStyle = '#30363d';
    ctx.fillRect(e.x - barW / 2, e.y - r - 14, barW, 6);
    ctx.fillStyle = '#3fb950';
    ctx.fillRect(e.x - barW / 2, e.y - r - 14, (barW * e.hp) / e.maxHp, 6);
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${e.hp}/${e.maxHp}`, e.x, e.y - r - 18);
  }

  private drawPlayer(
    p: PlayerSnapshot,
    x: number,
    y: number,
    isLocal: boolean,
    swinging: boolean,
    modelHero: boolean,
  ): void {
    const { ctx, config } = this;
    const r = config.playerRadius;
    ctx.globalAlpha = p.connected ? 1 : 0.35;
    const color = SLOT_COLORS[p.slot % SLOT_COLORS.length]!;

    if (swinging) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + config.attackReach + config.enemyRadius / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    let labelY = y - r - 6;
    if (modelHero) {
      // The 3D layer draws the body; mark the feet with a shadow and a ring in the player's colour.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isLocal ? '#ffffff' : color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      labelY = y - MODEL_HERO_SCREEN_HEIGHT - 6;
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isLocal) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = `${p.name}${isLocal ? ' (you)' : ''}${p.connected ? '' : ' (reconnecting)'}`;
    ctx.fillText(label, x, labelY);
    ctx.globalAlpha = 1;
  }
}
