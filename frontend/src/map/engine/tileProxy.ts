import type { RequestParameters } from 'maplibre-gl';
import { api } from '../../api';
import type { TileCacheConfig } from '../../types';

// Backend tile cache routing. When the cache is on, map requests (styles,
// TileJSON, tiles, sprites, glyphs) whose URL starts with an allow-listed
// upstream prefix are sent to the backend proxy instead, which caches them on
// disk for every browser. The prefix list comes from the backend
// (GET /api/tiles/config), so the server's allow-list stays the single source
// of truth. Sources whose terms forbid caching (Esri) have proxy=false and are
// never rewritten.

interface ProxyRule {
  prefix: string;
  source: string;
}

let enabled = false;
let rules: ProxyRule[] = [];
let loading: Promise<void> | null = null;

export function setTileProxyConfig(
  cfg: Pick<TileCacheConfig, 'enabled' | 'sources'> | null | undefined
): void {
  enabled = !!cfg?.enabled;
  rules = cfg
    ? cfg.sources
        .filter((s) => s.proxy)
        .flatMap((s) => s.client_prefixes.map((prefix) => ({ prefix, source: s.id })))
    : [];
}

/** Fetch the tile cache config once per page load (retried after a failure). */
export function loadTileProxyConfig(): Promise<void> {
  if (!loading) {
    loading = api
      .getTileCacheConfig()
      .then(setTileProxyConfig)
      .catch((err: unknown) => {
        loading = null;
        console.warn('Tile cache config unavailable; map tiles load directly.', err);
      });
  }
  return loading;
}

/** The proxy URL for an allow-listed upstream URL, else the URL unchanged. */
export function proxiedUrl(url: string): string {
  if (!enabled) return url;
  for (const rule of rules) {
    if (!url.startsWith(rule.prefix)) continue;
    const rest = url.slice(rule.prefix.length);
    // The proxy takes a bare path; anything with a query goes direct.
    if (!rest || rest.includes('?') || rest.includes('#')) return url;
    const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
    return new URL(`./api/tiles/proxy/${rule.source}/${rest}`, base).href;
  }
  return url;
}

/** MapLibre `transformRequest` hook. */
export function transformTileRequest(url: string): RequestParameters {
  return { url: proxiedUrl(url) };
}
