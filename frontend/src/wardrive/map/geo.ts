// Stored wardrive data as map features: reception points coloured by RSSI
// and one line per radio through its listening intervals.
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import type { WardriveData, WardriveDataTrack } from '../api';
import { rssiTier, tierColor } from '../signal';

/** A pause longer than this between two intervals breaks the line. */
const MAX_GAP_MS = 5 * 60 * 1000;

export const WINDOWS = [
  { id: '24h', seconds: 86400 },
  { id: '7d', seconds: 7 * 86400 },
  { id: '30d', seconds: 30 * 86400 },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];

export function windowRange(id: WindowId, nowSec: number): { since: number; until: number } {
  const w = WINDOWS.find((x) => x.id === id) ?? WINDOWS[0];
  return { since: nowSec - w.seconds, until: nowSec };
}

/** RSSI colour of the RX app's tiers (hot = strong = close). */
export function rssiColor(rssi: number | null): string {
  return tierColor(rssiTier(rssi), false);
}

type Bounds = [[number, number], [number, number]];

export function toGeoJson(data: WardriveData): {
  points: FeatureCollection<Point>;
  lines: FeatureCollection<LineString>;
  bounds: Bounds | null;
} {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const extend = (lon: number, lat: number) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  const points: Feature<Point>[] = data.obs.map((o, i) => {
    extend(o.lon, o.lat);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
      properties: {
        // The popup reads the row itself (every stored field).
        i,
        color: rssiColor(o.rssi),
        rssi: o.rssi,
        snr: o.snr,
        rx_at: o.rx_at,
        username: o.username,
        radio: o.radio_key.slice(0, 8),
        hash: o.hash,
      },
    };
  });

  const byRadio = new Map<string, WardriveDataTrack[]>();
  for (const t of data.tracks) {
    extend(t.lon, t.lat);
    const list = byRadio.get(t.radio_key) ?? [];
    list.push(t);
    byRadio.set(t.radio_key, list);
  }
  const lines: Feature<LineString>[] = [];
  for (const [radio, tracks] of byRadio) {
    tracks.sort((a, b) => Date.parse(a.t0) - Date.parse(b.t0));
    let run: WardriveDataTrack[] = [];
    const flush = () => {
      if (run.length >= 2) {
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: run.map((t) => [t.lon, t.lat]) },
          properties: { radio: radio.slice(0, 8), username: run[0].username },
        });
      }
      run = [];
    };
    for (const t of tracks) {
      const prev = run[run.length - 1];
      if (prev && (!prev.listening || Date.parse(t.t0) - Date.parse(prev.t1) > MAX_GAP_MS)) {
        flush();
      }
      run.push(t);
    }
    flush();
  }

  const bounds: Bounds | null = Number.isFinite(minLon)
    ? [
        [minLon, minLat],
        [maxLon, maxLat],
      ]
    : null;
  return {
    points: { type: 'FeatureCollection', features: points },
    lines: { type: 'FeatureCollection', features: lines },
    bounds,
  };
}
