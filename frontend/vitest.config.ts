import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
