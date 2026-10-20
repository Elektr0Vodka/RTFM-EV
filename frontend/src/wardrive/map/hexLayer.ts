// The live map's hex grid, rx's way: a cell takes the colour of the strongest
// signal heard in it, and from zoom 16 a label with the 4-character prefixes of
// the ids heard there (newest first, three at most). In 3D a cell (or a
// reception's pillar) stands as tall as its signal is strong.
import type { FeatureCollection, Point, Polygon } from 'geojson';

import type { SenderKind } from '../decode/reception';
import { rssiTier, tierColor } from '../signal';
import { cellAt, cellCenter, cellRing } from './hexgrid';

export const HEX_LABEL_MIN_ZOOM = 16;
export const HEX_LABEL_MAX = 3;
const PREFIX_CHARS = 4;
/** Metres of height per dB above -130 dBm (-80 dBm stands 200 m tall). */
export const HEIGHT_PER_DB = 4;
const FLOOR_DBM = -130;
/** A pillar is a 5 m hexagon around the reception. */
const PILLAR_RES = 14;

/** Ids that name one node (never a 1-byte hash or a channel name). */
const UNLABELLED: (SenderKind | null)[] = ['path_hash', 'direct_hash', 'channel_name', null];

export interface HexInput {
  at: number;
  rssi: number | null;
  lat: number | null;
  lon: number | null;
  senderId: string | null;
  senderKind: SenderKind | null;
}

export function heightFor(rssi: number | null): number {
  if (rssi === null || !Number.isFinite(rssi)) return 0;
  return Math.max(0, rssi - FLOOR_DBM) * HEIGHT_PER_DB;
}

/** "5566 1122 a1b2 +1": distinct prefixes, newest first. */
export function hexLabel(ids: { id: string; at: number }[]): string {
  const seen: string[] = [];
  for (const { id } of [...ids].sort((a, b) => b.at - a.at)) {
    const p = id.toLowerCase().slice(0, PREFIX_CHARS);
    if (!seen.includes(p)) seen.push(p);
  }
  if (seen.length === 0) return '';
  const more = seen.length - HEX_LABEL_MAX;
  return seen.slice(0, HEX_LABEL_MAX).join(' ') + (more > 0 ? ` +${more}` : '');
}

interface CellAcc {
  rssi: number | null;
  ids: { id: string; at: number }[];
}

export function buildHexFeatures(
  entries: HexInput[],
  res: number,
  cvd: boolean
): FeatureCollection<Polygon> {
  const cells = new Map<string, CellAcc>();
  for (const e of entries) {
    if (e.lat === null || e.lon === null) continue;
    const id = cellAt(e.lat, e.lon, res);
    let c = cells.get(id);
    if (!c) {
      c = { rssi: null, ids: [] };
      cells.set(id, c);
    }
    if (e.rssi !== null && (c.rssi === null || e.rssi > c.rssi)) c.rssi = e.rssi;
    if (e.senderId && e.senderId.length >= PREFIX_CHARS && !UNLABELLED.includes(e.senderKind)) {
      c.ids.push({ id: e.senderId, at: e.at });
    }
  }
  const features: FeatureCollection<Polygon>['features'] = [];
  for (const [id, c] of cells) {
    const ring = cellRing(id);
    if (!ring) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        cell: id,
        rssi: c.rssi,
        color: tierColor(rssiTier(c.rssi), cvd),
        height: heightFor(c.rssi),
        label: hexLabel(c.ids),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Label points at the centres of labelled cells. */
export function labelPoints(fc: FeatureCollection<Polygon>): FeatureCollection<Point> {
  const features: FeatureCollection<Point>['features'] = [];
  for (const f of fc.features) {
    const label = f.properties?.label as string;
    const c = label ? cellCenter(f.properties?.cell as string) : null;
    if (!c) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { label },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** One small extruded hexagon per placed reception (3D points). */
export function pillarFeatures(
  entries: (HexInput & { id?: number })[],
  cvd: boolean
): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>['features'] = [];
  for (const e of entries) {
    if (e.lat === null || e.lon === null) continue;
    const ring = cellRing(cellAt(e.lat, e.lon, PILLAR_RES));
    if (!ring) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        id: e.id ?? null,
        color: tierColor(rssiTier(e.rssi), cvd),
        height: heightFor(e.rssi),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
