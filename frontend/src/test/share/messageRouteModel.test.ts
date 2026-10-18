import { describe, expect, it } from 'vitest';
import { buildMessageRouteModel } from '../../share/cards/messageRoute';
import type { Contact, MessagePath } from '../../types';
import type { ResolvedPath } from '../../utils/pathUtils';

type Loc = { lat: number; lon: number } | null;

function contact(name: string, loc: Loc): Contact {
  return {
    name,
    public_key: name.padEnd(64, '0'),
    lat: loc?.lat ?? null,
    lon: loc?.lon ?? null,
  } as unknown as Contact;
}

function path(
  opts: {
    received_at?: number;
    hops?: number;
    snr?: number | null;
    senderLoc?: Loc;
    receiverLoc?: Loc;
    hopMatches?: Contact[][];
  } = {}
): MessagePath & { resolved: ResolvedPath } {
  const hopMatches =
    opts.hopMatches ??
    Array.from({ length: opts.hops ?? 2 }, (_, i) => [
      contact(`R${i}`, { lat: 52 + i * 0.1, lon: 5 }),
    ]);
  const hopCount = hopMatches.length;
  const senderLoc = opts.senderLoc === undefined ? { lat: 51.9, lon: 4.9 } : opts.senderLoc;
  const receiverLoc = opts.receiverLoc === undefined ? { lat: 52.5, lon: 5.2 } : opts.receiverLoc;
  return {
    path: 'ab'.repeat(hopCount),
    path_len: hopCount,
    received_at: opts.received_at ?? 100,
    snr: opts.snr ?? null,
    rssi: null,
    resolved: {
      sender: {
        name: 'Jan',
        prefix: 'aa',
        lat: senderLoc?.lat ?? null,
        lon: senderLoc?.lon ?? null,
      },
      hops: hopMatches.map((matches) => ({ prefix: 'ab', matches, distanceFromPrev: null })),
      receiver: {
        name: 'Me',
        prefix: 'ff',
        lat: receiverLoc?.lat ?? null,
        lon: receiverLoc?.lon ?? null,
        publicKey: 'ff'.repeat(32),
      },
      totalDistances: null,
      hasGaps: false,
    },
  };
}

describe('buildMessageRouteModel', () => {
  it('sorts routes by received time and numbers colours in that order', () => {
    const m = buildMessageRouteModel({
      paths: [path({ received_at: 20 }), path({ received_at: 10 })],
      outgoing: false,
    });
    expect(m.routes.map((r) => r.receivedAt)).toEqual([10, 20]);
    expect(m.routes.map((r) => r.colorIndex)).toEqual([0, 1]);
    expect(m.routeCount).toBe(2);
  });

  it('gives the hop range and best SNR over all paths', () => {
    const m = buildMessageRouteModel({
      paths: [path({ hops: 3, snr: 2.5 }), path({ hops: 5, snr: 6.5 }), path({ hops: 4 })],
      outgoing: false,
    });
    expect([m.hopsMin, m.hopsMax, m.bestSnr]).toEqual([3, 5, 6.5]);
  });

  it('has no best SNR when no path carries one', () => {
    expect(buildMessageRouteModel({ paths: [path()], outgoing: false }).bestSnr).toBeNull();
  });

  it('puts sender first and receiver last on every route', () => {
    const [route] = buildMessageRouteModel({ paths: [path({ hops: 2 })], outgoing: false }).routes;
    expect(route.stops.map((s) => s.kind)).toEqual(['sender', 'hop', 'hop', 'receiver']);
    expect(route.stops[0].name).toBe('Jan');
    expect(route.stops[1]).toMatchObject({ name: 'R0', point: { lat: 52, lon: 5 } });
    expect(route.hopCount).toBe(2);
  });

  it('treats an ambiguous or unmatched hop as a gap', () => {
    const [route] = buildMessageRouteModel({
      paths: [
        path({
          hopMatches: [
            [],
            [contact('A', { lat: 52, lon: 5 }), contact('B', { lat: 53, lon: 6 })],
            [contact('C', null)],
          ],
        }),
      ],
      outgoing: false,
    }).routes;
    const hops = route.stops.filter((s) => s.kind === 'hop');
    expect(hops.map((h) => h.point)).toEqual([null, null, null]);
    expect(hops.map((h) => h.name)).toEqual([null, null, 'C']);
  });

  it('model has no points when nothing is located', () => {
    const m = buildMessageRouteModel({
      paths: [path({ senderLoc: null, receiverLoc: null, hopMatches: [[]] })],
      outgoing: false,
    });
    expect(m.located).toEqual([]);
    expect(m.straightKm).toBeNull();
  });

  it('collects every located stop once for fitting the map', () => {
    const m = buildMessageRouteModel({
      paths: [path({ hops: 1 }), path({ hops: 1 })],
      outgoing: false,
    });
    expect(m.located).toHaveLength(3);
  });

  it('gives the straight-line distance between sender and receiver', () => {
    const m = buildMessageRouteModel({ paths: [path()], outgoing: false });
    expect(m.straightKm).toBeGreaterThan(60);
    expect(m.straightKm).toBeLessThan(80);
  });

  it('leaves out the straight-line distance when my radio has no position (0,0)', () => {
    const m = buildMessageRouteModel({
      paths: [path({ receiverLoc: { lat: 0, lon: 0 } })],
      outgoing: false,
    });
    expect(m.straightKm).toBeNull();
  });

  it('leaves out the straight-line distance for an outgoing message', () => {
    expect(buildMessageRouteModel({ paths: [path()], outgoing: true }).straightKm).toBeNull();
  });
});
