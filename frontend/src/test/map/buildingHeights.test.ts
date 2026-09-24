import { describe, it, expect, vi } from 'vitest';
import type { Map as MlMap } from 'maplibre-gl';
import {
  createBuildingHeights,
  featureContains,
  roofHeightAt,
  ROOF_CLEARANCE_M,
} from '../../map/engine/buildingHeights';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A 2x2 square around (5, 52) with a 1x1 hole in its middle-right.
const square = [
  [4, 51],
  [6, 51],
  [6, 53],
  [4, 53],
  [4, 51],
];
const hole = [
  [5.2, 51.8],
  [5.8, 51.8],
  [5.8, 52.2],
  [5.2, 52.2],
  [5.2, 51.8],
];
const poly = (rings: number[][][], h?: number) => ({
  geometry: { type: 'Polygon', coordinates: rings },
  properties: h == null ? {} : { render_height: h },
});

describe('featureContains', () => {
  it('detects a point inside a polygon and outside it', () => {
    expect(featureContains(poly([square]), 5, 52)).toBe(true);
    expect(featureContains(poly([square]), 7, 52)).toBe(false);
  });

  it('treats a point in a hole as outside', () => {
    expect(featureContains(poly([square, hole]), 5.5, 52)).toBe(false);
    expect(featureContains(poly([square, hole]), 4.5, 52)).toBe(true);
  });

  it('handles multipolygons', () => {
    const multi = {
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[hole], [square.map(([x, y]) => [x + 10, y])]],
      },
      properties: {},
    };
    expect(featureContains(multi, 15, 52)).toBe(true);
    expect(featureContains(multi, 5.5, 52)).toBe(true);
    expect(featureContains(multi, 4.5, 52)).toBe(false);
  });

  it('ignores non-polygon geometry', () => {
    expect(featureContains({ geometry: { type: 'Point', coordinates: [5, 52] } }, 5, 52)).toBe(
      false
    );
  });
});

describe('roofHeightAt', () => {
  it('takes the tallest building part containing the point', () => {
    const feats = [poly([square], 8), poly([hole], 30), poly([square], 12)];
    expect(roofHeightAt(feats, 5.5, 52)).toBe(30);
    expect(roofHeightAt(feats, 4.5, 52)).toBe(12);
  });

  it('is 0 when no footprint contains the point or height is missing', () => {
    expect(roofHeightAt([poly([hole], 30)], 4.5, 52)).toBe(0);
    expect(roofHeightAt([poly([square])], 5, 52)).toBe(0);
  });
});

function fakeMap(opts: { layer?: boolean; zoom?: number; features?: any[] } = {}) {
  const state = { layer: opts.layer ?? true, zoom: opts.zoom ?? 16, features: opts.features ?? [] };
  return {
    state,
    getLayer: vi.fn((id: string) => (id === 'buildings-3d' && state.layer ? {} : undefined)),
    getZoom: vi.fn(() => state.zoom),
    // lon/lat -> pixels: 100 px per degree, origin at (0, 50).
    project: vi.fn(([lon, lat]: [number, number]) => ({ x: lon * 100, y: (lat - 50) * 100 })),
    getCanvas: () => ({ clientWidth: 1000, clientHeight: 500 }),
    queryRenderedFeatures: vi.fn(() => state.features),
  };
}
const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as MlMap;

describe('createBuildingHeights', () => {
  it('lifts an on-screen node inside a footprint to its roof plus clearance', () => {
    const map = fakeMap({ features: [poly([square], 20)] });
    const h = createBuildingHeights(asMap(map));
    expect(h.refresh([[5, 52]])).toBe(true);
    expect(h.heightAt(5, 52)).toBe(20 + ROOF_CLEARANCE_M);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [500, 200],
      expect.objectContaining({ layers: ['buildings-3d'] })
    );
    // A second refresh with the same result reports no change.
    expect(h.refresh([[5, 52]])).toBe(false);
  });

  it('keeps nodes outside every footprint on the ground', () => {
    const map = fakeMap({ features: [poly([hole], 20)] });
    const h = createBuildingHeights(asMap(map));
    h.refresh([[4.5, 52]]);
    expect(h.heightAt(4.5, 52)).toBe(0);
  });

  it('skips off-screen nodes and keeps their last known height', () => {
    const map = fakeMap({ features: [poly([square], 20)] });
    const h = createBuildingHeights(asMap(map));
    h.refresh([[5, 52]]);
    map.state.features = [];
    // (15, 52) projects to x=1500, off the 1000px canvas: not queried.
    map.queryRenderedFeatures.mockClear();
    h.refresh([[15, 52]]);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(h.heightAt(5, 52)).toBe(20 + ROOF_CLEARANCE_M);
  });

  it('drops every height when the buildings layer is off or zoomed out past it', () => {
    const map = fakeMap({ features: [poly([square], 20)] });
    const h = createBuildingHeights(asMap(map));
    h.refresh([[5, 52]]);
    map.state.zoom = 11;
    expect(h.refresh([[5, 52]])).toBe(true);
    expect(h.heightAt(5, 52)).toBe(0);
    map.state.zoom = 16;
    h.refresh([[5, 52]]);
    map.state.layer = false;
    expect(h.refresh([[5, 52]])).toBe(true);
    expect(h.heightAt(5, 52)).toBe(0);
  });

  it('bumps its version only when a height changes', () => {
    const map = fakeMap({ features: [poly([square], 20)] });
    const h = createBuildingHeights(asMap(map));
    const v0 = h.version();
    h.refresh([[5, 52]]);
    const v1 = h.version();
    expect(v1).not.toBe(v0);
    h.refresh([[5, 52]]);
    expect(h.version()).toBe(v1);
  });
});
