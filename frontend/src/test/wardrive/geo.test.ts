import { describe, expect, it } from 'vitest';

import type { WardriveData, WardriveDataObs, WardriveDataTrack } from '../../wardrive/api';
import { rssiColor, toGeoJson, windowRange } from '../../wardrive/map/geo';

const A = 'AA'.repeat(32);
const B = 'BB'.repeat(32);

function o(over: Partial<WardriveDataObs> = {}): WardriveDataObs {
  return {
    user_id: 1,
    username: 'mike',
    radio_key: A,
    rx_at: '2026-10-19T10:00:00.000Z',
    hash: '0123456789abcdef',
    packet_type: 5,
    route: 'F',
    path: [],
    rssi: -85,
    snr: 6,
    lat: 52.1,
    lon: 5.1,
    accuracy: 4,
    ...over,
  };
}

function tr(
  t0: string,
  t1: string,
  lon: number,
  over: Partial<WardriveDataTrack> = {}
): WardriveDataTrack {
  return {
    user_id: 1,
    username: 'mike',
    radio_key: A,
    t0,
    t1,
    lat: 52,
    lon,
    accuracy: 4,
    rx_count: 1,
    listening: true,
    ...over,
  };
}

const data = (obs: WardriveDataObs[], tracks: WardriveDataTrack[]): WardriveData => ({
  obs,
  tracks,
  truncated: false,
});

describe('wardrive map helpers', () => {
  it('colours every band and grey for unknown', () => {
    expect(rssiColor(-70)).toBe('#ef4444');
    expect(rssiColor(-80)).toBe('#ef4444');
    expect(rssiColor(-85)).toBe('#f97316');
    expect(rssiColor(-95)).toBe('#eab308');
    expect(rssiColor(-105)).toBe('#06b6d4');
    expect(rssiColor(-115)).toBe('#3b82f6');
    expect(rssiColor(null)).toBe('#9ca3af');
  });

  it('points carry the popup fields', () => {
    const { points } = toGeoJson(data([o()], []));
    expect(points.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [5.1, 52.1] },
        properties: {
          i: 0,
          color: '#f97316',
          rssi: -85,
          snr: 6,
          rx_at: '2026-10-19T10:00:00.000Z',
          username: 'mike',
          radio: 'AAAAAAAA',
          hash: '0123456789abcdef',
        },
      },
    ]);
  });

  it('lines follow t0 order per radio', () => {
    const { lines } = toGeoJson(
      data(
        [],
        [
          tr('2026-10-19T10:00:20Z', '2026-10-19T10:00:30Z', 5.3),
          tr('2026-10-19T10:00:00Z', '2026-10-19T10:00:10Z', 5.1),
          tr('2026-10-19T10:00:10Z', '2026-10-19T10:00:20Z', 5.2),
          tr('2026-10-19T10:00:00Z', '2026-10-19T10:00:10Z', 6.1, { radio_key: B }),
          tr('2026-10-19T10:00:10Z', '2026-10-19T10:00:20Z', 6.2, { radio_key: B }),
        ]
      )
    );
    expect(lines.features.map((f) => f.geometry.coordinates.map((c) => c[0]))).toEqual([
      [5.1, 5.2, 5.3],
      [6.1, 6.2],
    ]);
  });

  it('breaks a line after listening false and after a 5 minute gap', () => {
    const { lines } = toGeoJson(
      data(
        [],
        [
          tr('2026-10-19T10:00:00Z', '2026-10-19T10:00:10Z', 5.1),
          tr('2026-10-19T10:00:10Z', '2026-10-19T10:00:20Z', 5.2, { listening: false }),
          tr('2026-10-19T10:01:00Z', '2026-10-19T10:01:10Z', 5.3),
          tr('2026-10-19T10:01:10Z', '2026-10-19T10:01:20Z', 5.4),
          tr('2026-10-19T10:07:00Z', '2026-10-19T10:07:10Z', 5.5),
          tr('2026-10-19T10:07:10Z', '2026-10-19T10:07:20Z', 5.6),
        ]
      )
    );
    expect(lines.features.map((f) => f.geometry.coordinates.map((c) => c[0]))).toEqual([
      [5.1, 5.2],
      [5.3, 5.4],
      [5.5, 5.6],
    ]);
  });

  it('drops single-point runs from the lines', () => {
    const { lines } = toGeoJson(
      data([], [tr('2026-10-19T10:00:00Z', '2026-10-19T10:00:10Z', 5.1)])
    );
    expect(lines.features).toEqual([]);
  });

  it('covers points and tracks in the bounds', () => {
    const { bounds } = toGeoJson(
      data([o({ lat: 51, lon: 4 })], [tr('2026-10-19T10:00:00Z', '2026-10-19T10:00:10Z', 6)])
    );
    expect(bounds).toEqual([
      [4, 51],
      [6, 52],
    ]);
  });

  it('gives empty collections and no bounds for no data', () => {
    const geo = toGeoJson(data([], []));
    expect(geo.points.features).toEqual([]);
    expect(geo.lines.features).toEqual([]);
    expect(geo.bounds).toBeNull();
  });

  it('ends every window now', () => {
    expect(windowRange('24h', 1000000)).toEqual({ since: 1000000 - 86400, until: 1000000 });
    expect(windowRange('7d', 1000000)).toEqual({ since: 1000000 - 7 * 86400, until: 1000000 });
    expect(windowRange('30d', 3000000)).toEqual({ since: 3000000 - 30 * 86400, until: 3000000 });
  });
});
