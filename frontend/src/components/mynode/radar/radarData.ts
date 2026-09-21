// Maps the My Node historical-stats neighbours (already 0-hop / directly heard on
// the backend) and the connected radio's own location into the RadarData shape the
// canvas consumes. Pure and unit-tested; the page feeds it the historical-stats it
// already fetches for every window (live 20m included), so there is no extra fetch.

import type { RadarData, RadarNode } from './radar';

export interface HistoricalNeighborLike {
  public_key: string;
  name: string | null;
  heard_count: number;
  lat: number | null;
  lon: number | null;
  best_snr?: number | null;
}

export interface RadioLocationLike {
  lat: number | null;
  lon: number | null;
}

function isLocated(lat: number | null, lon: number | null): lat is number {
  // Drop unlocated and (0,0) null-island coordinates.
  return typeof lat === 'number' && typeof lon === 'number' && !(lat === 0 && lon === 0);
}

// toRadarNodes keeps only located neighbours and maps them to RadarNode
// (snr = best_snr, receptions = heard_count).
export function toRadarNodes(neighbors: HistoricalNeighborLike[]): RadarNode[] {
  const nodes: RadarNode[] = [];
  for (const n of neighbors) {
    if (!isLocated(n.lat, n.lon)) continue;
    nodes.push({
      id: n.public_key,
      name: n.name,
      lat: n.lat as number,
      lon: n.lon as number,
      snr: n.best_snr ?? null,
      receptions: n.heard_count,
    });
  }
  return nodes;
}

// radarCenter is the radio's own position, or null when it has no usable location.
export function radarCenter(config: RadioLocationLike | null): RadarData['center'] {
  if (!config || !isLocated(config.lat, config.lon)) return null;
  return { lat: config.lat as number, lon: config.lon as number };
}

// toRadarData assembles the full RadarData from historical neighbours + config.
export function toRadarData(
  neighbors: HistoricalNeighborLike[],
  config: RadioLocationLike | null
): RadarData {
  return { center: radarCenter(config), nodes: toRadarNodes(neighbors) };
}
