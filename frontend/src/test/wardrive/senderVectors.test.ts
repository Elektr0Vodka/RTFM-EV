// @vitest-environment node
// The page's sender rules as test vectors for the server's port
// (app/wardrive/senders.py, tests/test_wardrive_senders.py). Run with
// WRITE_VECTORS=1 to write the file; otherwise the file must match what the
// page's decoder says today, so a change on either side shows up.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildChannelKeys } from '../../wardrive/decode/channels';
import { decodeReception } from '../../wardrive/decode/reception';
import { hexToBytes } from '../../wardrive/packet';
import {
  FORGED_ADVERT,
  REAL_ADVERT,
  REAL_DIRECT,
  TEST_SECRET,
  TRACE_FRAME,
  groupTextFrame,
  hashtagSecret,
} from './decodeVectors';

const FILE = resolve(__dirname, '../../../../tests/fixtures/wardrive_sender_vectors.json');

const hashByte = (secretHex: string) =>
  createHash('sha256').update(Buffer.from(secretHex, 'hex')).digest()[0];

/** A hashtag name whose channel hash byte equals #test's, so two channels share it. */
function sameHashName(): string {
  const want = hashByte(TEST_SECRET);
  for (let n = 0; n < 100000; n++) {
    const name = `#x${n}`;
    if (hashByte(hashtagSecret(name)) === want) return name;
  }
  throw new Error('no colliding name found');
}

const KEY32 = 'ab'.repeat(32);
const FLOOD_TEXT = groupTextFrame(TEST_SECRET, 'alice', 'hi', 'a1b2');
const COLLIDER = sameHashName();

interface Vector {
  name: string;
  raw: string;
  channels: string[];
}

const VECTORS: Vector[] = [
  { name: 'advert signed', raw: REAL_ADVERT, channels: [] },
  { name: 'advert forged', raw: FORGED_ADVERT, channels: [] },
  { name: 'response zero hop', raw: REAL_DIRECT, channels: [] },
  { name: 'trace', raw: TRACE_FRAME, channels: [] },
  {
    name: 'channel zero hop',
    raw: groupTextFrame(TEST_SECRET, 'alice', 'hi'),
    channels: ['#test'],
  },
  {
    name: 'channel zero hop no key',
    raw: groupTextFrame(TEST_SECRET, 'alice', 'hi'),
    channels: [],
  },
  { name: 'flood 1-byte hops', raw: FLOOD_TEXT, channels: ['#test'] },
  {
    name: 'flood 2-byte hops',
    raw: groupTextFrame(TEST_SECRET, 'alice', 'hi', 'a1b2c3d4', 2),
    channels: ['#test'],
  },
  {
    name: 'flood 3-byte hops',
    raw: groupTextFrame(TEST_SECRET, 'alice', 'hi', 'a1b2c3', 3),
    channels: ['#test'],
  },
  // Direct route with hops: the last path entry is not who we heard.
  { name: 'direct with hops', raw: '16' + FLOOD_TEXT.slice(2), channels: ['#test'] },
  // Transport flood: four transport-code bytes after the header.
  {
    name: 'transport flood',
    raw: '14' + 'aabbccdd' + FLOOD_TEXT.slice(2),
    channels: ['#test'],
  },
  {
    name: 'shared channel hash, #test decrypts',
    raw: groupTextFrame(TEST_SECRET, 'bob', 'yo'),
    channels: [COLLIDER, '#test'],
  },
  {
    name: 'shared channel hash, neither decrypts',
    raw: groupTextFrame(hashtagSecret('#nobody-here'), 'bob', 'yo'),
    channels: [COLLIDER, '#test'],
  },
  // Control, direct route, zero hops: DISCOVER_RESP (0x90) from a repeater (2).
  { name: 'discover full key', raw: '2e00' + '92' + '10' + '01020304' + KEY32, channels: [] },
  {
    name: 'discover key prefix',
    raw: '2e00' + '92' + '10' + '01020304' + KEY32.slice(0, 16),
    channels: [],
  },
  { name: 'discover too short', raw: '2e00' + '92' + '10' + '0102', channels: [] },
  // AnonRequest carries the sender's key as senderPublicKey: not a sender here.
  { name: 'anon request', raw: '1d00' + 'aa' + KEY32 + 'cccc' + 'dd'.repeat(16), channels: [] },
  { name: 'text message', raw: '0a00' + 'aa' + 'bb' + 'cccc' + 'dd'.repeat(16), channels: [] },
  { name: 'request', raw: '0200' + 'aa' + 'bb' + 'cccc' + 'dd'.repeat(16), channels: [] },
  { name: 'garbage', raw: 'zz', channels: [] },
  { name: 'empty', raw: '', channels: [] },
];

async function compute() {
  const out = [];
  for (const v of VECTORS) {
    const keys = await buildChannelKeys(v.channels);
    const d = await decodeReception(hexToBytes(v.raw), keys);
    out.push({
      ...v,
      expect: {
        packet_type_name: d.packetType,
        hops: d.hops,
        sender: d.sender,
        channel: d.channel,
      },
    });
  }
  return out;
}

describe('sender vectors for the server', () => {
  it('match the file the server is tested on', async () => {
    const vectors = await compute();
    if (process.env.WRITE_VECTORS === '1') {
      writeFileSync(FILE, JSON.stringify(vectors, null, 2) + '\n');
    }
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(vectors);
  });
});
