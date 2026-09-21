import { describe, it, expect } from 'vitest';
import { toRadarNodes, radarCenter, toRadarData } from '../components/mynode/radar/radarData';

const neighbor = (over: Record<string, unknown> = {}) => ({
  public_key: 'aa'.repeat(32),
  name: 'NodeA',
  heard_count: 3,
  lat: 52.1,
  lon: 5.1,
  best_snr: -6.5,
  ...over,
});

describe('toRadarNodes', () => {
  it('maps located neighbours to RadarNode', () => {
    const nodes = toRadarNodes([neighbor()]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      id: 'aa'.repeat(32),
      name: 'NodeA',
      lat: 52.1,
      lon: 5.1,
      snr: -6.5,
      receptions: 3,
    });
  });

  it('drops unlocated and (0,0) neighbours', () => {
    expect(toRadarNodes([neighbor({ lat: null, lon: 5 })])).toHaveLength(0);
    expect(toRadarNodes([neighbor({ lat: 0, lon: 0 })])).toHaveLength(0);
  });

  it('defaults missing SNR to null', () => {
    const [n] = toRadarNodes([neighbor({ best_snr: undefined })]);
    expect(n.snr).toBeNull();
  });
});

describe('radarCenter', () => {
  it('returns the radio location when usable', () => {
    expect(radarCenter({ lat: 52, lon: 5 })).toEqual({ lat: 52, lon: 5 });
  });
  it('returns null for missing or (0,0) location', () => {
    expect(radarCenter(null)).toBeNull();
    expect(radarCenter({ lat: null, lon: 5 })).toBeNull();
    expect(radarCenter({ lat: 0, lon: 0 })).toBeNull();
  });
});

describe('toRadarData', () => {
  it('assembles center + nodes', () => {
    const data = toRadarData([neighbor()], { lat: 52, lon: 5 });
    expect(data.center).toEqual({ lat: 52, lon: 5 });
    expect(data.nodes).toHaveLength(1);
  });
});
