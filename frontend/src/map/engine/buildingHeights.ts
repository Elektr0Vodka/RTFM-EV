import type { Map as MlMap } from 'maplibre-gl';
import { buildingsLayerSpec } from './buildings3D';

// Roof heights under map nodes, so a node inside a 3D building footprint (and
// the packet arcs that land on it) sits on the roof instead of inside the
// extrusion. Heights come from the rendered `buildings-3d` layer: a node is only
// lifted while that layer is drawn (buildings on, zoom at or past its minzoom).

/** Metres above the roof, so arcs ending on a roof do not z-fight with it. */
export const ROOF_CLEARANCE_M = 1;

const BUILDINGS_LAYER_ID = 'buildings-3d';
const BUILDINGS_MIN_ZOOM = buildingsLayerSpec('', 'dark').minzoom;

type Ring = number[][];
interface FeatureLike {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

function ringContains(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even-odd test across all rings, so holes count as outside. */
function polygonContains(rings: Ring[], lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings) if (ringContains(ring, lon, lat)) inside = !inside;
  return inside;
}

/** Whether a Polygon/MultiPolygon feature's footprint contains the point. */
export function featureContains(f: FeatureLike, lon: number, lat: number): boolean {
  const g = f.geometry;
  if (!g || !Array.isArray(g.coordinates)) return false;
  if (g.type === 'Polygon') return polygonContains(g.coordinates as Ring[], lon, lat);
  if (g.type === 'MultiPolygon') {
    return (g.coordinates as Ring[][]).some((p) => polygonContains(p, lon, lat));
  }
  return false;
}

/** Tallest `render_height` among the building parts containing the point, 0
 *  when none does. */
export function roofHeightAt(features: FeatureLike[], lon: number, lat: number): number {
  let best = 0;
  for (const f of features) {
    const h = Number(f.properties?.render_height);
    if (Number.isFinite(h) && h > best && featureContains(f, lon, lat)) best = h;
  }
  return best;
}

export interface BuildingHeights {
  /** Height in metres to draw a node at (roof + clearance, or 0). */
  heightAt(lon: number, lat: number): number;
  /** Re-read the roof heights for on-screen `points` ([lon, lat]). Off-screen
   *  points keep their last known height. Returns whether any height changed. */
  refresh(points: Array<[number, number]>): boolean;
  /** Increments whenever a height changes (for deck.gl updateTriggers). */
  version(): number;
}

const key = (lon: number, lat: number): string => `${lon.toFixed(6)},${lat.toFixed(6)}`;

export function createBuildingHeights(map: MlMap): BuildingHeights {
  const m = map as unknown as {
    getLayer: (id: string) => unknown;
    getZoom: () => number;
    project: (lnglat: [number, number]) => { x: number; y: number };
    getCanvas: () => { clientWidth: number; clientHeight: number };
    queryRenderedFeatures: (point: [number, number], opts: { layers: string[] }) => FeatureLike[];
  };
  const heights = new Map<string, number>();
  let ver = 0;

  return {
    heightAt(lon: number, lat: number): number {
      return heights.get(key(lon, lat)) ?? 0;
    },
    refresh(points: Array<[number, number]>): boolean {
      if (!m.getLayer(BUILDINGS_LAYER_ID) || m.getZoom() < BUILDINGS_MIN_ZOOM) {
        if (heights.size === 0) return false;
        heights.clear();
        ver++;
        return true;
      }
      const canvas = m.getCanvas();
      let changed = false;
      for (const [lon, lat] of points) {
        const p = m.project([lon, lat]);
        if (p.x < 0 || p.y < 0 || p.x > canvas.clientWidth || p.y > canvas.clientHeight) continue;
        const feats = m.queryRenderedFeatures([p.x, p.y], { layers: [BUILDINGS_LAYER_ID] });
        const roof = roofHeightAt(feats, lon, lat);
        const next = roof > 0 ? roof + ROOF_CLEARANCE_M : 0;
        const k = key(lon, lat);
        if ((heights.get(k) ?? 0) === next) continue;
        if (next > 0) heights.set(k, next);
        else heights.delete(k);
        changed = true;
      }
      if (changed) ver++;
      return changed;
    },
    version(): number {
      return ver;
    },
  };
}
