import { describe, expect, it } from 'vitest';

import { fuotaPayloadFields, fuotaSummary, parseFuotaPacket } from '../utils/fuotaPayload';

// Same vectors as tests/test_fuota.py. Header 3A = version 0, type 0x0E, DIRECT; path byte 00.
const OFFER_PAYLOAD =
  '01ab' + 'deadbeef' + 'c400' + '00380000' + '01000000' + '05000000' + '1122334455667788' + '047f';
const REQUEST_PAYLOAD = '02cd' + 'deadbeef' + '0300' + 'ff00' + 'ab01';
const DATA_HEADER = '03ab' + 'deadbeef' + '5200';
const zeros = (n: number) => '00'.repeat(n);
const raw = (payload: string, header = '3a', path = '00') => header + path + payload;

describe('parseFuotaPacket', () => {
  it('decodes an Offer', () => {
    const msg = parseFuotaPacket(raw(OFFER_PAYLOAD));
    expect(msg).toMatchObject({
      kind: 'offer',
      sender: 'ab',
      campaign: 'deadbeef',
      manifestLen: 0xc4,
      patchSize: 0x3800,
      target: 1,
      build: 5,
      sourcePrefix: '1122334455667788',
      tail: '047f',
      payloadLen: 30,
    });
  });

  it('decodes a Request', () => {
    expect(parseFuotaPacket(raw(REQUEST_PAYLOAD))).toMatchObject({
      kind: 'request',
      sender: 'cd',
      block: 3,
      missingMask: 0x00ff,
      tail: 'ab01',
    });
  });

  it('decodes a short Data fragment', () => {
    expect(parseFuotaPacket(raw(DATA_HEADER + zeros(40)))).toMatchObject({
      kind: 'data',
      fragment: 0x52,
      dataLen: 40,
    });
  });

  it('decodes a Retract without a campaign', () => {
    expect(parseFuotaPacket(raw('04ab' + zeros(80)))).toMatchObject({
      kind: 'retract',
      campaign: null,
      payloadLen: 82,
    });
  });

  it.each([
    ['offer 29', OFFER_PAYLOAD.slice(0, 58)],
    ['offer 31', OFFER_PAYLOAD + '00'],
    ['request 11', REQUEST_PAYLOAD.slice(0, 22)],
    ['data 8', DATA_HEADER],
    ['data 185', DATA_HEADER + zeros(177)],
    ['retract 81', '04ab' + zeros(79)],
    ['kind 0', '00' + OFFER_PAYLOAD.slice(2)],
    ['kind 5', '05' + OFFER_PAYLOAD.slice(2)],
  ])('rejects %s', (_label, payload) => {
    expect(parseFuotaPacket(raw(payload))).toBeNull();
  });

  it('rejects FLOOD, a path, another version and another payload type', () => {
    expect(parseFuotaPacket(raw(OFFER_PAYLOAD, '39'))).toBeNull();
    expect(parseFuotaPacket('3a01aa' + OFFER_PAYLOAD)).toBeNull();
    expect(parseFuotaPacket(raw(OFFER_PAYLOAD, '7a'))).toBeNull();
    expect(parseFuotaPacket(raw(OFFER_PAYLOAD, '3e'))).toBeNull();
    expect(parseFuotaPacket('zz')).toBeNull();
  });
});

describe('fuotaSummary', () => {
  it('names the kind, campaign, build and sender', () => {
    const msg = parseFuotaPacket(raw(OFFER_PAYLOAD))!;
    expect(fuotaSummary(msg)).toBe('FUOTA Offer · campaign deadbeef · build 5 · from ab');
  });

  it('marks a Retract as not verified', () => {
    const msg = parseFuotaPacket(raw('04ab' + zeros(80)))!;
    expect(fuotaSummary(msg)).toBe('FUOTA Retract · signed retract (not verified) · from ab');
  });
});

describe('fuotaPayloadFields', () => {
  it('covers the Offer layout byte by byte', () => {
    const fields = fuotaPayloadFields(parseFuotaPacket(raw(OFFER_PAYLOAD))!);
    const campaign = fields.find((f) => f.name === 'Campaign ID')!;
    expect([campaign.startByte, campaign.endByte]).toEqual([2, 5]);
    expect(fields[fields.length - 1].endByte).toBe(29);
  });
});
