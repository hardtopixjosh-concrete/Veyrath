import { validateContent } from '@veyrath/content';
import { isValidPlayerName, isValidRoomCode } from '@veyrath/protocol';
import { DEFAULT_SIM_CONFIG } from '@veyrath/sim';
import { loadClientConfig } from './config';
import { KeyboardInput } from './input';
import alchemistContent from '../../../content/heroes/alchemist.json';
import { HeroLayer, type HeroDraw } from './heroes3d';
import { CounterRate, Ema } from './metrics';
import { GameSession, type InputSource, type SessionPhase } from './net/session';
import { createWebSocketTransport } from './net/transport';
import { DebugOverlay } from './overlay';
import { connectionQuality } from './quality';
import { Renderer } from './render';
import { ResumeStore, browserStorage } from './resume';
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

const IDLE_TEXT = 'Create a room, or join one with its code.';
const LOADING_TEXT = 'Loading hero…';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for when the async clipboard API is unavailable.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
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
  const updateStatus = el<HTMLParagraphElement>('update-status');
  el<HTMLParagraphElement>('version').textContent =
    `Test build · v${config.appVersion}${config.updatesEnabled ? ' · auto-updates on' : ''}`;
  /** True while an update downloads or installs: joining now would just be interrupted. */
  let updating = false;
  let currentPhase: SessionPhase = 'idle';
  const refreshLobbyButtons = (): void => {
    for (const button of lobby.querySelectorAll('button')) {
      button.disabled = currentPhase === 'connecting' || updating || heroLoading;
    }
  };
  const hudQuality = el<HTMLDivElement>('hud-quality');
  const hudQualityLabel = el<HTMLSpanElement>('hud-quality-label');

  nameInput.value = loadPref(`name.${config.instance}`) ?? `Player${config.instance}`;
  serverInput.value = config.serverUrl;
  // Pre-fill the last room so rejoining after a restart is one click.
  roomInput.value = loadPref(`lastRoom.${config.instance}`) ?? '';
  const resume = new ResumeStore(
    config.smoke ? null : browserStorage(),
    `veyrath.resume.${config.instance}`,
  );
  let resuming = false;
  const RESUME_FAILED_TEXT = 'Your last game ended. Click Join room to go back in.';
  let resumeFailed = false;

  const renderer = new Renderer(el<HTMLCanvasElement>('game'), DEFAULT_SIM_CONFIG);
  // Every player is drawn as the hero model from its content file; circles until it has loaded.
  const heroLayer = new HeroLayer(el<HTMLCanvasElement>('heroes'));
  const hero = validateContent(alchemistContent);
  if (!hero.ok) console.warn('hero content invalid', hero.errors);
  const model = hero.ok ? hero.def.presentation.model : undefined;
  // Joining waits for the hero model (at most 8 s), so loading never stalls the game in a room.
  let heroLoading = Boolean(model);
  const heroLoaded: Promise<void> = model
    ? Promise.race([
        heroLayer.load(model, new URL('./assets/', document.baseURI)),
        new Promise<void>((r) => setTimeout(r, 8000)),
      ]).then(() => {
        heroLoading = false;
        refreshLobbyButtons();
        if (lobbyStatus.textContent === LOADING_TEXT) lobbyStatus.textContent = IDLE_TEXT;
      })
    : Promise.resolve();
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
    currentPhase = phase;
    refreshLobbyButtons();
  };

  const session = new GameSession(
    createWebSocketTransport,
    { sample: () => inputSource.sample() },
    {
      onPhase: (phase, detail) => {
        keyboard.enabled = phase === 'in_room';
        // Leaving, being kicked, or giving up on a lost connection: there's nothing to resume.
        if (phase === 'idle') resume.clear();
        showPhase(phase, resumeFailed && phase === 'idle' ? RESUME_FAILED_TEXT : detail);
        resumeFailed = false;
        recorder?.onPhase(phase);
      },
      onWelcome: (welcome, rejoined) => {
        hudRoom.textContent = welcome.room;
        resuming = false;
        roomInput.value = welcome.room;
        savePref(`lastRoom.${config.instance}`, welcome.room);
        resume.save({
          url: session.serverUrl,
          room: welcome.room,
          playerId: welcome.playerId,
          token: welcome.token,
          graceMs: welcome.reconnectGraceMs,
        });
        recorder?.onWelcome(welcome.playerId, welcome.room, rejoined);
      },
      onSnapshot: (snapshot) => recorder?.onSnapshot(snapshot),
      onError: (code, message) => {
        lobbyStatus.textContent = message;
        if (resuming && code === 'rejoin_failed') {
          resuming = false;
          resumeFailed = true;
          lobbyStatus.textContent = RESUME_FAILED_TEXT;
        }
        recorder?.onError(code, message);
        if (code === 'version_mismatch' && config.updatesEnabled) {
          lobbyStatus.textContent = 'Your game is older than the host’s. Updating…';
          window.veyrath?.checkForUpdates?.();
        }
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

  showPhase('idle', heroLoading ? LOADING_TEXT : IDLE_TEXT);

  // Reopened within the server's grace time? Come back as the same player.
  const ticket = resume.loadUsable();
  if (ticket) {
    resuming = true;
    lobbyStatus.textContent = `Resuming your game in room ${ticket.room}…`;
    void heroLoaded.then(() =>
      session.resume(ticket.url, ticket.room, ticket.playerId, ticket.token),
    );
  }
  // While connected, keep the ticket's timestamp fresh (wall clock, so it survives a restart).
  setInterval(() => {
    if (session.phase === 'in_room') resume.touch();
  }, 1000);

  // Click the room code to copy it for sharing.
  hudRoom.addEventListener('click', () => {
    const code = hudRoom.textContent ?? '';
    if (!isValidRoomCode(code)) return;
    void copyText(code).then((ok) => {
      hudStatus.textContent = ok ? 'code copied ✓' : 'copy failed';
      setTimeout(() => {
        if (session.phase === 'in_room') hudStatus.textContent = 'connected';
      }, 1500);
    });
  });

  let hideUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  window.veyrath?.onUpdateStatus?.((status) => {
    if (hideUpdateTimer) clearTimeout(hideUpdateTimer);
    updating = status.state === 'downloading' || status.state === 'installing';
    updateStatus.hidden = false;
    updateStatus.dataset.state = status.state;
    switch (status.state) {
      case 'checking':
        updateStatus.textContent = 'Checking for updates…';
        break;
      case 'up-to-date':
        updateStatus.textContent = `Up to date (v${status.version})`;
        hideUpdateTimer = setTimeout(() => (updateStatus.hidden = true), 4000);
        break;
      case 'downloading':
        updateStatus.textContent = `Downloading update v${status.version}… ${status.percent}%`;
        break;
      case 'installing':
        updateStatus.textContent = `Installing v${status.version}… the game will restart.`;
        break;
      case 'unavailable':
        // Host offline is normal; say so quietly and let them play.
        updateStatus.textContent = 'Update check skipped (host server not running).';
        hideUpdateTimer = setTimeout(() => (updateStatus.hidden = true), 6000);
        break;
    }
    refreshLobbyButtons();
  });

  if (config.smoke) {
    const report = (payload: unknown): void => {
      if (window.veyrath) window.veyrath.smokeReport(payload);
      else console.log('SMOKE', JSON.stringify(payload));
    };
    recorder = new SmokeRecorder(config.smoke, session, report);
    inputSource = new Autopilot(session);
    overlay.toggle();
    const smoke = config.smoke;
    void heroLoaded.then(() => runSmokeScript(smoke, session, recorder!, config.serverUrl));
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
    const localPosition = session.predictor.renderPosition(dt, now);
    renderer.draw(
      view && {
        ...view,
        localPlayerId: session.playerId,
        localPosition,
        localSwingAgeMs: session.predictor.swingAgeMs(now),
        modelHeroes: heroLayer.ready,
      },
    );
    const heroDraws: HeroDraw[] = (view?.players ?? []).map((p) => {
      const isLocal = p.id === session.playerId;
      const pos = isLocal && localPosition ? localPosition : p;
      return {
        id: p.id,
        x: pos.x,
        y: pos.y,
        connected: p.connected,
        swingKey: isLocal
          ? session.predictor.swingStartedAt
          : p.lastAttackTick >= 0
            ? p.lastAttackTick
            : null,
      };
    });
    heroLayer.update(heroDraws, renderer.transform, now, dt);

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
