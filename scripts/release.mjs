// Builds a new auto-updating release of the game and puts it where your server hands it out.
//
//   npm run release -- --server=ws://100.x.y.z:7777     first time (remembers the address)
//   npm run release                                      afterwards
//   npm run release -- --version=0.3.0                  pick the version yourself
//
// Output in updates/: Veyrath-Setup-<version>.exe (send this once to a new player) and latest.yml.
// `npm run host` serves this folder, so installed games update themselves on their next start.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const desktop = resolve(root, 'apps/desktop');
// --out=DIR writes the release elsewhere (used by tests) and leaves updates/ untouched.
const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
const updatesDir = outArg ? resolve(outArg) : resolve(root, 'updates');
const serverFile = resolve(updatesDir, 'server.json');
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
}
const cmpVersion = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// ---- server address (baked into the build; also where updates are fetched from) ----------------
let serverUrl = arg('server');
if (!serverUrl && !outArg && existsSync(serverFile))
  serverUrl = JSON.parse(readFileSync(serverFile, 'utf8')).serverUrl;
if (!serverUrl) fail('first release needs --server=ws://<your Tailscale IP>:7777');
try {
  const u = new URL(serverUrl);
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error();
  serverUrl = u.href.replace(/\/$/, '');
} catch {
  fail(`--server must be a ws:// or wss:// URL, got "${serverUrl}"`);
}

// ---- version: one patch above the newest already released, unless given --------------------------
const base = parseVersion(
  JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8')).version,
);
let latest = base;
const latestYml = resolve(updatesDir, 'latest.yml');
if (existsSync(latestYml)) {
  const released = parseVersion(/^version:\s*(\S+)/m.exec(readFileSync(latestYml, 'utf8'))?.[1]);
  if (released && cmpVersion(released, latest) > 0) latest = released;
}
let version = arg('version');
if (version) {
  const v = parseVersion(version);
  if (!v) fail('--version must look like 1.2.3');
  if (cmpVersion(v, latest) <= 0) fail(`--version must be newer than ${latest.join('.')}`);
} else {
  version = `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
}

console.log(`release: building Veyrath ${version} for server ${serverUrl}`);

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed`);
}

run('npm', ['run', 'build']);
const bakedConfig = resolve(desktop, 'build/veyrath.config.json');
writeFileSync(bakedConfig, `${JSON.stringify({ serverUrl }, null, 2)}\n`);
try {
  run(
    'npx',
    [
      'electron-builder',
      '--win',
      'nsis',
      '--x64',
      '--config',
      'electron-builder.json',
      '--publish',
      'never',
      `-c.extraMetadata.version=${version}`,
    ],
    desktop,
  );
} finally {
  // The address belongs to this release only; dev builds must not pick it up.
  rmSync(bakedConfig, { force: true });
}

const installer = `Veyrath-Setup-${version}.exe`;
const release = resolve(desktop, 'release');
for (const f of [installer, `${installer}.blockmap`, 'latest.yml']) {
  if (!existsSync(resolve(release, f))) fail(`expected ${f} in ${release}`);
}
mkdirSync(updatesDir, { recursive: true });
copyFileSync(resolve(release, installer), resolve(updatesDir, installer));
copyFileSync(
  resolve(release, `${installer}.blockmap`),
  resolve(updatesDir, `${installer}.blockmap`),
);
// latest.yml last, so the server never advertises an installer that isn't there yet.
copyFileSync(resolve(release, 'latest.yml'), resolve(updatesDir, 'latest.yml'));
if (!outArg) writeFileSync(serverFile, `${JSON.stringify({ serverUrl }, null, 2)}\n`);

// Keep the two newest installers; older ones are never offered again.
const installers = readdirSync(updatesDir)
  .map((f) => ({ f, v: parseVersion(/^Veyrath-Setup-(.+)\.exe$/.exec(f)?.[1]) }))
  .filter((x) => x.v)
  .sort((a, b) => cmpVersion(b.v, a.v));
for (const { f } of installers.slice(2)) {
  rmSync(resolve(updatesDir, f), { force: true });
  rmSync(resolve(updatesDir, `${f}.blockmap`), { force: true });
}

console.log(`
release: Veyrath ${version} is ready.
  New player (first install only): send them  updates\\${installer}
  Everyone already installed: updates itself the next time they start the game
                              while you're hosting (npm run host).`);
