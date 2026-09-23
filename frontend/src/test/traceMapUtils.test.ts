import { describe, expect, it } from 'vitest';
import type { Contact, RadioConfig, RadioTraceNode } from '../types';
import {
  buildTraceMapData,
  buildTraceMapSegments,
  formatSNR,
  resolveTraceNodeLocations,
  type TraceMapNode,
} from '../utils/traceMapUtils';

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'ab'.repeat(32),
    name: 'Node',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    route_override_path: null,
    route_override_len: null,
    route_override_hash_mode: null,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<RadioTraceNode>): RadioTraceNode {
  return {
    role: 'repeater',
    public_key: null,
    name: null,
    observed_hash: null,
    snr: null,
    ...overrides,
  };
}

const config: Pick<RadioConfig, 'lat' | 'lon'> = { lat: 52.0, lon: 4.0 };

describe('resolveTraceNodeLocations', () => {
  it('places local nodes at the radio config location', () => {
    const nodes = [makeNode({ role: 'local', public_key: 'local-key' })];
    const [resolved] = resolveTraceNodeLocations(nodes, config, new Map());
    expect(resolved.lat).toBe(52.0);
    expect(resolved.lon).toBe(4.0);
  });

  it('leaves local nodes unlocated when the config has no valid location', () => {
    const nodes = [makeNode({ role: 'local' })];
    const [resolved] = resolveTraceNodeLocations(nodes, { lat: 0, lon: 0 }, new Map());
    expect(resolved.lat).toBeNull();
    expect(resolved.lon).toBeNull();
  });

  it('places a repeater hop at its matching contact advertised location', () => {
    const contact = makeContact({ public_key: 'repeater-1', lat: 52.5, lon: 4.5 });
    const nodes = [makeNode({ role: 'repeater', public_key: 'repeater-1' })];
    const [resolved] = resolveTraceNodeLocations(
      nodes,
      config,
      new Map([[contact.public_key, contact]])
    );
    expect(resolved.lat).toBe(52.5);
    expect(resolved.lon).toBe(4.5);
  });

  it('falls back to a manual location override when the advertised one is unset', () => {
    const contact = makeContact({
      public_key: 'repeater-2',
      lat: null,
      lon: null,
      manual_lat: 51.9,
      manual_lon: 4.4,
    });
    const nodes = [makeNode({ role: 'repeater', public_key: 'repeater-2' })];
    const [resolved] = resolveTraceNodeLocations(
      nodes,
      config,
      new Map([[contact.public_key, contact]])
    );
    expect(resolved.lat).toBe(51.9);
    expect(resolved.lon).toBe(4.4);
  });

  it('leaves a repeater hop unlocated when no matching contact is known', () => {
    const nodes = [makeNode({ role: 'repeater', public_key: 'unknown-repeater' })];
    const [resolved] = resolveTraceNodeLocations(nodes, config, new Map());
    expect(resolved.lat).toBeNull();
    expect(resolved.lon).toBeNull();
  });

  it('always leaves custom hex hops unlocated (no resolvable identity)', () => {
    const nodes = [makeNode({ role: 'custom', public_key: null, observed_hash: 'ab12' })];
    const [resolved] = resolveTraceNodeLocations(nodes, config, new Map());
    expect(resolved.lat).toBeNull();
    expect(resolved.lon).toBeNull();
  });

  it('keeps the original node index, role, name, and snr', () => {
    const nodes = [
      makeNode({ role: 'local' }),
      makeNode({ role: 'repeater', public_key: 'r1', name: 'Summit', snr: 3.5 }),
    ];
    const resolved = resolveTraceNodeLocations(nodes, config, new Map());
    expect(resolved[1]).toMatchObject({ index: 1, role: 'repeater', name: 'Summit', snr: 3.5 });
  });
});

describe('buildTraceMapSegments', () => {
  function loc(index: number, lat: number | null, lon: number | null): TraceMapNode {
    return { index, role: 'repeater', publicKey: null, name: null, snr: null, lat, lon };
  }

  it('draws a solid segment between adjacent located nodes', () => {
    const nodes = [loc(0, 52.0, 4.0), loc(1, 52.1, 4.1)];
    const segments = buildTraceMapSegments(nodes);
    expect(segments).toEqual([
      {
        fromIndex: 0,
        toIndex: 1,
        coordinates: [
          [4.0, 52.0],
          [4.1, 52.1],
        ],
        dashed: false,
      },
    ]);
  });

  it('marks the segment dashed when a hop is skipped between two located nodes', () => {
    // origin -> unlocated hop -> located hop -> terminal
    const nodes = [loc(0, 52.0, 4.0), loc(1, null, null), loc(2, 52.2, 4.2), loc(3, 52.3, 4.3)];
    const segments = buildTraceMapSegments(nodes);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ fromIndex: 0, toIndex: 2, dashed: true });
    expect(segments[1]).toMatchObject({ fromIndex: 2, toIndex: 3, dashed: false });
  });

  it('bridges several consecutive skipped hops with a single dashed segment', () => {
    const nodes = [loc(0, 52.0, 4.0), loc(1, null, null), loc(2, null, null), loc(3, 52.3, 4.3)];
    const segments = buildTraceMapSegments(nodes);
    expect(segments).toEqual([expect.objectContaining({ fromIndex: 0, toIndex: 3, dashed: true })]);
  });

  it('returns no segments when fewer than two nodes are located', () => {
    expect(buildTraceMapSegments([loc(0, 52.0, 4.0), loc(1, null, null)])).toEqual([]);
    expect(buildTraceMapSegments([loc(0, null, null)])).toEqual([]);
    expect(buildTraceMapSegments([])).toEqual([]);
  });
});

describe('buildTraceMapData', () => {
  it('combines location resolution and segment building', () => {
    const contact = makeContact({ public_key: 'r1', lat: 52.1, lon: 4.1 });
    const nodes = [
      makeNode({ role: 'local' }),
      makeNode({ role: 'custom', observed_hash: 'ff' }), // unlocated, skipped
      makeNode({ role: 'repeater', public_key: 'r1' }),
      makeNode({ role: 'local' }),
    ];
    const data = buildTraceMapData(nodes, config, new Map([[contact.public_key, contact]]));
    expect(data.nodes).toHaveLength(4);
    expect(data.segments).toHaveLength(2);
    expect(data.segments[0]).toMatchObject({ fromIndex: 0, toIndex: 2, dashed: true });
    expect(data.segments[1]).toMatchObject({ fromIndex: 2, toIndex: 3, dashed: false });
  });
});

describe('formatSNR', () => {
  it('formats a positive value with a plus sign and one decimal', () => {
    expect(formatSNR(3.46)).toBe('+3.5 dB');
  });

  it('formats a negative value without an extra sign', () => {
    expect(formatSNR(-7.2)).toBe('-7.2 dB');
  });

  it('formats zero with a plus sign', () => {
    expect(formatSNR(0)).toBe('+0.0 dB');
  });

  it('returns null for missing or invalid values', () => {
    expect(formatSNR(null)).toBeNull();
    expect(formatSNR(undefined)).toBeNull();
    expect(formatSNR(Number.NaN)).toBeNull();
  });
});
