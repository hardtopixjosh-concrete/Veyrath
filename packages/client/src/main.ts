import { isValidPlayerName, isValidRoomCode } from '@veyrath/protocol';
import { DEFAULT_SIM_CONFIG } from '@veyrath/sim';
import { loadClientConfig } from './config';
import { KeyboardInput } from './input';
import { CounterRate, Ema } from './metrics';
import { GameSession, type InputSource, type SessionPhase } from './net/session';
import { createWebSocketTransport } from './net/transport';
import { DebugOverlay } from './overlay';
import { connectionQuality } from './quality';
import { Renderer } from './render';
import { Autopilot, SmokeRecorder, runSmokeScript } from './smoke';
import './styles.css';

/** Remote entities are drawn this many ticks (~100 ms at 30 Hz) in the past. */
const INTERPOLATION_DELAY_TICKS = 3;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`veyrath.${key}`);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`veyrath.${key}`, value);
  } catch {
    // Preferences are a convenience only.
  }
}

async function main(): Promise<void> {
  const config = await loadClientConfig();
  document.title = `Veyrath — P${config.instance}`;

  const lobby = el<HTMLDivElement>('lobby');
  const hud = el<HTMLDivElement>('hud');
  const nameInput = el<HTMLInputElement>('name');
  const serverInput = el<HTMLInputElement>('server');
  const roomInput = el<HTMLInputElement>('room-code');
  const lobbyStatus = el<HTMLParagraphElement>('lobby-status');
  const hudRoom = el<HTMLSpanElement>('hud-room');
  const hudStatus = el<HTMLSpanElement>('hud-status');
  const hudPlayers = el<HTMLUListElement>('hud-players');
  const banner = el<HTMLDivElement>('banner');
  const hudQuality = el<HTMLDivElement>('hud-quality');
  const hudQualityLabel = el<HTMLSpanElement>('hud-quality-label');

  nameInput.value = loadPref(`name.${config.instance}`) ?? `Player${config.instance}`;
  serverInput.value = config.serverUrl;

  const renderer = new Renderer(el<HTMLCanvasElement>('game'), DEFAULT_SIM_CONFIG);
  const overlay = new DebugOverlay(el<HTMLPreElement>('overlay'));
  const keyboard = new KeyboardInput(window);
  let inputSource: InputSource = keyboard;
  let recorder: SmokeRecorder | null = null;

  const showPhase = (phase: SessionPhase, detail: string): void => {
    const playing = phase === 'in_room' || phase === 'reconnecting';
    lobby.hidden = playing;
    hud.hidden = !playing;
    banner.hidden = phase !== 'reconnecting';
    banner.textContent = detail;
    hudStatus.textContent = phase === 'in_room' ? 'connected' : detail;
    if (phase === 'idle' || phase === 'connecting') lobbyStatus.textContent = detail;
    for (const button of lobby.querySelectorAll('button')) button.disabled = phase === 'connecting';
  };

  const session = new GameSession(
    createWebSocketTransport,
    { sample: () => inputSource.sample() },
    {
      onPhase: (phase, detail) => {
        keyboard.enabled = phase === 'in_room';
        showPhase(phase, detail);
        recorder?.onPhase(phase);
      },
      onWelcome: (welcome, rejoined) => {
        hudRoom.textContent = welcome.room;
        recorder?.onWelcome(welcome.playerId, welcome.room, rejoined);
      },
      onSnapshot: (snapshot) => recorder?.onSnapshot(snapshot),
      onError: (code, message) => {
        lobbyStatus.textContent = message;
        recorder?.onError(code, message);
      },
    },
  );

  const readName = (): string | null => {
    const name = nameInput.value.trim();
    if (!isValidPlayerName(name)) {
      lobbyStatus.textContent = 'Name: 1–16 letters, digits, spaces, _ . -';
      return null;
    }
    savePref(`name.${config.instance}`, name);
    return name;
  };

  el<HTMLButtonElement>('create').addEventListener('click', () => {
    const name = readName();
    if (name) session.createRoom(serverInput.value.trim(), name);
  });
  el<HTMLButtonElement>('join').addEventListener('click', () => {
    const name = readName();
    const code = roomInput.value.trim().toUpperCase();
    if (!name) return;
    if (!isValidRoomCode(code)) {
      lobbyStatus.textContent = 'Room codes are 5 characters, e.g. K7QPX';
      return;
    }
    session.joinRoom(serverInput.value.trim(), name, code);
  });
  el<HTMLButtonElement>('leave').addEventListener('click', () => session.leave());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      overlay.toggle();
    } else if (e.code === 'Escape' && session.phase !== 'idle') {
      session.leave();
    }
  });

  showPhase('idle', 'Create a room, or join one with its code.');

  if (config.smoke) {
    const report = (payload: unknown): void => {
      if (window.veyrath) window.veyrath.smokeReport(payload);
      else console.log('SMOKE', JSON.stringify(payload));
    };
    recorder = new SmokeRecorder(config.smoke, session, report);
    inputSource = new Autopilot(session);
    overlay.toggle();
    runSmokeScript(config.smoke, session, recorder, config.serverUrl);
  }

  // Network metrics for the server's log (a timer, so it keeps reporting while minimized).
  setInterval(() => session.sendStats(frameMs.value ? 1000 / frameMs.value : 0), 5000);

  // ---- frame loop: rendering only. Input and networking run on their own timers. ----
  const frameMs = new Ema(0.05);
  const inRate = new CounterRate();
  const outRate = new CounterRate();
  let lastFrame = performance.now();
  let lastHud = 0;

  const frame = (now: number): void => {
    const dt = Math.min(250, now - lastFrame);
    lastFrame = now;
    frameMs.add(dt);
    recorder?.onFrame(dt);
    if (config.renderDelayMs > 0) {
      const until = performance.now() + config.renderDelayMs;
      while (performance.now() < until) {
        // Deliberately slow renderer (test option).
      }
    }

    const playing = session.phase === 'in_room' || session.phase === 'reconnecting';
    const view = playing ? session.snapshots.sample(now, INTERPOLATION_DELAY_TICKS) : null;
    renderer.draw(
      view && {
        ...view,
        localPlayerId: session.playerId,
        localPosition: session.predictor.renderPosition(dt),
      },
    );

    inRate.update(session.bytesReceived, now);
    outRate.update(session.bytesSent, now);
    const snap = session.lastSnapshot;
    const players = snap?.world.players ?? [];
    overlay.update(now, {
      phase: session.phase,
      room: session.welcome?.room ?? null,
      playerId: session.playerId,
      slot: session.welcome?.slot ?? null,
      players: players.length,
      connectedPlayers: players.filter((p) => p.connected).length,
      serverTick: snap?.world.tick ?? null,
      serverTickMs: snap?.tickMs ?? null,
      fps: frameMs.value ? 1000 / frameMs.value : 0,
      frameMs: frameMs.value ?? 0,
      rttMs: session.rtt.value,
      rttJitterMs: session.rttJitter.value,
      snapshotJitterMs: session.snapshotJitter.value,
      snapshotsPerSec: session.snapshotRate.perSecond(now),
      ack: snap?.ack ?? null,
      pendingInputs: session.predictor.pendingCount,
      bytesInPerSec: inRate.rate,
      bytesOutPerSec: outRate.rate,
      bytesInTotal: session.bytesReceived,
      bytesOutTotal: session.bytesSent,
      bufferedBytes: session.bufferedAmount,
      lastCorrection: session.predictor.lastCorrection,
      corrections: session.predictor.corrections,
      reconnects: session.reconnects,
      renderDelayMs: config.renderDelayMs,
    });

    if (playing && now - lastHud > 250) {
      lastHud = now;
      const quality = connectionQuality({
        phase: session.phase,
        rttMs: session.rtt.value,
        rttJitterMs: session.rttJitter.value,
        snapshotsPerSec: session.snapshotRate.perSecond(now),
        msSinceSnapshot: session.msSinceSnapshot,
      });
      hudQuality.dataset.level = quality.level;
      hudQualityLabel.textContent = quality.label;
      hudPlayers.replaceChildren(
        ...players.map((p) => {
          const li = document.createElement('li');
          li.textContent = `${p.name}${p.id === session.playerId ? ' (you)' : ''}${p.connected ? '' : ' — reconnecting'}`;
          li.className = `slot-${p.slot}`;
          return li;
        }),
      );
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  document.body.textContent = `Failed to start: ${String(err)}`;
});
