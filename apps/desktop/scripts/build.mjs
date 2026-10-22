// Builds everything the desktop app ships: the renderer (Vite) and the main/preload bundles (esbuild).
import { build as esbuild } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = resolve(desktop, '../../packages/client');
const out = resolve(desktop, 'build');

await viteBuild({
  root: clientRoot,
  configFile: resolve(clientRoot, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: resolve(out, 'renderer'), emptyOutDir: true },
});

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
};
await esbuild({
  ...common,
  entryPoints: [resolve(desktop, 'src/main.ts')],
  outfile: resolve(out, 'main.cjs'),
});
await esbuild({
  ...common,
  entryPoints: [resolve(desktop, 'src/preload.ts')],
  outfile: resolve(out, 'preload.cjs'),
});
console.log('built apps/desktop/build (renderer, main.cjs, preload.cjs)');
