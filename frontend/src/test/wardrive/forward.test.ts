import { getPayloadTypeName, verifyAuthToken } from '@michaelhart/meshcore-decoder';
import { beforeEach, describe, expect, it } from 'vitest';

import { BROKERS, destId } from '../../wardrive/forward/brokers';
import {
  obsTopic,
  packetsPayload,
  packetsTopic,
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
  it('has the two DMC collectors and on8ar, all distinct', () => {
    expect(BROKERS.map((b) => [b.id, b.url, b.format, b.label ?? null, b.auth])).toEqual([
      ['dmc-hunter', 'wss://collector1.dutchmeshcore.nl:443', 'wardrive', 'hunter', 'companion'],
      [
        'dmc-wardriver',
        'wss://collector2.dutchmeshcore.nl:443',
        'wardrive',
        'wardriver',
        'companion',
      ],
      ['on8ar', 'wss://emqx.on8ar.eu:8084/ws', 'packets', null, 'password'],
    ]);
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
    expect(packetsTopic('AB'.repeat(32))).toBe(`meshcore/hunter/${KEY}/packets`);
  });

  it('names payload types exactly like the decoder core-hunter uses', () => {
    for (let n = 0; n < 16; n++) expect(payloadTypeName(n)).toBe(getPayloadTypeName(n));
  });

  it('maps an obs to the packets payload', () => {
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
    expect(packetsPayload(obs, 'Car')).toEqual({
      origin_id: KEY,
      origin: 'Car',
      timestamp: '2026-10-19T10:00:00.000Z',
      type: 'PACKET',
      direction: 'rx',
      raw: '1502a1b2c0ff',
      SNR: 6.5,
      RSSI: -92,
      is_direct: true,
      hops: 2,
      sender_kind: null,
      sender_id: null,
      sender_label: null,
      sender_role: null,
      channel_name: null,
      packet_type: 'GroupText',
      gps: { lat: 52.1, lon: 5.1, acc_m: 4 },
    });
    expect(packetsPayload({ ...obs, path: [] })).toMatchObject({ is_direct: true, hops: 0 });
    expect(packetsPayload({ ...obs, route: 'D' })).toMatchObject({ is_direct: false });
    expect(packetsPayload({ ...obs, packet_type: 9 })).toMatchObject({
      is_direct: false,
      packet_type: 'Trace',
    });
    expect(packetsPayload(obs)).not.toHaveProperty('origin');
  });
});

describe('broker settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with everything off', () => {
    expect(loadBrokerSettings()).toEqual({ enabled: {}, on8ar: null, tokens: {} });
  });

  it('survives a reload', () => {
    saveBrokerSettings({
      enabled: { 'dmc-wardriver@AB': true },
      on8ar: { username: 'u', password: 'p' },
      tokens: { 'h@AB': 't' },
    });
    expect(loadBrokerSettings().enabled['dmc-wardriver@AB']).toBe(true);
    expect(loadBrokerSettings().on8ar).toEqual({ username: 'u', password: 'p' });
  });

  it('treats unreadable storage as defaults', () => {
    localStorage.setItem('rtfm-wardrive-brokers', '{not json');
    expect(loadBrokerSettings()).toEqual({ enabled: {}, on8ar: null, tokens: {} });
  });
});
