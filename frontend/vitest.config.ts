import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Same as vite.config.ts: allow a linked (shared) node_modules, whose real path
// lies outside this project, so `?worker&url` imports are not denied.
const FS_ALLOW = [
  searchForWorkspaceRoot(__dirname),
  fs.realpathSync(path.resolve(__dirname, 'node_modules')),
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      allow: FS_ALLOW,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // maplibre-gl and deck.gl enlarge the module graph; under full parallelism
    // the one-time transform cost can push individual tests past the 5s default,
    // so give them more headroom to avoid load-induced timeout flakes.
    testTimeout: 20000,
  },
});
