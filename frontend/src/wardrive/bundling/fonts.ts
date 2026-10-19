// Build plugin for the wardrive page: the app's fonts live in public/fonts and
// its CSS points at /fonts/, a path behind the main Basic login. This build
// ships its own copies under /wardrive/fonts/ and points the CSS there (the
// CSS is in assets/, so ../fonts/).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** `fontsDir`: the app's public/fonts folder. */
export function wardriveFonts(fontsDir: string): Plugin {
  return {
    name: 'wardrive-fonts',
    transform(code, id) {
      if (!/\.css($|\?)/.test(id) || !code.includes('/fonts/')) return null;
      return { code: code.replace(/url\((['"]?)\/fonts\//g, 'url($1../fonts/'), map: null };
    },
    generateBundle() {
      for (const name of readdirSync(fontsDir)) {
        if (!name.endsWith('.woff2')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `fonts/${name}`,
          source: readFileSync(path.join(fontsDir, name)),
        });
      }
    },
  };
}
