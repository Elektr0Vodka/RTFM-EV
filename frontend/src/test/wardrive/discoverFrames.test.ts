// The frames Auto-discover sends and the airtime it counts, against vectors
// made by running core-hunter's own modules (discoverVectors.json; script in
// the phase 5 ledger directory).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANON_REQ_BYTES,
  DISCOVER_BYTES,
  TELEMETRY_REQ_BYTES,
  TRACE_BYTES,
  advertBytes,
  frameAirtimeMs,
  minPeriodMs,
} from '../../wardrive/discover/airtime';
import {
  buildAnonRequest,
  buildDiscoverFrame,
  buildSelfAdvertFrame,
  buildTelemetryRequest,
  buildTracePathFrame,
  parseBinaryResponse,
  parseSentAck,
  parseTelemetryResponse,
  readOwnerReply,
  readRegionsReply,
} from '../../wardrive/discover/frames';
import { bytesToHex, hexToBytes } from '../../wardrive/packet';
import { parseSelfInfo } from '../../wardrive/radio/protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(resolve(__dirname, 'discoverVectors.json'), 'utf-8'));
const hex = (u8: Uint8Array) => bytesToHex(u8);

describe('auto-discover frames', () => {
  it('builds exactly the frames core-hunter sends', () => {
    expect(hex(buildDiscoverFrame(new Uint8Array([1, 2, 3, 4])))).toBe(V.frames.discover_01020304);
    expect(hex(buildTracePathFrame(0xdeadbeef, 0, [0xa1]))).toBe(V.frames.trace_deadbeef_0_a1);
    expect(hex(buildTracePathFrame(1, 0x12345678, [0xa1, 0xb2]))).toBe(
      V.frames.trace_00000001_12345678_a1b2
    );
    expect(hex(buildSelfAdvertFrame())).toBe(V.frames.self_advert);
    expect(hex(buildTelemetryRequest(V.frames.key.toUpperCase()))).toBe(V.frames.telemetry);
    expect(hex(buildAnonRequest(V.frames.key, 1))).toBe(V.frames.anon_regions);
    expect(hex(buildAnonRequest(V.frames.key, 2))).toBe(V.frames.anon_owner);
  });

  it('refuses frames the firmware would refuse or misread', () => {
    expect(() => buildTracePathFrame(1, 0, [])).toThrow();
    expect(() => buildTelemetryRequest('a1b2')).toThrow();
    expect(() => buildAnonRequest(V.frames.key, 3 as 1)).toThrow();
  });

  it('reads the replies the way core-hunter does', () => {
    expect(parseSentAck(hexToBytes(V.sentAck.bytes))).toEqual(V.sentAck.parsed);
    expect(parseSentAck(hexToBytes(V.sentAck.bytes).slice(0, 9))).toBeNull();
    expect(parseTelemetryResponse(hexToBytes(V.telemetryResponse.bytes))).toEqual(
      V.telemetryResponse.parsed
    );
    const b = parseBinaryResponse(hexToBytes(V.binaryResponse.bytes));
    expect(b?.tag).toBe(V.binaryResponse.tag);
    expect(hex(b!.data)).toBe(V.binaryResponse.data);
    expect(readRegionsReply(b!.data)).toEqual(V.binaryResponse.regions);
    expect(
      readOwnerReply(
        new Uint8Array([1, 0, 0, 0, ...new TextEncoder().encode('Toren\nPiet, 06'), 0])
      )
    ).toEqual(V.binaryResponse.owner);
    expect(
      readOwnerReply(new Uint8Array([1, 0, 0, 0, ...new TextEncoder().encode('Toren')]))
    ).toEqual(V.binaryResponse.ownerNoNewline);
  });
});

describe('auto-discover airtime', () => {
  it('matches the firmware formula for every spreading factor', () => {
    for (const { sf, bytes, ms } of V.airtime) expect(frameAirtimeMs(bytes, sf)).toBe(ms);
    expect(frameAirtimeMs(12, 99)).toBe(V.airtimeUnknownSf);
  });

  it('turns a cycle into the silence it has to buy', () => {
    for (const { bytes, sf, ms } of V.minPeriod) expect(minPeriodMs(bytes, sf)).toBe(ms);
    for (const { name, bytes } of V.advertBytes) expect(advertBytes(name)).toBe(bytes);
    expect([DISCOVER_BYTES, TRACE_BYTES, TELEMETRY_REQ_BYTES, ANON_REQ_BYTES]).toEqual([
      8, 12, 22, 53,
    ]);
  });
});

describe('SELF_INFO spreading factor', () => {
  it('reads the spreading factor at byte 56', () => {
    const f = new Uint8Array(64);
    f[0] = 5;
    f[56] = 8;
    expect(parseSelfInfo(f)?.sf).toBe(8);
    f[56] = 0;
    expect(parseSelfInfo(f)?.sf).toBeNull();
    expect(parseSelfInfo(f.slice(0, 40))?.sf).toBeNull();
  });
});
