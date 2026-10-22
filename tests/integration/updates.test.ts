import { GameServer } from '@veyrath/game-server';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { updateFeedUrl } from '../../apps/desktop/src/updater';

let dir: string;
let server: GameServer | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'veyrath-updates-'));
  writeFileSync(join(dir, 'latest.yml'), 'version: 0.1.1\npath: Veyrath-Setup-0.1.1.exe\n');
  writeFileSync(join(dir, 'Veyrath-Setup-0.1.1.exe'), Buffer.alloc(40 * 1024 * 1024, 7));
  writeFileSync(join(dir, 'secret.txt'), 'not an update file');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

afterEach(async () => {
  await server?.stop();
  server = null;
});

async function start(updatesDir: string | undefined): Promise<string> {
  server = new GameServer({ host: '127.0.0.1', port: 0, updatesDir });
  const { port } = await server.start();
  return `http://127.0.0.1:${port}`;
}

describe('update feed URL', () => {
  it('maps the game server address to its /updates/ folder', () => {
    expect(updateFeedUrl('ws://100.96.171.24:7777')).toBe('http://100.96.171.24:7777/updates/');
    expect(updateFeedUrl('wss://game.example:443/')).toBe('https://game.example/updates/');
  });
});

describe('serving update files', () => {
  it('serves latest.yml (ignoring cache-busting query strings) and the installer', async () => {
    const base = await start(dir);
    const yml = await fetch(`${base}/updates/latest.yml?noCache=abc`);
    expect(yml.status).toBe(200);
    expect(await yml.text()).toContain('version: 0.1.1');
    const head = await fetch(`${base}/updates/Veyrath-Setup-0.1.1.exe`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(40 * 1024 * 1024));
  });

  it.each([
    '/updates/secret.txt',
    '/updates/..%2Fpackage.json',
    '/updates/../package.json',
    '/updates/%2e%2e%5cwindows.exe',
    '/updates/sub/latest.yml',
    '/updates/',
    '/updates/missing.exe',
  ])('refuses %s', async (path) => {
    const base = await start(dir);
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(404);
  });

  it('serves nothing when no updates folder is configured', async () => {
    const base = await start(undefined);
    expect((await fetch(`${base}/updates/latest.yml`)).status).toBe(404);
  });

  it('does not accept uploads', async () => {
    const base = await start(dir);
    const res = await fetch(`${base}/updates/latest.yml`, {
      method: 'POST',
      body: 'version: 9.9.9',
    });
    expect(res.status).toBe(404);
  });

  it('keeps ticking at full rate while a large installer downloads', async () => {
    const base = await start(dir);
    const before = server!.getStats().ticks;
    const started = performance.now();
    const res = await fetch(`${base}/updates/Veyrath-Setup-0.1.1.exe`);
    const body = await res.arrayBuffer();
    // Measure over at least one second so the rate is meaningful.
    const elapsed = Math.max(1000, performance.now() - started);
    if (elapsed > performance.now() - started) {
      await new Promise((r) => setTimeout(r, elapsed - (performance.now() - started)));
    }
    const ticks = server!.getStats().ticks - before;
    expect(body.byteLength).toBe(40 * 1024 * 1024);
    expect(ticks / ((performance.now() - started) / 1000)).toBeGreaterThan(27);
    expect(server!.getStats().maxTickMs).toBeLessThan(20);
  });
});
