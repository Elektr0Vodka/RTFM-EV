import { describe, expect, it } from 'vitest';

import { appStartFrame, parseRxLog, parseSelfInfo } from '../../wardrive/radio/protocol';
import { SerialFrameDecoder, encodeSerialFrame } from '../../wardrive/radio/serialFraming';

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
