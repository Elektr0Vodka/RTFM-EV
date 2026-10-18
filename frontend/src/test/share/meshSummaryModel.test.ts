import { describe, expect, it } from 'vitest';
import { buildMeshSummaryModel } from '../../share/cards/meshSummary';

const contact = (key: string, lat: number | null, lon: number | null, flood = 0) => ({
  public_key: key,
  lat,
  lon,
  flood_count: flood,
});

describe('buildMeshSummaryModel', () => {
  it('counts active nodes, flood adverts and places located nodes', () => {
    const m = buildMeshSummaryModel({
      totalContacts: 3,
      contacts: [contact('a', 52, 5, 2), contact('b', null, null, 1), contact('c', 0, 0, 4)],
      totalPackets: 1200,
      airtime: [],
      heardBins: null,
      packetBins: null,
    });
    expect(m.activeNodes).toBe(3);
    expect(m.floodAdverts).toBe(7);
    expect(m.nodes.map((n) => n.key)).toEqual(['a']);
    expect(m.packets).toBe(1200);
  });

  it('averages TX plus RX airtime and leaves it out without samples', () => {
    const base = {
      totalContacts: 0,
      contacts: [],
      totalPackets: null,
      heardBins: null,
      packetBins: null,
    };
    expect(
      buildMeshSummaryModel({
        ...base,
        airtime: [
          { timestamp: 1, tx_pct: 1, rx_pct: 9 },
          { timestamp: 2, tx_pct: 3, rx_pct: 7 },
        ],
      }).airtimePct
    ).toBe(10);
    expect(buildMeshSummaryModel({ ...base, airtime: [] }).airtimePct).toBeNull();
  });

  it('pairs heard keys with packet counts per bin', () => {
    const m = buildMeshSummaryModel({
      totalContacts: 2,
      contacts: [contact('a', 52, 5), contact('b', 52.1, 5)],
      totalPackets: 10,
      airtime: [],
      heardBins: [{ keys: ['a'] }, { keys: [] }, { keys: ['a', 'b'] }],
      packetBins: [4, 0, 6],
    });
    expect(m.bins.map((b) => [...b.keys])).toEqual([['a'], [], ['a', 'b']]);
    expect(m.bins.map((b) => b.packets)).toEqual([4, 0, 6]);
  });

  it('has no bins when the history is missing', () => {
    const m = buildMeshSummaryModel({
      totalContacts: 0,
      contacts: [],
      totalPackets: null,
      airtime: [],
      heardBins: null,
      packetBins: null,
    });
    expect(m.bins).toEqual([]);
    expect(m.located).toEqual([]);
  });
});
