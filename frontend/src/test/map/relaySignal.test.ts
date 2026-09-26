import { describe, expect, it } from 'vitest';

import type { RelaySummary } from '../../components/MeshRelayReceptionPanel';
import { buildRelaySignalFeatures, relayRingRadius } from '../../map/layers/relaySignalLayer';
import type { Contact } from '../../types';

function contact(publicKey: string, name: string, lat: number | null, lon: number | null): Contact {
  return {
    public_key: publicKey,
    name,
    type: 2,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat,
    lon,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

function relay(overrides: Partial<RelaySummary>): RelaySummary {
  return {
    last_hop_hex: 'aa',
    receptions: 4,
    packets: 3,
    best_snr: 8,
    avg_snr: 5.25,
    last_snr: 4,
    best_rssi: -90,
    last_seen: 1_700_000_000,
    resolved_pubkey: null,
    resolved_name: null,
    candidates: 1,
    ...overrides,
  };
}

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);

describe('relay signal overlay', () => {
  it('places resolved relays at their contact position with SNR colour and label', () => {
    const { collection, placed, unplaced } = buildRelaySignalFeatures(
      [relay({ resolved_pubkey: KEY_A, resolved_name: 'Relay A', receptions: 8 })],
      [contact(KEY_A, 'Relay A', 52.1, 4.3)]
    );
    expect(placed).toBe(1);
    expect(unplaced).toBe(0);
    const feature = collection.features[0];
    expect(feature.geometry.coordinates).toEqual([4.3, 52.1]);
    expect(feature.properties.name).toBe('Relay A');
    expect(feature.properties.label).toBe('+5.3 dB · 8×');
    expect(feature.properties.color).toMatch(/^rgb\(/);
    expect(feature.properties.radius).toBe(relayRingRadius(8));
  });

  it('counts unresolved, colliding and unlocated relays as unplaced and skips the direct row', () => {
    const { placed, unplaced } = buildRelaySignalFeatures(
      [
        relay({ last_hop_hex: 'f1', resolved_pubkey: null, candidates: 5 }),
        relay({ resolved_pubkey: KEY_B }),
        relay({ last_hop_hex: null, resolved_pubkey: null }),
      ],
      [contact(KEY_B, 'No GPS', null, null)]
    );
    expect(placed).toBe(0);
    expect(unplaced).toBe(2);
  });

  it('shows only the count when the average SNR is unknown', () => {
    const { collection } = buildRelaySignalFeatures(
      [relay({ resolved_pubkey: KEY_A, avg_snr: null, receptions: 1 })],
      [contact(KEY_A, 'Relay A', 52.1, 4.3)]
    );
    expect(collection.features[0].properties.label).toBe('1×');
    expect(collection.features[0].properties.color).toBe('rgb(150, 150, 150)');
  });

  it('grows the ring with receptions and caps it', () => {
    expect(relayRingRadius(1)).toBe(11);
    expect(relayRingRadius(4)).toBeGreaterThan(relayRingRadius(2));
    expect(relayRingRadius(100_000)).toBe(26);
  });
});
