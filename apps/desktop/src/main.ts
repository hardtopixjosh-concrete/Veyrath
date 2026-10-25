import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { parseConfigFile, parseLaunchOptions, type LaunchOptions } from './options';
import { createUpdater, type UpdateStatus } from './updater';

// The host's server address comes from veyrath.config.json: one beside Veyrath.exe wins (zip
// builds), otherwise the one baked into the app by the release build (installer builds, which
// survives updates).
const configCandidates = [
  join(app.isPackaged ? dirname(process.execPath) : app.getAppPath(), 'veyrath.config.json'),
  join(__dirname, 'veyrath.config.json'),
];
const configPath = configCandidates.find((p) => existsSync(p)) ?? configCandidates[0]!;

let options: LaunchOptions;
try {
  const configText = existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined;
  options = parseLaunchOptions(process.argv, process.env, parseConfigFile(configText));
} catch (err) {
  console.error(`[veyrath] ${String(err)}`);
  // Safe before 'ready'; a double-clicked exe has no console to show the error in.
  dialog.showErrorBox(
    'Veyrath could not start',
    `${String(err)}

Config file: ${configPath}`,
  );
  process.exit(2);
}

// Separate profile per instance so two local clients never contend for the same cache/storage.
app.setPath('userData', join(app.getPath('userData'), `instance-${options.instance}`));
// A minimized or unfocused window must keep its network + input timers running at full rate.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const rendererIndex = join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(rendererIndex).href;
const smoke = options.smoke;

// Main-process log in the profile folder: an installed game has no console, so this is the only
// record of what happened on a friend's PC. Started fresh each launch once it passes 1 MB.
const mainLogFile = join(app.getPath('userData'), 'main.log');
try {
  if (existsSync(mainLogFile) && statSync(mainLogFile).size > 1024 * 1024) rmSync(mainLogFile);
} catch {
  // best effort
}

function log(line: string): void {
  console.log(`[veyrath:${options.instance}] ${line}`);
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(
      mainLogFile,
      `${new Date().toISOString()} pid=${process.pid} ${line}
`,
    );
  } catch {
    // best effort
  }
}

process.on('uncaughtException', (err) => {
  log(`uncaught exception: ${err.stack ?? String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandled rejection: ${String(reason)}`);
});
log(
  `launched v${app.getVersion()} packaged=${app.isPackaged} args: ${process.argv.slice(1).join(' ')}`,
);
app.on('will-quit', () => log('quitting'));

function smokeWrite(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ...entry, instance: options.instance, at: Date.now() });
  console.log(`SMOKE ${line}`);
  if (smoke?.outFile) appendFileSync(smoke.outFile, `${line}\n`);
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.pathname === new URL(rendererUrl).pathname;
  } catch {
    return false;
  }
}

let mainWindow: BrowserWindow | null = null;
let lastUpdateStatus: UpdateStatus | null = null;

function sendUpdateStatus(status: UpdateStatus): void {
  lastUpdateStatus = status;
  log(`update: ${JSON.stringify(status)}`);
  mainWindow?.webContents.send('veyrath:update-status', status);
}

// Only installed (packaged) builds update themselves; dev runs and scripted smoke runs never do.
let updater: ReturnType<typeof createUpdater> | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 940,
    height: 680,
    x: 20 + (options.instance - 1) * 960,
    y: 40,
    title: `Veyrath — P${options.instance}`,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged || options.devtools,
    },
  });
  win.once('ready-to-show', () => {
    log('window ready');
    win.show();
  });
  win.webContents.on('did-fail-load', (_e, code, description) => {
    log(`page failed to load: ${code} ${description}`);
  });

  // Only our bundled page may ever load in this window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (smoke) {
      smokeWrite({ type: 'crash', reason: details.reason });
      app.exit(4);
    }
  });

  if (smoke?.minimizeAtMs != null) {
    const { minimizeAtMs, minimizeForMs } = smoke;
    setTimeout(() => {
      win.minimize();
      smokeWrite({ type: 'window', event: 'minimize', minimized: win.isMinimized() });
      setTimeout(() => {
        smokeWrite({ type: 'window', event: 'restore', minimized: win.isMinimized() });
        win.restore();
      }, minimizeForMs);
    }, minimizeAtMs);
  }

  if (smoke?.screenshotAtMs != null && smoke.outFile) {
    const file = smoke.outFile.replace(/\.jsonl$/, '') + '.png';
    setTimeout(() => {
      win.webContents.capturePage().then(
        (image) => {
          writeFileSync(file, image.toPNG());
          smokeWrite({ type: 'screenshot', file });
        },
        (err: unknown) => smokeWrite({ type: 'screenshot', error: String(err) }),
      );
    }, smoke.screenshotAtMs);
  }

  win.webContents.on('did-finish-load', () => {
    if (lastUpdateStatus) win.webContents.send('veyrath:update-status', lastUpdateStatus);
  });

  void win.loadFile(rendererIndex);
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  if (app.isPackaged && !smoke && !options.noUpdate) {
    updater = createUpdater({
      serverUrl: options.serverUrl,
      currentVersion: app.getVersion(),
      logFile: join(app.getPath('userData'), 'updater.log'),
      send: sendUpdateStatus,
    });
  }
  // Everything is denied except writing text to the clipboard (copying the room code).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write'),
  );

  ipcMain.handle('veyrath:get-config', (event) => {
    if (!isTrustedSender(event)) throw new Error('untrusted sender');
    return {
      serverUrl: options.serverUrl,
      instance: options.instance,
      appVersion: app.getVersion(),
      updatesEnabled: updater !== null,
      renderDelayMs: options.renderDelayMs,
      smoke: smoke && {
        role: smoke.role,
        room: smoke.room,
        durationMs: smoke.durationMs,
        dropAtMs: smoke.dropAtMs,
        leaveAtMs: smoke.leaveAtMs,
      },
    };
  });

  // The renderer may ask for a re-check (e.g. after the server says its version is newer). It
  // can't choose where updates come from: the feed is fixed in main from the config file.
  ipcMain.on('veyrath:check-for-updates', (event) => {
    if (!isTrustedSender(event)) return;
    updater?.check();
  });

  ipcMain.on('veyrath:smoke-report', (event, payload: unknown) => {
    if (!smoke || !isTrustedSender(event)) return;
    if (typeof payload !== 'object' || payload === null) return;
    const text = JSON.stringify(payload);
    if (text.length > 512 * 1024) return;
    smokeWrite(payload as Record<string, unknown>);
    if ((payload as { type?: unknown }).type === 'final') setTimeout(() => app.quit(), 300);
  });

  if (smoke) {
    // Never leave a stuck window behind if the scripted run hangs.
    setTimeout(() => {
      smokeWrite({ type: 'timeout' });
      app.exit(3);
    }, smoke.durationMs + 30_000);
  }

  log(
    `starting v${app.getVersion()} (server ${options.serverUrl}${smoke ? `, smoke ${smoke.role}` : ''})`,
  );
  createWindow();
  updater?.check();
});

app.on('window-all-closed', () => app.quit());
