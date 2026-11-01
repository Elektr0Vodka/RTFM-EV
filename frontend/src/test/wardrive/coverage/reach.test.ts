// Attribution by reach, node positions and every repeater's reach, against
// vectors from running map.mesh-hunter.eu's own modules (core-hunter
// upstream/master 000bb89 web/attribution.js, coverage.js, nodelayer.js;
// generator in the coverage map ledger).
import { describe, expect, it } from 'vitest';

import {
  attributeReception,
  attributionSignature,
  reachKm,
  registryIndex,
  registryMatcher,
  type Hearing,
  type RegistryNode,
} from '../../../wardrive/coverage/attribution';
import { groupForNodes, nodeRows } from '../../../wardrive/coverage/nodePositions';
import {
  assignHues,
  coverageStars,
  hueSlot,
  isRepeaterHearing,
  rayStyle,
  starKeyOf,
} from '../../../wardrive/coverage/reach';
import vectors from './reachVectors.json';

const nodes = vectors.nodes as RegistryNode[];
const records = vectors.records as Hearing[];
const index = registryIndex(nodes);
const attributionOf = (r: Hearing) => attributeReception(r, index);
const matcher = registryMatcher(nodes);

describe('attribution by reach', () => {
  it('gives the reach of a signal', () => {
    [-130, -110, -90, -70, -50, null].forEach((v, i) =>
      expect(reachKm(v)).toBeCloseTo(vectors.reachKm[i], 12)
    );
  });

  it('places short ids on the one node in reach', () => {
    expect(records.map((r) => attributionSignature(attributionOf(r)))).toEqual(vectors.attribution);
  });

  it('matches adverts by key and discover replies by a unique prefix', () => {
    expect(records.map((r) => matcher(r)?.pubkey ?? null)).toEqual(vectors.registry);
  });
});

describe('reach', () => {
  it('hashes ids to hue slots', () => {
    const ids = ['a1b2', 'c3d4', 'c3d4e5'.padEnd(64, 'ab').slice(0, 64), 'ffff', 'ALICE'];
    expect(ids.map(hueSlot)).toEqual(vectors.hueSlot);
  });

  it('keeps neighbours apart in hue', () => {
    const hues = assignHues(nodes.map((n) => ({ id: n.pubkey, lat: n.lat, lon: n.lon })));
    expect([...hues]).toEqual(vectors.assignHues);
  });

  it('draws a ray as wide and opaque as the signal is strong', () => {
    const args: [number | null, boolean, boolean][] = [
      [-130, true, false],
      [-90, true, false],
      [-60, false, false],
      [-75, true, true],
      [null, true, false],
    ];
    expect(args.map(([r, two, dim]) => rayStyle(r, { twoWay: two, dimmed: dim }))).toEqual(
      vectors.rayStyle
    );
  });

  it('knows which hearings are a repeater heard', () => {
    expect(records.map(isRepeaterHearing)).toEqual(vectors.repeaterHearing);
  });

  it('keys each hearing to its star', () => {
    expect(records.map((r) => starKeyOf(r, attributionOf, matcher))).toEqual(vectors.starKeys);
  });

  it('builds the stars from the hearings', () => {
    const positionOf = (id: string) => {
      const n = nodes.find((x) => x.pubkey === id);
      return n ? { lat: n.lat, lon: n.lon } : null;
    };
    const stars = coverageStars(records, { positionOf, attributionOf, registryNodeOf: matcher });
    expect(stars.map((s) => ({ id: s.id, origin: s.origin, n: s.points.length }))).toEqual(
      vectors.stars
    );
  });
});

describe('node positions', () => {
  const extra: Hearing[] = [
    {
      sender_kind: 'relay',
      sender_id: 'c3d4',
      sender_role: null,
      lat: 52.14,
      lon: 5.12,
      rssi: -90,
    },
    {
      sender_kind: 'relay',
      sender_id: 'c3d4',
      sender_role: null,
      lat: 52.12,
      lon: 5.14,
      rssi: -92,
    },
    {
      sender_kind: 'relay',
      sender_id: 'c3d4',
      sender_role: null,
      lat: 52.11,
      lon: 5.13,
      rssi: -99,
    },
  ];
  const grouped = groupForNodes([...records, ...extra], nodes, attributionOf);

  it('groups the hearings per node', () => {
    expect(Object.fromEntries([...grouped].map(([k, v]) => [k, v.length]))).toEqual(
      vectors.grouped
    );
  });

  it('places each node advertised against its estimate', () => {
    const rows = nodeRows(nodes, grouped).map((r) => ({
      id: r.id,
      kind: r.p.kind,
      driftM: r.p.driftM ?? null,
      circle: r.p.circle ?? null,
      outsideCircle: r.p.outsideCircle ?? null,
      est: r.est ? { lat: r.est.centroid.lat, lon: r.est.centroid.lon, n: r.est.n } : null,
    }));
    rows.forEach((row, i) => {
      const want = vectors.nodeRows[i];
      expect(row.id).toBe(want.id);
      expect(row.kind).toBe(want.kind);
      expect(row.outsideCircle).toBe(want.outsideCircle);
      if (want.driftM === null) expect(row.driftM).toBeNull();
      else expect(row.driftM).toBeCloseTo(want.driftM, 6);
      if (want.circle === null) expect(row.circle).toBeNull();
      else {
        expect(row.circle!.kind).toBe(want.circle.kind);
        expect(row.circle!.radiusM).toBeCloseTo(want.circle.radiusM, 6);
      }
      if (want.est === null) expect(row.est).toBeNull();
      else {
        expect(row.est!.lat).toBeCloseTo(want.est.lat, 9);
        expect(row.est!.lon).toBeCloseTo(want.est.lon, 9);
        expect(row.est!.n).toBe(want.est.n);
      }
    });
  });
});
