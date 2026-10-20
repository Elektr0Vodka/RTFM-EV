import { getPayloadTypeName, verifyAuthToken } from '@michaelhart/meshcore-decoder';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BROKERS, destId, parseBrokers } from '../../wardrive/forward/brokers';
import { loadServedBrokers, saveServedBrokers } from '../../wardrive/forward/brokerConfig';
import {
  observerPacket,
  observerTopic,
  obsTopic,
  payloadTypeName,
  trackTopic,
} from '../../wardrive/forward/payloads';
import { loadBrokerSettings, saveBrokerSettings } from '../../wardrive/forward/settings';
import { audienceOf, brokerUsername, buildToken, tokenUsable } from '../../wardrive/forward/token';
import type { ObsMessage } from '../../wardrive/messages';
import { bytesToHex } from '../../wardrive/packet';

async function softwareRadio() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const sign = async (bytes: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new Uint8Array(bytes))
    );
  return { key: bytesToHex(raw).toUpperCase(), sign };
}

function decodePart(part: string) {
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
}

const NOW = 1792404000;

describe('broker list', () => {
  it('starts with the two DMC collectors until the server sends its list', () => {
    expect(DEFAULT_BROKERS.map((b) => [b.id, b.url, b.format, b.label ?? null, b.auth])).toEqual([
      ['dmc-hunter', 'wss://collector1.dutchmeshcore.nl:443', 'wardrive', 'hunter', 'companion'],
      [
        'dmc-wardriver',
        'wss://collector2.dutchmeshcore.nl:443',
        'wardrive',
        'wardriver',
        'companion',
      ],
    ]);
    expect(DEFAULT_BROKERS.map((b) => b.audience)).toEqual([
      'collector1.dutchmeshcore.nl',
      'collector2.dutchmeshcore.nl',
    ]);
  });

  it('keeps the served brokers it can use and drops the rest', () => {
    const good = {
      id: 'meshcore-analyzer',
      name: 'meshcore-analyzer.eu',
      url: 'wss://mqtt.meshcore-analyzer.eu:443',
      audience: 'mqtt.meshcore-analyzer.eu',
      auth: 'companion',
      format: 'packets',
      region: 'nl',
      builtin: true,
    };
    const list = parseBrokers([
      good,
      { ...good, id: 'plain', url: 'ws://mqtt.example.org/mqtt' },
      { ...good, id: 'noregion', region: undefined },
      { ...good, id: 'nolabel', format: 'wardrive' },
      { ...good, id: 'nopass', auth: 'password' },
      // RTFM-EV's own upload destination is rtfm@<KEY>.
      { ...good, id: 'rtfm' },
      'junk',
    ]);
    expect(list?.map((b) => b.id)).toEqual(['meshcore-analyzer']);
    expect(parseBrokers({ brokers: [] })).toBeNull();
    expect(parseBrokers(undefined)).toBeNull();
  });

  it('makes one destination per broker and radio', () => {
    expect(destId('dmc-wardriver', 'ab'.repeat(32))).toBe(`dmc-wardriver@${'AB'.repeat(32)}`);
  });
});

describe('companion token', () => {
  it('verifies with the library the collector uses', async () => {
    const radio = await softwareRadio();
    const token = await buildToken(radio.key, 'collector2.dutchmeshcore.nl', NOW, radio.sign);
    const claims = await verifyAuthToken(token, radio.key);
    expect(claims).toMatchObject({
      publicKey: radio.key,
      aud: 'collector2.dutchmeshcore.nl',
      iat: NOW,
      exp: NOW + 86400,
    });
  });

  it('has exactly the claims core-hunter sends', async () => {
    const radio = await softwareRadio();
    const token = await buildToken(
      radio.key.toLowerCase(),
      'collector1.dutchmeshcore.nl',
      NOW,
      radio.sign
    );
    const [header, payload, sig] = token.split('.');
    expect(decodePart(header)).toEqual({ alg: 'Ed25519', typ: 'JWT' });
    expect(decodePart(payload)).toEqual({
      publicKey: radio.key,
      aud: 'collector1.dutchmeshcore.nl',
      iat: NOW,
      exp: NOW + 86400,
    });
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it('is usable only for the same key and host with more than 600 s left', async () => {
    const radio = await softwareRadio();
    const token = await buildToken(radio.key, 'collector1.dutchmeshcore.nl', NOW, radio.sign);
    expect(tokenUsable(token, radio.key, 'collector1.dutchmeshcore.nl', NOW + 1000)).toBe(true);
    expect(tokenUsable(token, radio.key, 'collector1.dutchmeshcore.nl', NOW + 86400 - 600)).toBe(
      false
    );
    expect(tokenUsable(token, 'CD'.repeat(32), 'collector1.dutchmeshcore.nl', NOW)).toBe(false);
    expect(tokenUsable(token, radio.key, 'collector2.dutchmeshcore.nl', NOW)).toBe(false);
    expect(tokenUsable(null, radio.key, 'collector1.dutchmeshcore.nl', NOW)).toBe(false);
    expect(tokenUsable('garbage', radio.key, 'collector1.dutchmeshcore.nl', NOW)).toBe(false);
  });

  it('names the user and audience like the collector expects', () => {
    expect(brokerUsername('ab'.repeat(32))).toBe(`v1_${'AB'.repeat(32)}`);
    expect(audienceOf('wss://collector2.dutchmeshcore.nl:443')).toBe('collector2.dutchmeshcore.nl');
  });
});

describe('topics and payloads', () => {
  const KEY = 'ab'.repeat(32);

  it('puts the upper-case key under the stream label', () => {
    expect(obsTopic('wardriver', KEY)).toBe(`meshcore/wardriver/${'AB'.repeat(32)}/wardriver/obs`);
    expect(trackTopic('hunter', KEY)).toBe(`meshcore/hunter/${'AB'.repeat(32)}/wardriver/track`);
  });

  it('names payload types exactly like the decoder core-hunter uses', () => {
    for (let n = 0; n < 16; n++) expect(payloadTypeName(n)).toBe(getPayloadTypeName(n));
  });

  it('builds the observer topic like RTFM-EV community MQTT does', () => {
    expect(observerTopic('nl', KEY)).toBe(`meshcore/NL/${'AB'.repeat(32)}/packets`);
  });

  // A flood GroupText heard over two relays: header 0x15 (route 1, type 5),
  // path byte 0x02, hops a1 b2, payload c0 ff.
  const obs: ObsMessage = {
    v: 1,
    origin_id: 'AB'.repeat(32),
    rx_at: '2026-10-19T10:00:00.000Z',
    hash: '0123456789abcdef',
    raw: '1502a1b2c0ff',
    len: 6,
    packet_type: 5,
    route: 'F',
    payload_len: 2,
    path: ['a1', 'b2'],
    RSSI: -92,
    SNR: 6.5,
    pos: { lat: 52.1, lon: 5.1, accuracy: 4, src: 'phone' },
  };

  it('maps a stored obs to the observer packet, key for key', () => {
    const p = observerPacket(obs, 'Car');
    expect(p).toEqual({
      origin: 'Car',
      origin_id: 'AB'.repeat(32),
      timestamp: '2026-10-19T10:00:00.000Z',
      type: 'PACKET',
      direction: 'rx',
      time: '10:00:00',
      date: '19/10/2026',
      len: '6',
      packet_type: '5',
      route: 'F',
      payload_len: '2',
      raw: '1502A1B2C0FF',
      SNR: 6.5,
      RSSI: -92,
      hash: '0123456789ABCDEF',
    });
    expect(Object.keys(p)).toEqual([
      'origin',
      'origin_id',
      'timestamp',
      'type',
      'direction',
      'time',
      'date',
      'len',
      'packet_type',
      'route',
      'payload_len',
      'raw',
      'SNR',
      'RSSI',
      'hash',
    ]);
  });

  it('adds the path only for a direct route and reads the route from the header', () => {
    // 0x16: route 2 (direct), type 5.
    const direct = observerPacket({ ...obs, raw: '1602a1b2c0ff', route: 'D' }, 'Car');
    expect(direct).toMatchObject({ route: 'D', path: 'a1,b2' });
    // 0x17: route 3 (transport direct) is T, as the community publisher sends it.
    expect(observerPacket({ ...obs, raw: '1702a1b2c0ff', route: 'D' }, 'Car')).toMatchObject({
      route: 'T',
    });
    expect(observerPacket({ ...obs, raw: '1402a1b2c0ff' }, 'Car')).toMatchObject({ route: 'F' });
  });

  it('says Unknown for a missing signal and names an unnamed radio', () => {
    const { RSSI: _r, SNR: _s, ...bare } = obs;
    void _r;
    void _s;
    expect(observerPacket(bare as ObsMessage)).toMatchObject({
      origin: 'MeshCore Device',
      SNR: 'Unknown',
      RSSI: 'Unknown',
    });
  });
});

describe('served broker cache', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the last served list for offline use', () => {
    saveServedBrokers(DEFAULT_BROKERS);
    expect(loadServedBrokers()).toEqual(DEFAULT_BROKERS);
  });

  it('ignores a cache it cannot read', () => {
    expect(loadServedBrokers()).toBeNull();
    localStorage.setItem('rtfm-wardrive-served-brokers', '{not json');
    expect(loadServedBrokers()).toBeNull();
    localStorage.setItem('rtfm-wardrive-served-brokers', '{"a":1}');
    expect(loadServedBrokers()).toBeNull();
  });
});

describe('broker settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with everything off', () => {
    expect(loadBrokerSettings()).toEqual({ enabled: {}, tokens: {} });
  });

  it('survives a reload', () => {
    saveBrokerSettings({ enabled: { 'dmc-wardriver@AB': true }, tokens: { 'h@AB': 't' } });
    expect(loadBrokerSettings()).toEqual({
      enabled: { 'dmc-wardriver@AB': true },
      tokens: { 'h@AB': 't' },
    });
  });

  it('drops an on8ar account kept by an older page', () => {
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({ enabled: {}, on8ar: { username: 'u', password: 'p' }, tokens: {} })
    );
    expect(loadBrokerSettings()).toEqual({ enabled: {}, tokens: {} });
    expect(localStorage.getItem('rtfm-wardrive-brokers')).not.toContain('"p"');
  });

  it('treats unreadable storage as defaults', () => {
    localStorage.setItem('rtfm-wardrive-brokers', '{not json');
    expect(loadBrokerSettings()).toEqual({ enabled: {}, tokens: {} });
  });
});
