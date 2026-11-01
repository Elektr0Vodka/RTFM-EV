// GeoJSON for the coverage map's layers: receptions as points (and pillars in
// 3D), cells as hexagons coloured by their best signal, the picked reception's
// ring and a driver's pin. Colours are the page's signal tiers.
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';

import { cellAt, cellRing } from '../map/hexgrid';
import { heightFor } from '../map/hexLayer';
import { rssiTier, tierColor } from '../signal';
import type { MapCell, MapPoint } from './types';

/** A pillar is a 5 m hexagon around the reception. */
const PILLAR_RES = 14;
const CELL_OPACITY = 0.55;

const fc = <G extends Point | Polygon>(features: Feature<G>[]): FeatureCollection<G> => ({
  type: 'FeatureCollection',
  features,
});

const colorOf = (rssi: number | null, cvd: boolean) => tierColor(rssiTier(rssi), cvd);

export function pointFeatures(
  points: MapPoint[],
  cvd: boolean,
  opOf?: (p: MapPoint, i: number) => number
): FeatureCollection<Point> {
  return fc(
    points.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { i, color: colorOf(p.rssi, cvd), op: opOf ? opOf(p, i) : 1 },
    }))
  );
}

export function pillarFeatures(points: MapPoint[], cvd: boolean): FeatureCollection<Polygon> {
  const out: Feature<Polygon>[] = [];
  points.forEach((p, i) => {
    const ring = cellRing(cellAt(p.lat, p.lon, PILLAR_RES));
    if (!ring) return;
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { i, color: colorOf(p.rssi, cvd), height: heightFor(p.rssi) },
    });
  });
  return fc(out);
}

export function cellFeatures(
  cells: MapCell[],
  cvd: boolean,
  scale = 1
): FeatureCollection<Polygon> {
  return fc(
    cells.map((c, i) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.ring] },
      properties: {
        i,
        cell: c.cell,
        best: c.best,
        count: c.count,
        drivers: c.drivers,
        color: colorOf(c.best, cvd),
        height: heightFor(c.best),
        op: CELL_OPACITY * scale,
      },
    }))
  );
}

const pointAt = (lat: number, lon: number, properties: Record<string, unknown>) =>
  fc<Point>([
    { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties },
  ]);

export function ringFeature(p: MapPoint | null): FeatureCollection<Point> {
  return p ? pointAt(p.lat, p.lon, { color: colorOf(p.rssi, false) }) : fc<Point>([]);
}

export function pinFeature(lat: number, lon: number, label: string): FeatureCollection<Point> {
  return pointAt(lat, lon, { label });
}

/** [[west, south], [east, north]] of the points, or null for none. */
export function pointBounds(
  points: { lat: number; lon: number }[]
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}
