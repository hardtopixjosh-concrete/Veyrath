export interface OverlayData {
  phase: string;
  room: string | null;
  playerId: string | null;
  slot: number | null;
  players: number;
  connectedPlayers: number;
  serverTick: number | null;
  serverTickMs: number | null;
  fps: number;
  frameMs: number;
  rttMs: number | null;
  snapshotsPerSec: number;
  ack: number | null;
  pendingInputs: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
  bytesInTotal: number;
  bytesOutTotal: number;
  bufferedBytes: number;
  lastCorrection: number;
  corrections: number;
  reconnects: number;
  renderDelayMs: number;
}

const kb = (bytes: number): string =>
  bytes < 1024 ? `${bytes.toFixed(0)} B` : `${(bytes / 1024).toFixed(1)} KB`;
const fmt = (value: number | null, digits = 1): string =>
  value === null ? '–' : value.toFixed(digits);

/** F3 debug overlay. Text only, refreshed a few times per second. */
export class DebugOverlay {
  private lastUpdate = 0;

  constructor(private readonly el: HTMLElement) {}

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  update(now: number, d: OverlayData): void {
    if (this.el.hidden || now - this.lastUpdate < 250) return;
    this.lastUpdate = now;
    this.el.textContent = [
      `VEYRATH DEBUG (F3)`,
      `phase      ${d.phase}`,
      `room       ${d.room ?? '–'}   player ${d.playerId ?? '–'} (slot ${d.slot ?? '–'})`,
      `players    ${d.players}/5 (connected ${d.connectedPlayers})`,
      `server     tick ${d.serverTick ?? '–'}   tick time ${fmt(d.serverTickMs, 3)} ms avg`,
      `client     ${fmt(d.fps)} fps   frame ${fmt(d.frameMs)} ms${d.renderDelayMs ? `   (render delay ${d.renderDelayMs} ms)` : ''}`,
      `rtt        ${fmt(d.rttMs)} ms`,
      `snapshots  ${fmt(d.snapshotsPerSec)}/s   ack ${d.ack ?? '–'}   pending inputs ${d.pendingInputs}`,
      `recv       ${kb(d.bytesInPerSec)}/s   total ${kb(d.bytesInTotal)}`,
      `sent       ${kb(d.bytesOutPerSec)}/s   total ${kb(d.bytesOutTotal)}`,
      `ws queue   ${kb(d.bufferedBytes)} buffered`,
      `prediction last correction ${d.lastCorrection.toFixed(2)}   corrections ${d.corrections}`,
      `reconnects ${d.reconnects}`,
    ].join('\n');
  }
}
