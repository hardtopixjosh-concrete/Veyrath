import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// Friend builds ship a veyrath.config.json beside Veyrath.exe naming the host's server.
const configPath = join(
  app.isPackaged ? dirname(process.execPath) : app.getAppPath(),
  'veyrath.config.json',
);

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

function log(line: string): void {
  console.log(`[veyrath:${options.instance}] ${line}`);
}

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
  win.once('ready-to-show', () => win.show());

  // Only our bundled page may ever load in this window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason}`);
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

  void win.loadFile(rendererIndex);
  return win;
}

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  ipcMain.handle('veyrath:get-config', (event) => {
    if (!isTrustedSender(event)) throw new Error('untrusted sender');
    return {
      serverUrl: options.serverUrl,
      instance: options.instance,
      appVersion: app.getVersion(),
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

  log(`starting (server ${options.serverUrl}${smoke ? `, smoke ${smoke.role}` : ''})`);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
