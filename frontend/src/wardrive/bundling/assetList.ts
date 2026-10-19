// Build plugin for the wardrive page: writes assets.json, the list of this
// build's files under assets/ and fonts/ (source maps left out). The service worker
// caches the page together with every file on the list (so lazily loaded
// chunks, the map or a language, work offline too) and drops the rest, so
// files of older builds do not pile up in the phone's storage.
import type { Plugin } from 'vite';

export const ASSET_LIST_FILE = 'assets.json';

export function wardriveAssetList(): Plugin {
  return {
    name: 'wardrive-asset-list',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .map((item) => item.fileName)
        .filter(
          (name) =>
            (name.startsWith('assets/') || name.startsWith('fonts/')) && !name.endsWith('.map')
        )
        .sort();
      this.emitFile({
        type: 'asset',
        fileName: ASSET_LIST_FILE,
        source: JSON.stringify({ assets }),
      });
    },
  };
}
