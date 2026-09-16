import { describe, it, expect } from 'vitest';
import {
  buildNeonNodeData,
  buildNeonNodeLayers,
  hexToRgb,
  type NeonNodeDatum,
} from '../../map/layers/neonNodesLayer';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_CLIENT, type Contact } from '../../types';

const now = 1_000_000; // seconds
const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: 52,
  lon: 5,
  last_seen: now,
  on_radio: true,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

interface FakeLayer {
  props: Record<string, unknown>;
}
function fakeDeck() {
  class ScatterplotLayer implements FakeLayer {
    props: Record<string, unknown>;
    constructor(p: Record<string, unknown>) {
      this.props = p;
    }
  }
  return { ScatterplotLayer } as unknown as typeof import('deck.gl');
}

describe('hexToRgb', () => {
  it('parses #rrggbb (with or without #)', () => {
    expect(hexToRgb('#06b6d4')).toEqual([6, 182, 212]);
    expect(hexToRgb('2563eb')).toEqual([37, 99, 235]);
  });
  it('falls back to grey on a malformed value', () => {
    expect(hexToRgb('nope')).toEqual([148, 163, 184]);
  });
});

describe('buildNeonNodeData', () => {
  it('drops nodes with no position and carries tier + repeater flag', () => {
    const data = buildNeonNodeData(
      [
        contact({ public_key: 'a', type: CONTACT_TYPE_REPEATER }),
        contact({ public_key: 'b', lat: null }),
        contact({ public_key: 'c', last_seen: now - 10 * 86400 }),
      ],
      now
    );
    expect(data).toHaveLength(2); // 'b' dropped
    expect(data[0]).toMatchObject({
      pos: [5, 52],
      tier: 'recent',
      repeater: true,
      type: CONTACT_TYPE_REPEATER,
    });
    expect(data[1]).toMatchObject({ tier: 'old', repeater: false, type: CONTACT_TYPE_CLIENT });
  });
});

describe('buildNeonNodeLayers', () => {
  const data: NeonNodeDatum[] = [
    { pos: [5, 52], tier: 'recent', repeater: false, type: CONTACT_TYPE_CLIENT },
    { pos: [6, 53], tier: 'old', repeater: true, type: CONTACT_TYPE_REPEATER },
  ];

  it('builds a halo layer under a core layer with stable ids', () => {
    const layers = buildNeonNodeLayers(fakeDeck(), data) as unknown as FakeLayer[];
    expect(layers.map((l) => l.props.id)).toEqual(['neon-nodes-halo', 'neon-nodes-core']);
  });

  it('halo is bigger and more translucent than the core', () => {
    const [halo, core] = buildNeonNodeLayers(fakeDeck(), data) as unknown as FakeLayer[];
    const haloR = halo.props.getRadius as (d: NeonNodeDatum) => number;
    const coreR = core.props.getRadius as (d: NeonNodeDatum) => number;
    expect(haloR(data[0])).toBeGreaterThan(coreR(data[0]));
    const haloFill = halo.props.getFillColor as (d: NeonNodeDatum) => number[];
    const coreFill = core.props.getFillColor as (d: NeonNodeDatum) => number[];
    expect(haloFill(data[0])[3]).toBeLessThan(coreFill(data[0])[3]);
  });

  it('repeaters render larger and node scale multiplies the radius', () => {
    const [, core] = buildNeonNodeLayers(fakeDeck(), data) as unknown as FakeLayer[];
    const r = core.props.getRadius as (d: NeonNodeDatum) => number;
    expect(r(data[1])).toBeGreaterThan(r(data[0])); // repeater > client
    const [, coreScaled] = buildNeonNodeLayers(fakeDeck(), data, 2) as unknown as FakeLayer[];
    const r2 = coreScaled.props.getRadius as (d: NeonNodeDatum) => number;
    expect(r2(data[0])).toBeCloseTo(2 * r(data[0]), 5);
  });

  it('colours the core by recency tier', () => {
    const [, core] = buildNeonNodeLayers(fakeDeck(), data) as unknown as FakeLayer[];
    const fill = core.props.getFillColor as (d: NeonNodeDatum) => number[];
    // 'recent' -> #06b6d4 -> [6,182,212]
    expect(fill(data[0]).slice(0, 3)).toEqual([6, 182, 212]);
  });

  it('rings the core with the per-type role colour (matches the legend/picker)', () => {
    const roleColors = { [CONTACT_TYPE_CLIENT]: '#010203', [CONTACT_TYPE_REPEATER]: '#0a141e' };
    const [, core] = buildNeonNodeLayers(fakeDeck(), data, 1, roleColors) as unknown as FakeLayer[];
    const line = core.props.getLineColor as (d: NeonNodeDatum) => number[];
    expect(line(data[0]).slice(0, 3)).toEqual([1, 2, 3]); // client -> #010203
    expect(line(data[1]).slice(0, 3)).toEqual([10, 20, 30]); // repeater -> #0a141e
  });

  it('defaults the core ring to the NODE_TYPE_STROKE colour for the type', () => {
    const [, core] = buildNeonNodeLayers(fakeDeck(), data) as unknown as FakeLayer[];
    const line = core.props.getLineColor as (d: NeonNodeDatum) => number[];
    // repeater default stroke #f8fafc -> [248,250,252]
    expect(line(data[1]).slice(0, 3)).toEqual([248, 250, 252]);
  });
});
