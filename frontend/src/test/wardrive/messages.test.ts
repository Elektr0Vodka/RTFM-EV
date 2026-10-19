import { describe, expect, it } from 'vitest';

import { buildObs, buildTrack } from '../../wardrive/messages';
import { hexToBytes } from '../../wardrive/packet';
import { FRAME_VECTORS, OBS_NOACC_VECTOR, OBS_VECTOR, TRACK_VECTOR } from './vectors';

const ORIGIN = 'ab'.repeat(32);
const FIX = { lat: 52.1234567, lon: 5.7654321, accM: 4.25, at: 0 };

function reception(
  over: Partial<{ snr: number | null; rssi: number | null; accM: number | null }> = {}
) {
  return {
    rxAt: '2026-10-19T10:00:00.000Z',
    raw: hexToBytes(FRAME_VECTORS[0].raw),
    snr: over.snr === undefined ? 6.5 : over.snr,
    rssi: over.rssi === undefined ? -92 : over.rssi,
    fix: { ...FIX, accM: over.accM === undefined ? FIX.accM : over.accM },
  };
}

describe('wardrive obs and track messages', () => {
  it('builds the obs like core-hunter, field for field and in order', async () => {
    const obs = await buildObs(reception(), ORIGIN, '2026-10-19T10:00:01.000Z');
    expect(JSON.stringify(obs)).toBe(JSON.stringify(OBS_VECTOR));
  });

  it('omits accuracy, RSSI and pub_at when unknown', async () => {
    const obs = await buildObs(reception({ rssi: null, accM: null }), ORIGIN);
    expect(JSON.stringify(obs)).toBe(JSON.stringify(OBS_NOACC_VECTOR));
  });

  it('builds the track like core-hunter', () => {
    const track = buildTrack(
      {
        t0: 'a',
        t1: 'b',
        lat: 52.1234567,
        lon: 5.7654321,
        accM: 4.25,
        rxCount: 3,
        listening: true,
      },
      ORIGIN
    );
    expect(JSON.stringify(track)).toBe(JSON.stringify(TRACK_VECTOR));
  });

  it('returns null for an obs whose frame cannot be walked', async () => {
    const rec = { ...reception(), raw: hexToBytes('15') };
    expect(await buildObs(rec, ORIGIN)).toBeNull();
  });
});
