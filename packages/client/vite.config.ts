import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build loads from file:// inside the packaged Electron app.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
