import { describe, expect, it, vi } from 'vitest';

import { wardriveAssetList } from '../../wardrive/bundling/assetList';

describe('wardrive build asset list', () => {
  it('lists every file under assets/ for the service worker', () => {
    const plugin = wardriveAssetList();
    const emitFile = vi.fn();
    const bundle = {
      'assets/wardrive-abc.js': { fileName: 'assets/wardrive-abc.js' },
      'assets/wardrive-abc.js.map': { fileName: 'assets/wardrive-abc.js.map' },
      'assets/nl-def.js': { fileName: 'assets/nl-def.js' },
      'wardrive.html': { fileName: 'wardrive.html' },
      'fonts/figtree-latin.woff2': { fileName: 'fonts/figtree-latin.woff2' },
    };
    (plugin.generateBundle as (this: unknown, o: unknown, b: unknown) => void).call(
      { emitFile },
      {},
      bundle
    );
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'assets.json',
      source: JSON.stringify({
        assets: ['assets/nl-def.js', 'assets/wardrive-abc.js', 'fonts/figtree-latin.woff2'],
      }),
    });
  });
});
