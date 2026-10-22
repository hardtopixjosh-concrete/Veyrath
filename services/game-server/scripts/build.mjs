// Bundles the server (and the workspace packages it imports) into one file runnable with plain Node.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(root, 'dist/veyrath-server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  // Optional native accelerators that `ws` probes for at runtime.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});
console.log('built services/game-server/dist/veyrath-server.cjs');
