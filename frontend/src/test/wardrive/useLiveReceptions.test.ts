import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import type { Companion, RadioReception } from '../../wardrive/radio/companion';
import { useLiveReceptions } from '../../wardrive/useLiveReceptions';

// Header 0x15: flood, payload type 5 (GroupText), path of 2 hops (a1, b2).
const RAW = new Uint8Array([0x15, 0x02, 0xa1, 0xb2, 0xc0, 0xff]);

class FakeCompanion {
  private cbs = new Set<(r: RadioReception) => void>();
  onReception(cb: (r: RadioReception) => void) {
    this.cbs.add(cb);
    return () => {
      this.cbs.delete(cb);
    };
  }
  hear(r: Partial<RadioReception> = {}) {
    for (const cb of this.cbs) cb({ snr: 4, rssi: -90, raw: RAW, ...r });
  }
  get listeners() {
    return this.cbs.size;
  }
}

function setup(companion: FakeCompanion | null, fix: Fix | null, driving: boolean) {
  return renderHook(
    ({ c, d }) => {
      const fixRef = useRef<Fix | null>(fix);
      return useLiveReceptions(c as unknown as Companion | null, fixRef, d);
    },
    { initialProps: { c: companion, d: driving } }
  );
}

describe('useLiveReceptions', () => {
  it('logs what the radio hears while not driving, as heard only', async () => {
    const radio = new FakeCompanion();
    const { result } = setup(radio, null, false);
    act(() => radio.hear());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.latest).toMatchObject({
      rssi: -90,
      snr: 4,
      payloadType: 5,
      typeName: 'GroupText',
      direct: false,
      hops: 2,
      kept: false,
      lat: null,
    });
  });

  it('marks a reception kept while driving with a usable fix', async () => {
    const radio = new FakeCompanion();
    const fix: Fix = { lat: 52.1, lon: 5.1, accM: 5, at: Date.now() };
    const { result } = setup(radio, fix, true);
    act(() => radio.hear());
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest).toMatchObject({ kept: true, lat: 52.1, lon: 5.1 });
  });

  it('keeps the newest 200 of a burst', async () => {
    const radio = new FakeCompanion();
    const { result } = setup(radio, null, false);
    act(() => {
      for (let i = 0; i < 300; i++) radio.hear({ rssi: -60 - (i % 50) });
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
  });

  it('logs nothing without a radio', () => {
    const { result } = setup(null, null, false);
    expect(result.current.entries).toEqual([]);
    expect(result.current.latest).toBeNull();
  });

  it('stops listening when it goes', async () => {
    const radio = new FakeCompanion();
    const { unmount } = setup(radio, null, false);
    expect(radio.listeners).toBe(1);
    unmount();
    expect(radio.listeners).toBe(0);
  });
});
