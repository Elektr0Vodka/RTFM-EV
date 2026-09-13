import { describe, expect, it, vi } from 'vitest';
import { PayloadType } from '@michaelhart/meshcore-decoder';

import {
  buildPacketNetworkContext,
  createPacketNetworkState,
  ingestPacketIntoPacketNetwork,
  type PacketNetworkContext,
} from '../../networkGraph/packetNetworkGraph';
import { createPacketTimeline, type CoordResolver } from '../../map/packets/packetTimeline';
import { PULSE_MS, LINK_DIM_MS } from '../../map/packets/packetAnimMath';
import type { Contact, RadioConfig, RawPacket } from '../../types';

const { packetFixtures } = vi.hoisted(() => ({
  packetFixtures: new Map<string, unknown>(),
}));

vi.mock('../../utils/visualizerUtils', async () => {
  const actual = await vi.importActual<typeof import('../../utils/visualizerUtils')>(
    '../../utils/visualizerUtils'
  );
  return {
    ...actual,
    parsePacket: vi.fn(
      (hexData: string) => packetFixtures.get(hexData) ?? actual.parsePacket(hexData)
    ),
  };
});

const SELF_KEY = 'ffffffffffff0000000000000000000000000000000000000000000000000000';
const ALICE_KEY = 'aaaaaaaaaaaa0000000000000000000000000000000000000000000000000000';

packetFixtures.set('dm-direct', {
  payloadType: PayloadType.TextMessage,
  messageHash: 'dm-direct',
  pathBytes: [],
  srcHash: 'aaaaaaaaaaaa',
  dstHash: 'ffffffffffff',
  advertPubkey: null,
  groupTextSender: null,
  anonRequestPubkey: null,
});

packetFixtures.set('dm-relay', {
  payloadType: PayloadType.TextMessage,
  messageHash: 'dm-relay',
  pathBytes: ['32'],
  srcHash: 'aaaaaaaaaaaa',
  dstHash: 'ffffffffffff',
  advertPubkey: null,
  groupTextSender: null,
  anonRequestPubkey: null,
});

function createConfig(): RadioConfig {
  return {
    public_key: SELF_KEY,
    name: 'Me',
    lat: 0,
    lon: 0,
    tx_power: 0,
    max_tx_power: 0,
    radio: { freq: 0, bw: 0, sf: 0, cr: 0 },
    path_hash_mode: 0,
    path_hash_mode_supported: true,
    advert_location_source: 'off',
  };
}

function createContact(publicKey: string, name: string): Contact {
  return {
    public_key: publicKey,
    name,
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
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
  };
}

function createPacket(data: string): RawPacket {
  return {
    id: 1,
    observation_id: 1,
    timestamp: 1_700_000_000,
    data,
    payload_type: 'TEXT',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
  };
}

function makeContext(): PacketNetworkContext {
  return buildPacketNetworkContext({
    contacts: [createContact(ALICE_KEY, 'Alice')],
    config: createConfig(),
    repeaterAdvertPaths: [],
    splitAmbiguousByTraffic: false,
    useAdvertPathHints: false,
  });
}

/** Probe the real graph to learn the node ids for a fixture. */
function probePath(data: string): string[] {
  const state = createPacketNetworkState('Me');
  const r = ingestPacketIntoPacketNetwork(state, makeContext(), createPacket(data));
  return r?.canonicalPath ?? [];
}

describe('packetTimeline', () => {
  const directPath = probePath('dm-direct');
  const relayPath = probePath('dm-relay');
  const srcId = directPath[0];
  const SELF: [number, number] = [5, 52];
  const SRC: [number, number] = [6, 53];
  const resolveCoord: CoordResolver = (id) => {
    if (id === 'self') return { lat: SELF[1], lon: SELF[0] };
    if (id === srcId) return { lat: SRC[1], lon: SRC[0] };
    return undefined; // relay + unknowns unresolved
  };

  function makeTimeline() {
    return createPacketTimeline({
      resolveCoord,
      getContext: makeContext,
      state: createPacketNetworkState('Me'),
    });
  }

  it('resolves a direct packet to one witnessed arc with pulse and glow', () => {
    const tl = makeTimeline();
    tl.ingest([createPacket('dm-direct')]);
    const { minMs, maxMs } = tl.range();
    expect(minMs).toBe(maxMs);
    const heardMs = maxMs;

    const now = tl.stateAsOf(heardMs);
    expect(now.arcs).toHaveLength(1);
    expect(now.arcs[0].witnessed).toBe(true);
    expect(now.arcs[0].opacity).toBe(1);
    expect(now.arcs[0].color).toEqual([150, 150, 150]); // null snr -> neutral
    expect(now.glows).toHaveLength(1);
    expect(now.glows[0].intensity).toBeCloseTo(1, 5);
    expect(now.pulses).toHaveLength(0); // p=0 at exactly heardMs

    const mid = tl.stateAsOf(heardMs + PULSE_MS / 2);
    expect(mid.pulses).toHaveLength(1);
    expect(mid.pulses[0].color).toHaveLength(3);

    const old = tl.stateAsOf(heardMs + LINK_DIM_MS + 1);
    expect(old.arcs).toHaveLength(0);
    expect(old.glows).toHaveLength(0);
    expect(old.pulses).toHaveLength(0);
  });

  it('dedupes repeated ingests of the same observation', () => {
    const tl = makeTimeline();
    tl.ingest([createPacket('dm-direct')]);
    tl.ingest([createPacket('dm-direct')]);
    const heardMs = tl.range().maxMs;
    expect(tl.stateAsOf(heardMs).arcs).toHaveLength(1);
  });

  it('bridges an unresolved middle hop without emitting a [0,0] endpoint', () => {
    expect(relayPath.length).toBeGreaterThanOrEqual(3); // source -> relay -> self
    const tl = makeTimeline();
    tl.ingest([createPacket('dm-relay')]);
    const heardMs = tl.range().maxMs;
    const arcs = tl.stateAsOf(heardMs).arcs;
    expect(arcs).toHaveLength(1); // single bridged arc source -> self
    expect(arcs[0].witnessed).toBe(true);
    expect(arcs[0].s).not.toEqual([0, 0, 0]);
    expect(arcs[0].t).not.toEqual([0, 0, 0]);
  });
});
