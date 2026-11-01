import { describe, expect, it } from 'vitest';

import { heardModel, mappedCells, routeSegments } from '../../../wardrive/coverage/heardCard';
import type { Star } from '../../../wardrive/coverage/reach';
import type { MapPoint } from '../../../wardrive/coverage/types';
import { point } from './fixtures';

const VIEW: [number, number, number, number] = [52, 5, 53, 6];

const star = (
  id: string,
  lat: number,
  lon: number,
  pts: MapPoint[]
): Star<
  MapPoint & { sender_kind: string | null; sender_id: string | null; sender_role: string | null }
> => ({
  id,
  origin: { lat, lon, kind: 'advertised' },
  points: pts.map((p) => ({
    ...p,
    sender_kind: p.sender.kind,
    sender_id: p.sender.id,
    sender_role: p.sender.role,
  })),
});

describe('Repeaters heard card', () => {
  it('draws the stars in view and leaves off those heard only far away', () => {
    const near = star('aa', 52.5, 5.5, [
      point({ lat: 52.51, lon: 5.51 }),
      point({ lat: 52.6, lon: 5.6 }),
    ]);
    const far = star('bb', 52.4, 5.4, [point({ lat: 51, lon: 3 })]);
    const outside = star('cc', 50, 4, [point({ lat: 50.1, lon: 4 })]);
    const model = heardModel([near, far, outside], VIEW, (id) => (id === 'aa' ? 'Toren' : null));
    expect(model.drawn.map((s) => [s.id, s.name, s.rays.length])).toEqual([['aa', 'Toren', 2]]);
    expect(model.offMap).toEqual([{ name: 'bb', km: expect.any(Number) }]);
    expect(model.offMap[0].km).toBeGreaterThan(30);
    expect(model.numbers.repeaters).toBe(1);
    expect(model.numbers.receptions).toBe(2);
    expect(model.numbers.farthestKm).toBeGreaterThan(10);
  });

  it('labels a hash id with a #', () => {
    const s = star('b2', 52.5, 5.5, [
      point({
        lat: 52.51,
        lon: 5.51,
        sender: { kind: 'path_hash', id: 'b2', label: 'b2', role: null },
      }),
    ]);
    expect(heardModel([s], VIEW, () => null).drawn[0].name).toBe('#b2');
  });

  it('splits routes per driver at a gap of 5 minutes or 3 km', () => {
    const at = (driver: string, ts: number, lat: number) =>
      point({ driver, rx_ts: ts, lat, lon: 5.5, rx_at: new Date(ts * 1000).toISOString() });
    const segs = routeSegments([
      at('anna', 100, 52.1),
      at('anna', 160, 52.101),
      at('anna', 700, 52.102), // 9 minutes later: a new route
      at('anna', 760, 52.103),
      at('bert', 110, 52.2),
      at('bert', 120, 52.25), // 5.5 km on: a new route, one point, dropped
    ]);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.length === 2)).toBe(true);
  });

  it('marks the 360 m cells that were driven', () => {
    const cells = mappedCells([
      point({ lat: 52.1, lon: 5.1 }),
      point({ lat: 52.1001, lon: 5.1001 }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveLength(7);
  });
});
