// Puts the standalone server bundle next to the packaged client so a test build is self-contained.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { packagedServer, serverBundle } from './lib.mjs';

if (!existsSync(serverBundle)) throw new Error(`missing ${serverBundle}`);
mkdirSync(dirname(packagedServer), { recursive: true });
copyFileSync(serverBundle, packagedServer);
writeFileSync(
  `${dirname(packagedServer)}/README.txt`,
  [
    'Veyrath game server (Milestone 1 test build)',
    '',
    'Requires Node.js 22.12+.',
    '  node veyrath-server.cjs',
    'Environment: VEYRATH_HOST (default 127.0.0.1; 0.0.0.0 for LAN/Tailscale), VEYRATH_PORT (7777).',
    'Health check: http://<host>:<port>/health',
    '',
  ].join('\r\n'),
);
console.log(`copied server bundle to ${packagedServer}`);
