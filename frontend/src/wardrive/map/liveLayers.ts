// The live map's data: this session's receptions (coloured by signal tier),
// the selected one, and the trail.
import type { FeatureCollection, LineString, Point } from 'geojson';

import type { LiveEntry } from '../liveLog';
import { rssiTier, tierColor } from '../signal';

export function liveGeoJson(
  entries: LiveEntry[],
  selectedId: number | null,
  cvd: boolean
): { points: FeatureCollection<Point>; selected: FeatureCollection<Point> } {
  const placed = entries.filter((e) => e.lat !== null && e.lon !== null);
  const feature = (e: LiveEntry) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [e.lon as number, e.lat as number] },
    properties: {
      id: e.id,
      kept: e.kept,
      rssi: e.rssi,
      snr: e.snr,
      color: tierColor(rssiTier(e.rssi), cvd),
    },
  });
  return {
    points: { type: 'FeatureCollection', features: placed.map(feature) },
    selected: {
      type: 'FeatureCollection',
      features: placed.filter((e) => e.id === selectedId).map(feature),
    },
  };
}

export function trailGeoJson(points: [number, number][]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features:
      points.length < 2
        ? []
        : [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: points },
              properties: {},
            },
          ],
  };
}

/** Below this zoom the map shows a region, not the road: follow zooms in. */
const STREET_ZOOM_MIN = 13;
const FOLLOW_ZOOM = 15;
export const PITCH_3D = 60;

/** Camera for following the own position: north up, zoomed to street level
 * from a region view (a zoom the driver chose is kept), and the 3D pitch, so
 * a follow step never cuts the tilt short. */
export function followView(
  currentZoom: number,
  tilt3D: boolean
): { zoom: number; pitch: number; bearing: number } {
  return {
    zoom: currentZoom < STREET_ZOOM_MIN ? FOLLOW_ZOOM : currentZoom,
    pitch: tilt3D ? PITCH_3D : 0,
    bearing: 0,
  };
}

/** Where to pan for a selection in the live log: to a newly selected
 * reception with a position. A cleared selection is forgotten, so picking the
 * same reception again pans again. */
export function selectionPan(
  last: number | null,
  selectedId: number | null,
  entries: LiveEntry[]
): { pan: [number, number] | null; last: number | null } {
  if (selectedId === null) return { pan: null, last: null };
  if (selectedId === last) return { pan: null, last };
  const entry = entries.find((e) => e.id === selectedId);
  const pan: [number, number] | null =
    entry && entry.lat !== null && entry.lon !== null ? [entry.lon, entry.lat] : null;
  return { pan, last: selectedId };
}
