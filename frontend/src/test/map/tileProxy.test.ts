import { afterEach, describe, expect, it } from 'vitest';
import { proxiedUrl, setTileProxyConfig, transformTileRequest } from '../../map/engine/tileProxy';
import type { TileCacheSource } from '../../types';

function source(overrides: Partial<TileCacheSource>): TileCacheSource {
  return {
    id: 'x',
    label: 'X',
    client_prefixes: [],
    proxy: true,
    predownload: false,
    max_zoom: 19,
    policy_url: 'https://example.org/policy',
    ...overrides,
  };
}

const SOURCES: TileCacheSource[] = [
  source({ id: 'ofm', client_prefixes: ['https://tiles.openfreemap.org/'] }),
  source({
    id: 'osm',
    client_prefixes: ['https://tile.openstreetmap.org/', 'https://a.tile.openstreetmap.org/'],
  }),
  source({ id: 'esri', client_prefixes: ['https://server.arcgisonline.com/'], proxy: false }),
];

const PROXY = new URL('./api/tiles/proxy/', document.baseURI).href;

afterEach(() => setTileProxyConfig(null));

describe('tileProxy', () => {
  it('leaves every URL alone while the cache is off', () => {
    setTileProxyConfig({ enabled: false, sources: SOURCES });
    expect(proxiedUrl('https://tiles.openfreemap.org/styles/dark')).toBe(
      'https://tiles.openfreemap.org/styles/dark'
    );
  });

  it('rewrites allow-listed prefixes to the backend proxy when on', () => {
    setTileProxyConfig({ enabled: true, sources: SOURCES });
    expect(proxiedUrl('https://tiles.openfreemap.org/styles/dark')).toBe(PROXY + 'ofm/styles/dark');
    expect(proxiedUrl('https://a.tile.openstreetmap.org/3/1/2.png')).toBe(PROXY + 'osm/3/1/2.png');
    expect(
      transformTileRequest('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf')
        .url
    ).toBe(PROXY + 'ofm/fonts/Noto%20Sans%20Regular/0-255.pbf');
  });

  it('never rewrites sources whose terms forbid caching, or unknown hosts', () => {
    setTileProxyConfig({ enabled: true, sources: SOURCES });
    const esri =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0';
    expect(proxiedUrl(esri)).toBe(esri);
    expect(proxiedUrl('https://example.com/1/0/0.png')).toBe('https://example.com/1/0/0.png');
  });

  it('sends URLs with a query string direct', () => {
    setTileProxyConfig({ enabled: true, sources: SOURCES });
    const url = 'https://tile.openstreetmap.org/3/1/2.png?v=1';
    expect(proxiedUrl(url)).toBe(url);
  });
});
