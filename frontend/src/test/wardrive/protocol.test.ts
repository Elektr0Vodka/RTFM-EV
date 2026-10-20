import { describe, expect, it } from 'vitest';

import {
  CMD_GET_CONTACTS,
  appStartFrame,
  parseContact,
  parseRxLog,
  parseStatsCore,
  parseStatsRadio,
  parseSelfInfo,
} from '../../wardrive/radio/protocol';
import { SerialFrameDecoder, encodeSerialFrame } from '../../wardrive/radio/serialFraming';
import { contactFrame } from './radioFrames';

const KEY = Array.from({ length: 32 }, (_, i) => i + 1);

function selfInfo(name: string): Uint8Array {
  const b = new Uint8Array(58 + name.length);
  b[0] = 0x05;
  b.set(KEY, 4);
  b.set(new TextEncoder().encode(name), 58);
  return b;
}

describe('companion protocol frames', () => {
  it('builds APP_START with 7 zero bytes then the name', () => {
    expect(Array.from(appStartFrame('rx'))).toEqual([0x01, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x78]);
  });

  it('reads the public key and name from SELF_INFO', () => {
    const info = parseSelfInfo(selfInfo('Car radio\0\0'));
    expect(info).toEqual({
      publicKey: KEY.map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
      name: 'Car radio',
    });
  });

  it('refuses a short or foreign SELF_INFO', () => {
    expect(parseSelfInfo(new Uint8Array([0x05, 0, 0]))).toBeNull();
    expect(parseSelfInfo(new Uint8Array(60))).toBeNull();
  });

  it('decodes an RX log push: snr in quarter dB, rssi as int8, then the raw packet', () => {
    expect(parseRxLog(new Uint8Array([0x88, 0xfa, 0xa6, 0x15, 0x00, 0x01]))).toEqual({
      snr: -1.5,
      rssi: -90,
      raw: new Uint8Array([0x15, 0x00, 0x01]),
    });
    expect(parseRxLog(new Uint8Array([0x88, 0x10]))).toBeNull();
    expect(parseRxLog(new Uint8Array([0x05, 0, 0, 1]))).toBeNull();
  });
});

describe('USB serial framing', () => {
  const frame = new Uint8Array([0x88, 0x10, 0xa6, 0x15, 0x00, 0x01]);
  const wire = new Uint8Array([0x3e, 6, 0, ...frame]);

  it('encodes host frames with 0x3c and a little-endian length', () => {
    expect(Array.from(encodeSerialFrame(new Uint8Array(300).fill(7)).subarray(0, 4))).toEqual([
      0x3c, 0x2c, 0x01, 7,
    ]);
  });

  it('decodes a frame split across chunks', () => {
    const d = new SerialFrameDecoder();
    expect(d.push(wire.subarray(0, 2))).toEqual([]);
    expect(d.push(wire.subarray(2, 5))).toEqual([]);
    expect(d.push(wire.subarray(5))).toEqual([frame]);
  });

  it('decodes two frames in one chunk', () => {
    const d = new SerialFrameDecoder();
    expect(d.push(new Uint8Array([...wire, ...wire]))).toEqual([frame, frame]);
  });

  it('skips junk before 0x3e', () => {
    const d = new SerialFrameDecoder();
    const junk = new TextEncoder().encode('boot log\r\n');
    expect(d.push(new Uint8Array([...junk, ...wire]))).toEqual([frame]);
  });

  it('resyncs after a length above 300', () => {
    const d = new SerialFrameDecoder();
    expect(d.push(new Uint8Array([0x3e, 0xff, 0x7f, ...wire]))).toEqual([frame]);
  });
});

describe('parseContact', () => {
  it('dates a contact by the radio clock (lastmod), not the node clock', () => {
    const frame = contactFrame({ keyHex: 'ab'.repeat(32), lastAdvert: 5000, lastmod: 1000 });
    expect(parseContact(frame)?.seen).toBe(1000);
    // A frame without lastmod (or 0) keeps the advert time.
    expect(parseContact(frame.subarray(0, 144))?.seen).toBe(5000);
    expect(parseContact(contactFrame({ keyHex: 'ab'.repeat(32), lastAdvert: 5000 }))?.seen).toBe(
      5000
    );
  });

  it('reads a contact with its role and advertised position', () => {
    const frame = contactFrame({
      keyHex: 'ab'.repeat(32),
      type: 2,
      name: 'Toren',
      lastAdvert: 1792404000,
      lat: 52.5,
      lon: 6.1,
    });
    expect(parseContact(frame)).toEqual({
      publicKey: 'ab'.repeat(32),
      name: 'Toren',
      role: 'Repeater',
      lat: 52.5,
      lon: 6.1,
      seen: 1792404000,
    });
  });

  it('takes (0, 0) as no position and an empty name as none', () => {
    const c = parseContact(contactFrame({ keyHex: 'cd'.repeat(32), type: 9 }));
    expect(c).toMatchObject({ name: null, role: null, lat: null, lon: null, seen: null });
  });

  it('refuses a short frame or another code', () => {
    expect(parseContact(contactFrame({ keyHex: 'ab'.repeat(32) }).subarray(0, 100))).toBeNull();
    const other = contactFrame({ keyHex: 'ab'.repeat(32) });
    other[0] = 0x05;
    expect(parseContact(other)).toBeNull();
  });

  it('asks for contacts with one byte', () => {
    expect(CMD_GET_CONTACTS).toBe(0x04);
  });
});

describe('stats frames', () => {
  it('reads the battery from core stats', () => {
    expect(parseStatsCore(new Uint8Array([24, 0, 0x6c, 0x0e, 0, 0, 0, 0, 0, 0, 0]))).toEqual({
      batteryMv: 3692,
    });
  });

  it('reads the noise floor from radio stats', () => {
    const f = new Uint8Array(14);
    f[0] = 24;
    f[1] = 1;
    new DataView(f.buffer).setInt16(2, -112, true);
    expect(parseStatsRadio(f)).toEqual({ noiseFloor: -112 });
  });

  it('refuses other frames', () => {
    expect(parseStatsCore(new Uint8Array([24, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(parseStatsCore(new Uint8Array([24, 0, 1]))).toBeNull();
    expect(parseStatsRadio(new Uint8Array([25, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
