// Shared helpers for the launcher scripts (local play, smoke test).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const serverBundle = resolve(root, 'services/game-server/dist/veyrath-server.cjs');
export const packagedExe = resolve(root, 'apps/desktop/release/win-unpacked/Veyrath.exe');
export const packagedServer = resolve(root, 'apps/desktop/release/server/veyrath-server.cjs');

/** Command + leading args that start the desktop client (dev build or packaged exe). */
export function clientCommand(packaged) {
  if (packaged) {
    if (!existsSync(packagedExe))
      throw new Error(`missing ${packagedExe} — run npm run package:win`);
    return { cmd: packagedExe, args: [] };
  }
  const electron = createRequire(import.meta.url)('electron');
  return { cmd: electron, args: [resolve(root, 'apps/desktop')] };
}

function prefixLines(stream, prefix, sink) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) sink(`${prefix} ${line}`);
  });
}

export function startProcess(name, cmd, args, { env = {}, onLine = console.log } = {}) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  prefixLines(child.stdout, `[${name}]`, onLine);
  prefixLines(child.stderr, `[${name}]`, onLine);
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}

/** Starts the bundled server and resolves once it logs that it is listening. */
export async function startServer({ port, bundle = serverBundle, env = {}, onLine = console.log }) {
  if (!existsSync(bundle)) throw new Error(`missing ${bundle} — run npm run build:server`);
  let ready;
  const listening = new Promise((r) => (ready = r));
  const child = startProcess('server', process.execPath, [bundle], {
    env: { VEYRATH_PORT: String(port), ...env },
    onLine: (line) => {
      onLine(line);
      if (line.includes(' listening ')) ready();
    },
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('server did not start within 10 s')), 10_000),
  );
  await Promise.race([
    listening,
    timeout,
    child.exited.then((c) => Promise.reject(new Error(`server exited (${c})`))),
  ]);
  return child;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
