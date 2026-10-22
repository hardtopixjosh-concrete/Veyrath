// Builds the zip you send to a friend: the packaged client preconfigured with your server address.
// Usage (after npm run package:win):  node scripts/package-friend.mjs --server=ws://100.x.y.z:7777
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { packagedExe, root } from './lib.mjs';

const server = process.argv.find((a) => a.startsWith('--server='))?.slice('--server='.length);
if (!server) {
  console.error('Usage: node scripts/package-friend.mjs --server=ws://<host tailscale ip>:7777');
  process.exit(1);
}
let url;
try {
  url = new URL(server);
} catch {
  url = null;
}
if (!url || (url.protocol !== 'ws:' && url.protocol !== 'wss:')) {
  console.error(`--server must be a ws:// or wss:// URL, got "${server}"`);
  process.exit(1);
}
if (!existsSync(packagedExe)) {
  console.error(`Missing ${packagedExe}. Run npm run package:win first.`);
  process.exit(1);
}

const release = resolve(root, 'apps/desktop/release');
const stage = resolve(release, 'friend', 'Veyrath');
const zip = resolve(release, 'Veyrath-friend.zip');
rmSync(resolve(release, 'friend'), { recursive: true, force: true });
rmSync(zip, { force: true });
cpSync(dirname(packagedExe), stage, { recursive: true });

const serverUrl = url.href.replace(/\/$/, '');
writeFileSync(resolve(stage, 'veyrath.config.json'), `${JSON.stringify({ serverUrl }, null, 2)}\n`);
writeFileSync(
  resolve(stage, 'HOW TO PLAY.txt'),
  [
    'Veyrath — friend test build',
    '',
    '1. Make sure Tailscale is running and you are signed in to the shared network.',
    '2. Unzip this whole folder somewhere (e.g. Desktop) and run Veyrath.exe.',
    '   Windows SmartScreen may warn about an unrecognized app: More info -> Run anyway.',
    `3. The Server box is already set to ${serverUrl}`,
    '4. Type the room code your host gives you and click Join room.',
    '',
    'Controls: WASD / arrows move, Space or J attack, F3 debug overlay, Esc leave.',
    'If you get disconnected the game reconnects by itself for 15 seconds.',
    '',
  ].join('\r\n'),
);

const ps = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${resolve(release, 'friend', 'Veyrath')}' -DestinationPath '${zip}' -Force`,
  ],
  { stdio: 'inherit' },
);
if (ps.status !== 0) {
  console.error('Compress-Archive failed');
  process.exit(1);
}
console.log(`\nFriend build: ${zip}`);
console.log(`Preconfigured server: ${serverUrl}`);
