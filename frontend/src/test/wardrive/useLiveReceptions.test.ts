import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildChannelKeys, type ChannelKeys } from '../../wardrive/decode/channels';
import type { Fix, ObsMessage } from '../../wardrive/messages';
import { hexToBytes } from '../../wardrive/packet';
import { openQueue, type Queue } from '../../wardrive/queue';
import type { Companion, RadioReception } from '../../wardrive/radio/companion';
import type { Attribute } from '../../wardrive/discover/useAutoDiscover';
import { useLiveReceptions } from '../../wardrive/useLiveReceptions';
import { TEST_SECRET, groupTextFrame } from './decodeVectors';

// Header 0x15: flood, payload type 5 (GroupText), path of 2 hops (a1, b2).
const RAW = new Uint8Array([0x15, 0x02, 0xa1, 0xb2, 0xc0, 0xff]);
const A = 'AA'.repeat(32);
const B = 'BB'.repeat(32);

let keys: ChannelKeys;
let dbn = 0;

beforeAll(async () => {
  keys = await buildChannelKeys(['#test']);
});

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

function setup(
  companion: FakeCompanion | null,
  fix: Fix | null,
  driving: boolean,
  history: { queue: Queue | null; radioKeys: string[] } = { queue: null, radioKeys: [] }
) {
  return renderHook(
    ({ c, d }) => {
      const fixRef = useRef<Fix | null>(fix);
      return useLiveReceptions(c as unknown as Companion | null, fixRef, d, keys, history);
    },
    { initialProps: { c: companion, d: driving } }
  );
}

function stored(raw: string, origin: string, lat: number): ObsMessage {
  return {
    v: 1,
    origin_id: origin,
    rx_at: '2026-10-20T09:00:00.000Z',
    hash: '0123456789abcdef',
    raw,
    len: raw.length / 2,
    packet_type: 5,
    route: 'F',
    payload_len: 4,
    path: [],
    RSSI: -77,
    SNR: 5,
    pos: { lat, lon: 6, accuracy: 4, src: 'phone' },
  };
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
      stored: false,
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

  it('decodes a channel message with its sender and text', async () => {
    const radio = new FakeCompanion();
    const { result } = setup(radio, null, false);
    act(() => radio.hear({ raw: hexToBytes(groupTextFrame(TEST_SECRET, 'Mike', 'hello')) }));
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest).toMatchObject({
      packetType: 'GroupText',
      sender: { kind: 'channel_name', id: 'Mike' },
      channel: '#test',
      text: 'hello',
      heardDirect: true,
    });
  });

  it('logs a frame it cannot read as Unknown', async () => {
    const radio = new FakeCompanion();
    const { result } = setup(radio, null, false);
    act(() => radio.hear({ raw: new Uint8Array([0xff, 0xff, 0xff]) }));
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest).toMatchObject({ packetType: 'Unknown', sender: { kind: null } });
  });

  it('keeps a burst in arrival order', async () => {
    const radio = new FakeCompanion();
    const { result } = setup(radio, null, false);
    act(() => {
      for (let i = 0; i < 300; i++) radio.hear({ rssi: -60 - (i % 50) });
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(300));
    expect(result.current.entries[0].rssi).toBe(-60 - (299 % 50));
    expect(result.current.entries[299].rssi).toBe(-60);
  });

  it('adds the receptions this browser stored for the account radios', async () => {
    const queue = await openQueue(`test-live-${dbn++}`);
    const frame = groupTextFrame(TEST_SECRET, 'Anna', 'stored');
    await queue.addObs(A, stored(frame, A, 52.5), Date.now() - 60000);
    await queue.addObs(A, stored(frame, A, 52.6), Date.now() - 30000);
    await queue.addObs(B, stored(frame, B, 52.7), Date.now() - 20000);
    const { result } = setup(null, null, false, { queue, radioKeys: [A] });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries.map((e) => e.lat)).toEqual([52.6, 52.5]);
    expect(result.current.entries[0]).toMatchObject({
      stored: true,
      kept: true,
      rssi: -77,
      sender: { kind: 'channel_name', id: 'Anna' },
      text: 'stored',
    });
    queue.close();
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

  it('keeps how well a node answering our ask heard us', async () => {
    const radio = new FakeCompanion();
    const { result } = renderHook(() => {
      const fixRef = useRef<Fix | null>(null);
      const attributeRef = useRef<Attribute | null>(() => ({
        sender: { kind: 'trace_reply', id: 'a1', label: null, role: null },
        heardUsSnr: 6.5,
      }));
      return useLiveReceptions(
        radio as unknown as Companion,
        fixRef,
        false,
        keys,
        { queue: null, radioKeys: [] },
        attributeRef
      );
    });
    act(() => radio.hear());
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest).toMatchObject({
      sender: { kind: 'trace_reply', id: 'a1' },
      heardDirect: true,
      heardUsSnr: 6.5,
    });
  });
});
