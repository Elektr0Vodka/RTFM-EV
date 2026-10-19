import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { wardriveAssetList } from './src/wardrive/bundling/assetList';
import { wardriveFonts } from './src/wardrive/bundling/fonts';

// The wardrive page (MESHCORE_WARDRIVE) is its own build in dist/wardrive/.
// Every file it loads must live under /wardrive/, the prefix the main Basic
// login lets through; the main app's /assets/ stays behind that login. Hence
// a separate output folder, relative asset paths and its own public folder
// (the service worker), instead of a second input of the main build.

// The page loads its language on its own (src/wardrive/pageI18n.tsx). The main
// app's I18nProvider imports every catalog, and shared code reaches it through
// src/i18n/index.ts, so in this build that one import points at a stub: Dutch
// and German then become chunks of their own instead of riding in the bundle.
function wardriveI18nOnly(): Plugin {
  const stub = path.resolve(import.meta.dirname, 'src/wardrive/i18nProviderStub.tsx');
  return {
    name: 'wardrive-i18n-only',
    enforce: 'pre',
    resolveId(source, importer) {
      const fromIndex = !!importer && /[\\/]src[\\/]i18n[\\/]index\.ts$/.test(importer);
      if (source === './I18nProvider' && fromIndex) {
        return stub;
      }
      return null;
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: 'wardrive-public',
  plugins: [
    react(),
    wardriveI18nOnly(),
    wardriveFonts(path.resolve(import.meta.dirname, 'public/fonts')),
    wardriveAssetList(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist/wardrive',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'wardrive.html'),
    },
  },
});
