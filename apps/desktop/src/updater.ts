import { appendFileSync } from 'node:fs';
import { autoUpdater } from 'electron-updater';

/** What the renderer is told; it only ever displays this. */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'up-to-date'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'installing'; version: string }
  | { state: 'unavailable'; reason: string };

export interface UpdaterOptions {
  /** The game server URL (ws:// or wss://). Updates are fetched from the same host and port. */
  serverUrl: string;
  currentVersion: string;
  logFile: string;
  send: (status: UpdateStatus) => void;
}

/** ws://host:port → http://host:port/updates/ (wss → https). */
export function updateFeedUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/updates/';
  url.search = '';
  url.hash = '';
  return url.href;
}

/**
 * Auto-update from the host's game server. The feed is pinned to the configured server URL at
 * startup and never taken from the renderer, so the page can't point the updater elsewhere.
 * electron-updater checks the installer's SHA-512 from latest.yml before running it.
 */
export function createUpdater(opts: UpdaterOptions): { check(): void } {
  const write = (line: string): void => {
    try {
      appendFileSync(opts.logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // logging is best effort
    }
  };
  const logger = {
    info: (m: unknown) => write(`INFO ${String(m)}`),
    warn: (m: unknown) => write(`WARN ${String(m)}`),
    error: (m: unknown) => write(`ERROR ${String(m)}`),
    debug: (m: unknown) => write(`DEBUG ${String(m)}`),
  };

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // Full downloads only: the game server serves whole files and doesn't support range requests.
  autoUpdater.disableDifferentialDownload = true;
  const feed = updateFeedUrl(opts.serverUrl);
  autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  write(`feed ${feed}, current version ${opts.currentVersion}`);

  let busy = false;
  let installing = false;
  let pendingVersion = '';

  autoUpdater.on('checking-for-update', () => opts.send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => {
    busy = false;
    opts.send({ state: 'up-to-date', version: opts.currentVersion });
  });
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version;
    write(`update available: ${info.version}`);
    opts.send({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    opts.send({ state: 'downloading', version: pendingVersion, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    installing = true;
    write(`downloaded ${info.version}; installing`);
    opts.send({ state: 'installing', version: info.version });
    // Give the renderer a moment to show "Installing…", then run the installer silently and
    // relaunch the game when it finishes.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
  });
  autoUpdater.on('error', (err) => {
    busy = false;
    if (installing) return;
    write(`error: ${err.message}`);
    opts.send({ state: 'unavailable', reason: 'Update server not reachable' });
  });

  return {
    check() {
      if (busy || installing) return;
      busy = true;
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        busy = false;
        write(`check failed: ${String(err)}`);
        opts.send({ state: 'unavailable', reason: 'Update server not reachable' });
      });
    },
  };
}
