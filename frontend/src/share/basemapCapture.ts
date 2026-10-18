import { Map as MlMap } from 'maplibre-gl';
import {
  VECTOR_LOAD_TIMEOUT_MS,
  applyBasemap,
  getSavedBasemapId,
  markBasemapApplied,
  rasterFallbackFor,
} from '../map/engine/basemaps';
import { transformTileRequest } from '../map/engine/tileProxy';
import { initialStyleFor, resolveBasemapEntry } from '../map/MapSurface';
import { attributionText, mercatorProjector, type LatLon, type Projector } from './geo';

/** The base map did not render in time (offline, blocked tiles, lost WebGL). */
export class BasemapLoadError extends Error {
  constructor(message = 'basemap did not load') {
    super(message);
    this.name = 'BasemapLoadError';
  }
}

export interface BasemapCapture {
  image: HTMLCanvasElement;
  /** Places a point on `image`. Plain maths, so it outlives the map. */
  project: Projector;
  credit: string;
  tone: 'dark' | 'light';
}

/**
 * Renders the user's saved basemap in a hidden, non-interactive map sized like
 * the card's visual area, fitted to `points`, and copies the pixels out.
 * Routes and markers are not on this map: the card paints them itself, since
 * the app's markers are DOM.
 *
 * The copy is taken inside the `render` of a frame drawn after the map
 * settled, while that frame's pixels are certain to be in the buffer, and the
 * buffer is preserved as well (maplibre 6: `canvasContextAttributes`). A copy
 * that still comes out (almost) fully transparent has been seen in a
 * long-open Firefox tab; it is retried once with a fresh map, then reported
 * as a map that did not load, so a card never silently loses its map.
 */
export async function captureBasemap(
  points: LatLon[],
  size: { w: number; h: number },
  paddingPx: number,
  timeoutMs = VECTOR_LOAD_TIMEOUT_MS
): Promise<BasemapCapture> {
  try {
    return await captureOnce(points, size, paddingPx, timeoutMs);
  } catch (err) {
    if (!(err instanceof EmptyCopyError)) throw err;
  }
  try {
    return await captureOnce(points, size, paddingPx, timeoutMs);
  } catch (err) {
    if (!(err instanceof EmptyCopyError)) throw err;
    console.warn('Share card: the base map copy came out empty twice', err.details);
    throw new BasemapLoadError('basemap copy empty');
  }
}

/** The map drew, but the pixels read back were (almost) all transparent. */
class EmptyCopyError extends Error {
  constructor(readonly details: Record<string, unknown>) {
    super('basemap copy empty');
  }
}

/** True when more than 90 % of sampled pixels are fully transparent. */
function mostlyTransparent(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  let seen = 0;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4 * 97) {
    seen++;
    if (data[i] === 0) clear++;
  }
  return seen > 0 && clear / seen > 0.9;
}

function captureOnce(
  points: LatLon[],
  size: { w: number; h: number },
  paddingPx: number,
  timeoutMs: number
): Promise<BasemapCapture> {
  const entry = resolveBasemapEntry(getSavedBasemapId());
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${size.w}px`,
    height: `${size.h}px`,
    pointerEvents: 'none',
  });
  document.body.appendChild(container);

  let map: MlMap;
  try {
    map = new MlMap({
      container,
      style: initialStyleFor(entry),
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      transformRequest: transformTileRequest,
    });
  } catch {
    // No WebGL (blocked, lost, or unsupported): same way out as a map that never loads.
    container.remove();
    return Promise.reject(new BasemapLoadError());
  }

  return new Promise<BasemapCapture>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      try {
        map.remove();
      } catch {
        // already gone
      }
      container.remove();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new BasemapLoadError());
    };
    const timer = setTimeout(fail, timeoutMs);

    const capture = () => {
      if (settled) return;
      try {
        const image = document.createElement('canvas');
        image.width = size.w;
        image.height = size.h;
        const ctx = image.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(map.getCanvas(), 0, 0, size.w, size.h);
        if (mostlyTransparent(ctx, size.w, size.h)) {
          const gl = map.getCanvas().getContext('webgl2') ?? map.getCanvas().getContext('webgl');
          const details = {
            basemap: entry.id,
            contextLost: gl?.isContextLost?.() ?? null,
            styleLoaded: map.isStyleLoaded?.() ?? null,
            tilesLoaded: map.areTilesLoaded?.() ?? null,
          };
          settled = true;
          cleanup();
          reject(new EmptyCopyError(details));
          return;
        }
        const c = map.getCenter();
        const project = mercatorProjector({ lat: c.lat, lon: c.lng }, map.getZoom(), size);
        settled = true;
        cleanup();
        resolve({
          image,
          project,
          credit: attributionText(entry.attribution),
          tone: entry.tone ?? 'dark',
        });
      } catch {
        fail();
      }
    };

    // Copy in the render of a fresh frame after the map settled: the pixels
    // are in the drawing buffer then, whatever the browser does with it later.
    const afterIdle = () => {
      if (settled) return;
      map.once('render', capture);
      map.triggerRepaint();
    };

    const frame = () => {
      if (points.length === 1 || samePoint(points)) {
        map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: 11 });
      } else {
        const lons = points.map((p) => p.lon);
        const lats = points.map((p) => p.lat);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: paddingPx, duration: 0 }
        );
      }
    };

    // One missing tile or glyph is normal; only a style-level error is fatal.
    map.on('error', (e) => {
      const ev = e as unknown as { sourceId?: string; tile?: unknown } | undefined;
      if (ev?.sourceId || ev?.tile) return;
      fail();
    });
    map.once('load', () => {
      if (entry.kind === 'vector-recolor') {
        // As MapSurface does: mounted on the raster fallback, then upgraded.
        // Wait for the upgraded style before waiting for a rendered frame.
        markBasemapApplied(map, rasterFallbackFor(entry));
        map.once('style.load', () => {
          frame();
          map.once('idle', afterIdle);
        });
        applyBasemap(map, entry, { theme: entry.tone ?? 'dark' });
      } else {
        frame();
        map.once('idle', afterIdle);
      }
    });
  });
}

function samePoint(points: LatLon[]): boolean {
  return points.every((p) => p.lat === points[0].lat && p.lon === points[0].lon);
}
