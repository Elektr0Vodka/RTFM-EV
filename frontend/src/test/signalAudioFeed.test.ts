import { describe, it, expect } from 'vitest';
import type { RawPacket } from '../types';
import { selectPacketsToPlay } from '../utils/signalAudioFeed';

function pkt(id: number, observationId?: number): RawPacket {
  return {
    id,
    observation_id: observationId,
    timestamp: id,
    data: '',
    payload_type: 'ADVERT',
    snr: 0,
    rssi: 0,
    decrypted: false,
    decrypted_info: null,
  };
}

describe('selectPacketsToPlay', () => {
  it('plays nothing and clears the baseline for an empty buffer', () => {
    expect(selectPacketsToPlay([], 'db-3')).toEqual({ toPlay: [], nextKey: null });
  });

  it('baselines to the newest packet without playing on first run (null lastKey)', () => {
    const packets = [pkt(1), pkt(2), pkt(3)];
    const result = selectPacketsToPlay(packets, null);
    expect(result.toPlay).toEqual([]);
    expect(result.nextKey).toBe('db-3');
  });

  it('plays the single new packet appended since the last key', () => {
    const packets = [pkt(1), pkt(2), pkt(3)];
    const result = selectPacketsToPlay(packets, 'db-2');
    expect(result.toPlay.map((p) => p.id)).toEqual([3]);
    expect(result.nextKey).toBe('db-3');
  });

  it('plays multiple new packets in order', () => {
    const packets = [pkt(1), pkt(2), pkt(3)];
    const result = selectPacketsToPlay(packets, 'db-1');
    expect(result.toPlay.map((p) => p.id)).toEqual([2, 3]);
    expect(result.nextKey).toBe('db-3');
  });

  it('plays nothing when the last key is already the newest', () => {
    const packets = [pkt(1), pkt(2), pkt(3)];
    expect(selectPacketsToPlay(packets, 'db-3')).toEqual({ toPlay: [], nextKey: 'db-3' });
  });

  it('does not replay a backfill when the last key is gone (reconnect/seed)', () => {
    const packets = [pkt(10), pkt(11), pkt(12)];
    const result = selectPacketsToPlay(packets, 'db-2');
    expect(result.toPlay).toEqual([]);
    expect(result.nextKey).toBe('db-12');
  });

  it('keys on observation_id when present', () => {
    const packets = [pkt(1, 100), pkt(1, 101)];
    const result = selectPacketsToPlay(packets, 'obs-100');
    expect(result.toPlay.map((p) => p.observation_id)).toEqual([101]);
    expect(result.nextKey).toBe('obs-101');
  });
});
