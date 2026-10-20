import { describe, expect, it } from 'vitest';

import { distanceKm, type Attribution, type DirectoryNode } from '../../wardrive/names';
import {
  MAX_RAYS,
  hueSlot,
  nextNodePosMode,
  nodeFeatures,
  nodesInView,
  parseNodePosMode,
  receptionsByNode,
} from '../../wardrive/map/nodeLayer';
import type { ViewEntry } from '../../wardrive/useReceptionView';
import type { Sender } from '../../wardrive/decode/reception';

const KEY_A = 'a1' + '11'.repeat(31);
const KEY_B = 'b2' + '22'.repeat(31);
const LAT = 52.5;
const LON = 6.0;
const EAST_400M = 400 / (111320 * Math.cos((LAT * Math.PI) / 180));

function node(key: string, over: Partial<DirectoryNode> = {}): DirectoryNode {
  return { publicKey: key, name: 'N', role: 'Repeater', lat: LAT, lon: LON, seen: 1, ...over };
}

let n = 0;
function entry(sender: Partial<Sender>, attr: Attribution | null, lat = LAT, lon = LON): ViewEntry {
  return {
    id: n++,
    at: n,
    rssi: -90,
    snr: 5,
    lat,
    lon,
    sender: { kind: null, id: null, label: null, role: null, ...sender },
    attr,
  } as unknown as ViewEntry;
}

const HUES = Array.from({ length: 12 }, (_, i) => `#0000${String(i).padStart(2, '0')}`);

describe('node positions layer', () => {
  it('cycles off, positions, reach', () => {
    expect(nextNodePosMode('off')).toBe('positions');
    expect(nextNodePosMode('positions')).toBe('reach');
    expect(nextNodePosMode('reach')).toBe('off');
    expect(parseNodePosMode('x')).toBe('off');
    expect(parseNodePosMode('reach')).toBe('reach');
  });

  it('gives an id one stable hue whatever its case', () => {
    expect(hueSlot('A1B2')).toBe(hueSlot('a1b2'));
    const slots = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const s = hueSlot(`id${i * 7919}`);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(12);
      slots.add(s);
    }
    expect(slots.size).toBeGreaterThanOrEqual(10);
  });

  it('keeps the positioned nodes in view, newest first, at most 500', () => {
    const bounds = { west: 5.9, south: 52.4, east: 6.1, north: 52.6 };
    expect(
      nodesInView(
        [node(KEY_A, { lon: 6.1 }), node(KEY_B, { lat: null, lon: null }), node('cc', { lat: 53 })],
        bounds
      ).map((x) => x.publicKey)
    ).toEqual([KEY_A]);
    const many = Array.from({ length: 600 }, (_, i) =>
      node(i.toString(16).padStart(64, '0'), { seen: i })
    );
    const kept = nodesInView(many, bounds);
    expect(kept).toHaveLength(500);
    expect(kept[0].seen).toBe(599);
  });

  it('keeps nodes just outside the view whose reach can land in it', () => {
    const bounds = { west: 5.9, south: 52.4, east: 6.1, north: 52.6 };
    // 10 km east of the view: its reach lines end on screen.
    const near = node(KEY_A, { lon: 6.1 + 10 / (111.32 * Math.cos((52.5 * Math.PI) / 180)) });
    const far = node(KEY_B, { lon: 7.0 });
    expect(nodesInView([near, far], bounds, true).map((x) => x.publicKey)).toEqual([KEY_A]);
    expect(nodesInView([near], bounds)).toEqual([]);
  });

  it('ranks nodes on screen before nodes in the reach margin', () => {
    const bounds = { west: 5.9, south: 52.4, east: 6.1, north: 52.6 };
    const ring = Array.from({ length: 600 }, (_, i) =>
      node(i.toString(16).padStart(64, '0'), { lon: 6.15, seen: 1000 + i })
    );
    const onScreen = node(KEY_A, { lon: 6.0, seen: 1 });
    const kept = nodesInView([...ring, onScreen], bounds, true);
    expect(kept).toHaveLength(500);
    expect(kept[0].publicKey).toBe(KEY_A);
  });

  it('ties a reception to a node by its advert key or its attribution', () => {
    const a = node(KEY_A);
    const b = node(KEY_B);
    const byNode = receptionsByNode(
      [
        entry({ kind: 'advert_pubkey', id: KEY_A }, null),
        entry({ kind: 'relay', id: 'b222' }, { rule: 'node', node: b }),
        entry({ kind: 'relay', id: 'a111' }, { rule: 'collision', count: 2 }),
        entry({ kind: 'discover_pubkey', id: 'b2222222' }, null),
      ],
      [a, b]
    );
    expect(byNode.get(KEY_A)).toHaveLength(1);
    expect(byNode.get(KEY_B)).toHaveLength(2);
  });

  it('counts a discover prefix shared by two drawn nodes for neither', () => {
    const a = node('ab' + '11'.repeat(31));
    const b = node('ab' + '22'.repeat(31));
    const byNode = receptionsByNode([entry({ kind: 'discover_pubkey', id: 'ab' }, null)], [a, b]);
    expect([...byNode.values()].flat()).toEqual([]);
  });

  it('draws an estimate, a drift line and a circle when they are far apart', () => {
    const a = node(KEY_A);
    const heard = [0, 1, 2].map((i) =>
      entry({ kind: 'advert_pubkey', id: KEY_A }, null, LAT + i * 0.0002, LON + EAST_400M)
    );
    const f = nodeFeatures([a], receptionsByNode(heard, [a]), HUES);
    expect(f.advertised.features).toHaveLength(1);
    expect(f.estimates.features).toHaveLength(1);
    expect(f.drift.features).toHaveLength(1);
    expect(f.circles.features).toHaveLength(1);
    const [lon, lat] = f.estimates.features[0].geometry.coordinates;
    expect(distanceKm({ lat: LAT, lon: LON }, { lat, lon }) * 1000).toBeGreaterThan(380);
    expect(f.circles.features[0].properties?.radius_m).toBeGreaterThan(380);
  });

  it('draws no circle when estimate and advert agree', () => {
    const a = node(KEY_A);
    const heard = [0, 1, 2].map((i) =>
      entry({ kind: 'advert_pubkey', id: KEY_A }, null, LAT + i * 0.0002, LON)
    );
    const f = nodeFeatures([a], receptionsByNode(heard, [a]), HUES);
    expect(f.estimates.features).toHaveLength(1);
    expect(f.circles.features).toEqual([]);
  });

  it('draws a reach line per reception in the node hue, capped', () => {
    const a = node(KEY_A);
    const heard = [0, 1].map((i) =>
      entry({ kind: 'advert_pubkey', id: KEY_A }, null, LAT + i * 0.01)
    );
    const f = nodeFeatures([a], receptionsByNode(heard, [a]), HUES);
    expect(f.rays.features).toHaveLength(2);
    expect(f.rays.features[0].geometry.coordinates[0]).toEqual([LON, LAT]);
    expect(f.rays.features[0].properties?.color).toBe(HUES[hueSlot(KEY_A)]);
    const lots = Array.from({ length: MAX_RAYS + 50 }, (_, i) =>
      entry({ kind: 'advert_pubkey', id: KEY_A }, null, LAT + (i % 100) * 0.001)
    );
    expect(nodeFeatures([a], receptionsByNode(lots, [a]), HUES).rays.features).toHaveLength(
      MAX_RAYS
    );
  });
});
