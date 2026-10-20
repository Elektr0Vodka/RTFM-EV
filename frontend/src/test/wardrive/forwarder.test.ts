import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BROKERS, destId, type Broker } from '../../wardrive/forward/brokers';
import type { MqttCredentials, MqttLike } from '../../wardrive/forward/client';
import { Forwarder, enableBroker } from '../../wardrive/forward/forwarder';
import type { BrokerSettings } from '../../wardrive/forward/settings';
import { buildToken } from '../../wardrive/forward/token';
import type { ObsMessage, TrackMessage } from '../../wardrive/messages';
import { openQueue, type Queue } from '../../wardrive/queue';
import type { Companion } from '../../wardrive/radio/companion';

const A = 'AA'.repeat(32);
const B = 'BB'.repeat(32);
const NOW = 1792404000;
const DMC_W = DEFAULT_BROKERS.find((b) => b.id === 'dmc-wardriver') as Broker;
const ANALYZER: Broker = {
  id: 'meshcore-analyzer',
  name: 'meshcore-analyzer.eu',
  url: 'wss://mqtt.meshcore-analyzer.eu:443',
  audience: 'mqtt.meshcore-analyzer.eu',
  auth: 'companion',
  format: 'packets',
  region: 'nl',
  builtin: true,
};
const CLUB: Broker = {
  id: 'club-mqtt',
  name: 'Club MQTT',
  url: 'wss://mqtt.example.org:8084/mqtt',
  audience: 'mqtt.example.org',
  auth: 'password',
  username: 'club',
  password: 's3cret-pass',
  format: 'packets',
  region: 'ams',
  builtin: false,
};
let n = 0;
let queue: Queue;

const obs = (key: string, rxAt: string): ObsMessage => ({
  v: 1,
  origin_id: key,
  rx_at: rxAt,
  hash: '0123456789abcdef',
  raw: '1502a1b2c0ff',
  len: 6,
  packet_type: 5,
  route: 'F',
  payload_len: 2,
  path: ['a1', 'b2'],
  pos: { lat: 52, lon: 5, src: 'phone' },
});

const track = (key: string, t0: string): TrackMessage => ({
  v: 1,
  origin_id: key,
  t0,
  t1: t0,
  lat: 52,
  lon: 5,
  rx_count: 1,
  listening: true,
  src: 'phone',
});

class FakeClient implements MqttLike {
  published: { topic: string; payload: unknown }[] = [];
  failNext = false;
  closed = false;
  private closeCbs: (() => void)[] = [];
  async publish(topic: string, payload: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('publish not acknowledged');
    }
    this.published.push({ topic, payload: JSON.parse(payload) });
  }
  async end() {
    this.closed = true;
  }
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }
}

function fakeCompanion(opts: { refuse?: boolean } = {}) {
  const sign = vi.fn(async () => {
    if (opts.refuse) throw new Error('The radio refused to sign (error 1)');
    return new Uint8Array(64).fill(7);
  });
  return { companion: { sign } as unknown as Companion, sign };
}

function forwarder(
  broker: Broker,
  radioKey: string,
  over: Partial<{ settings: BrokerSettings; companion: Companion; client: FakeClient }> = {}
) {
  const client = over.client ?? new FakeClient();
  const connect = vi.fn(async (_url: string, _creds: MqttCredentials) => client);
  const settings: BrokerSettings = over.settings ?? { enabled: {}, tokens: {} };
  const saveToken = vi.fn((key: string, token: string) => {
    settings.tokens[key] = token;
  });
  const fw = new Forwarder({
    broker,
    radioKey,
    queue,
    companion: over.companion ?? fakeCompanion().companion,
    connect,
    settings: () => settings,
    saveToken,
    nowSec: () => NOW,
  });
  return { fw, client, connect, saveToken, settings };
}

beforeEach(async () => {
  queue = await openQueue(`forwarder-${n++}`);
});

describe('Forwarder', () => {
  it('publishes this radio obs and tracks to the wardrive topics and acks after the broker acks', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    await queue.addTrack(A, track(A, 't1'));
    const { fw, client, connect } = forwarder(DMC_W, A);
    const status = await fw.tick();
    expect(connect).toHaveBeenCalledWith('wss://collector2.dutchmeshcore.nl:443', {
      username: `v1_${A}`,
      password: expect.stringMatching(/^[\w-]+\.[\w-]+\.[0-9a-f]{128}$/),
      clientId: `wardrive-${A.toLowerCase()}`,
    });
    expect(client.published.map((p) => p.topic)).toEqual([
      `meshcore/wardriver/${A}/wardriver/obs`,
      `meshcore/wardriver/${A}/wardriver/track`,
    ]);
    const { pub_at, ...rest } = client.published[0].payload as ObsMessage;
    expect(rest).toEqual(obs(A, 'o1'));
    expect(pub_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(client.published[1].payload).toEqual(track(A, 't1'));
    expect(status).toMatchObject({ state: 'connected', pending: 0 });
    expect(await queue.batchForRadio(destId('dmc-wardriver', A), 'obs', A, 10)).toEqual([]);
  });

  it('stamps pub_at at publish time in core-hunter key order', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const { fw, client } = forwarder(DMC_W, A);
    await fw.tick();
    expect(Object.keys(client.published[0].payload as object).slice(0, 5)).toEqual([
      'v',
      'origin_id',
      'rx_at',
      'pub_at',
      'hash',
    ]);
  });

  it('never publishes another radio rows', async () => {
    await queue.addObs(B, obs(B, 'b1'));
    await queue.addObs(A, obs(A, 'a1'));
    const { fw, client } = forwarder(DMC_W, A);
    await fw.tick();
    expect(client.published.map((p) => p.topic)).toEqual([`meshcore/wardriver/${A}/wardriver/obs`]);
  });

  it('keeps rows when a publish is not acked and retries after reconnecting', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    await queue.addObs(A, obs(A, 'o2'));
    const client = new FakeClient();
    client.failNext = true;
    const { fw, connect } = forwarder(DMC_W, A, { client });
    expect(await fw.tick()).toMatchObject({ state: 'error', pending: 2 });
    expect(client.closed).toBe(true);
    expect(await fw.tick()).toMatchObject({ state: 'connected', pending: 0 });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(client.published.map((p) => (p.payload as ObsMessage).rx_at)).toEqual(['o1', 'o2']);
  });

  it('reuses a usable token and asks the radio for a new one near expiry', async () => {
    const { companion, sign } = fakeCompanion();
    const host = 'collector2.dutchmeshcore.nl';
    const fresh = await buildToken(A, host, NOW - 100, async () => new Uint8Array(64));
    const settings: BrokerSettings = {
      enabled: {},
      tokens: { [`${host}@${A}`]: fresh },
    };
    const first = forwarder(DMC_W, A, { companion, settings });
    await first.fw.tick();
    expect(sign).not.toHaveBeenCalled();
    expect(first.connect.mock.calls[0][1]).toMatchObject({ password: fresh });

    const old = await buildToken(A, host, NOW - 86000, async () => new Uint8Array(64));
    settings.tokens[`${host}@${A}`] = old;
    const second = forwarder(DMC_W, A, { companion, settings });
    await second.fw.tick();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(second.saveToken).toHaveBeenCalledWith(`${host}@${A}`, expect.not.stringMatching(old));
  });

  it('reports sign-failed when the radio refuses to sign', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const { fw, connect } = forwarder(DMC_W, A, {
      companion: fakeCompanion({ refuse: true }).companion,
    });
    expect(await fw.tick()).toMatchObject({ state: 'sign-failed', pending: 1 });
    expect(connect).not.toHaveBeenCalled();
  });

  it('sends obs to a packets broker as observer packets and marks tracks done', async () => {
    await queue.addObs(A, obs(A, '2026-10-19T10:00:00.000Z'));
    await queue.addTrack(A, track(A, 't1'));
    const { fw, client, connect, saveToken } = forwarder(ANALYZER, A);
    expect(await fw.tick()).toMatchObject({ state: 'connected', pending: 0 });
    expect(connect).toHaveBeenCalledWith('wss://mqtt.meshcore-analyzer.eu:443', {
      username: `v1_${A}`,
      password: expect.stringMatching(/^[\w-]+\.[\w-]+\.[0-9a-f]{128}$/),
      clientId: `wardrive-${A.toLowerCase()}`,
    });
    // The token is signed for the served audience.
    expect(saveToken).toHaveBeenCalledWith(`mqtt.meshcore-analyzer.eu@${A}`, expect.any(String));
    expect(client.published).toHaveLength(1);
    expect(client.published[0].topic).toBe(`meshcore/NL/${A}/packets`);
    expect(client.published[0].payload).toMatchObject({
      type: 'PACKET',
      origin_id: A,
      timestamp: '2026-10-19T10:00:00.000Z',
      raw: '1502A1B2C0FF',
      route: 'F',
    });
    expect(await queue.batchForRadio(destId('meshcore-analyzer', A), 'track', A, 10)).toEqual([]);
  });

  it('signs for the audience the server names, not the URL host', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const { fw, saveToken } = forwarder({ ...ANALYZER, audience: 'aud.example.org' }, A);
    await fw.tick();
    expect(saveToken).toHaveBeenCalledWith(`aud.example.org@${A}`, expect.any(String));
  });

  it('connects to a password broker with the owner account', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const { fw, client, connect } = forwarder(CLUB, A);
    expect(await fw.tick()).toMatchObject({ state: 'connected' });
    expect(connect).toHaveBeenCalledWith('wss://mqtt.example.org:8084/mqtt', {
      username: 'club',
      password: 's3cret-pass',
      clientId: `wardrive-${A.toLowerCase()}`,
    });
    expect(client.published[0].topic).toBe(`meshcore/AMS/${A}/packets`);
  });

  it('does not connect to a password broker served without a password', async () => {
    const { fw, connect } = forwarder({ ...CLUB, password: undefined }, A);
    expect(await fw.tick()).toMatchObject({ state: 'error' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('drops the client when the broker closes the connection and reconnects next tick', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const { fw, client, connect } = forwarder(DMC_W, A);
    await fw.tick();
    (client as unknown as { closeCbs: (() => void)[] }).closeCbs.forEach((cb) => cb());
    await queue.addObs(A, obs(A, 'o2'));
    await fw.tick();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('Forwarder stop', () => {
  it('closes a connection that comes up after the broker was switched off', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const client = new FakeClient();
    let finishConnect: (c: MqttLike) => void = () => {};
    const fw = new Forwarder({
      broker: DMC_W,
      radioKey: A,
      queue,
      companion: fakeCompanion().companion,
      connect: () => new Promise<MqttLike>((r) => (finishConnect = r)),
      settings: () => ({ enabled: {}, tokens: {} }),
      saveToken: () => {},
      nowSec: () => NOW,
    });
    const ticking = fw.tick();
    await vi.waitFor(() => expect(finishConnect).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 20));
    await fw.stop();
    finishConnect(client);
    expect(await ticking).toMatchObject({ state: 'off' });
    expect(client.closed).toBe(true);
    expect(client.published).toEqual([]);
  });
});

describe('enableBroker', () => {
  it('switches a broker on from the newest row', async () => {
    await queue.addObs(A, obs(A, 'old'));
    await queue.addTrack(A, track(A, 'old'));
    const settings: BrokerSettings = { enabled: {}, tokens: {} };
    const next = await enableBroker(queue, settings, 'dmc-wardriver', A);
    expect(next.enabled[destId('dmc-wardriver', A)]).toBe(true);
    expect(await queue.batchForRadio(destId('dmc-wardriver', A), 'obs', A, 10)).toEqual([]);
    expect(await queue.batchForRadio(destId('dmc-wardriver', A), 'track', A, 10)).toEqual([]);
    await queue.addObs(A, obs(A, 'new'));
    const rows = await queue.batchForRadio(destId('dmc-wardriver', A), 'obs', A, 10);
    expect(rows.map((r) => (r.message as ObsMessage).rx_at)).toEqual(['new']);
  });
});
