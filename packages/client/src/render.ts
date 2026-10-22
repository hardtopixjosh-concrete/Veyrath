import type { EnemySnapshot, PlayerSnapshot, SimConfig } from '@veyrath/sim';

const SLOT_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#f06292'];

export interface RenderView {
  players: PlayerSnapshot[];
  enemy: EnemySnapshot | null;
  localPlayerId: string | null;
  /** Predicted position for the local player (drawn instead of the interpolated one). */
  localPosition: { x: number; y: number } | null;
  renderTick: number;
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
        this.drawPlayer(p, pos.x, pos.y, isLocal, view.renderTick);
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
    renderTick: number,
  ): void {
    const { ctx, config } = this;
    const r = config.playerRadius;
    ctx.globalAlpha = p.connected ? 1 : 0.35;

    if (p.lastAttackTick >= 0 && renderTick - p.lastAttackTick < 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + config.attackReach + config.enemyRadius / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = SLOT_COLORS[p.slot % SLOT_COLORS.length]!;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (isLocal) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = `${p.name}${isLocal ? ' (you)' : ''}${p.connected ? '' : ' (reconnecting)'}`;
    ctx.fillText(label, x, y - r - 6);
    ctx.globalAlpha = 1;
  }
}
