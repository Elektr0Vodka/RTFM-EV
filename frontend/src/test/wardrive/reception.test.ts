// @vitest-environment node
// The decoder checks advert signatures with @noble/ed25519, whose byte check
// fails across jsdom realms; the logic needs no DOM, so this file runs in node.
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChannelKeys, type ChannelKeys } from '../../wardrive/decode/channels';
import { UNKNOWN_TYPE, decodeReception } from '../../wardrive/decode/reception';
import { hexToBytes } from '../../wardrive/packet';
import {
  FORGED_ADVERT,
  REAL_ADVERT,
  REAL_ADVERT_KEY,
  REAL_DIRECT,
  TEST_SECRET,
  TRACE_FRAME,
  groupTextFrame,
  hashtagSecret,
} from './decodeVectors';

const hashByte = (secretHex: string) =>
  createHash('sha256').update(Buffer.from(secretHex, 'hex')).digest()[0];

let keys: ChannelKeys;

beforeAll(async () => {
  keys = await buildChannelKeys(['#test']);
});

const decode = (hex: string) => decodeReception(hexToBytes(hex), keys);

describe('decodeReception', () => {
  it('names an advert by its own key, name and role', async () => {
    const d = await decode(REAL_ADVERT);
    expect(d.packetType).toBe('Advert');
    expect(d.hops).toBe(0);
    expect(d.heardDirect).toBe(true);
    expect(d.sender).toEqual({
      kind: 'advert_pubkey',
      id: REAL_ADVERT_KEY,
      label: 'NL-OV-ENS-ESNODE',
      role: 'Repeater',
    });
  });

  it('drops the identity of an advert with a forged signature', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = await decode(FORGED_ADVERT);
    expect(d.packetType).toBe('Advert');
    expect(d.sender.kind).toBeNull();
    expect(d.sender.id).toBeNull();
    expect(d.sender.label).toBeNull();
    expect(d.heardDirect).toBe(false);
    vi.restoreAllMocks();
  });

  it('takes the source hash of a direct response', async () => {
    const d = await decode(REAL_DIRECT);
    expect(d.packetType).toBe('Response');
    expect(d.sender).toEqual({ kind: 'direct_hash', id: '4a', label: '4a', role: null });
    expect(d.heardDirect).toBe(true);
  });

  it('reads a hashtag channel message heard straight from the sender', async () => {
    const d = await decode(groupTextFrame(TEST_SECRET, 'Mike', 'hello'));
    expect(d.packetType).toBe('GroupText');
    expect(d.channel).toBe('#test');
    expect(d.text).toBe('hello');
    expect(d.sender).toEqual({ kind: 'channel_name', id: 'Mike', label: 'Mike', role: null });
    expect(d.heardDirect).toBe(true);
  });

  it('gives no channel to a message it could not decrypt, even on a known hash', async () => {
    const publicHash = hashByte('8b3387e9c5cdea6ac9e5edbaa115cd72');
    let secret = randomBytes(16).toString('hex');
    while (hashByte(secret) !== publicHash) secret = randomBytes(16).toString('hex');
    const d = await decode(groupTextFrame(secret, 'Eve', 'private'));
    expect(d.packetType).toBe('GroupText');
    expect(d.channel).toBeNull();
    expect(d.text).toBeNull();
    expect(d.sender.kind).toBeNull();
  });

  it('names the channel whose key decrypted it when two share a hash', async () => {
    const testHash = hashByte(TEST_SECRET);
    let i = 0;
    while (hashByte(hashtagSecret(`#c${i}`)) !== testHash) i++;
    const twin = `#c${i}`;
    const both = await buildChannelKeys(['#test', twin]);
    const d = await decodeReception(
      hexToBytes(groupTextFrame(hashtagSecret(twin), 'Mike', 'twin')),
      both
    );
    expect(d.text).toBe('twin');
    expect(d.channel).toBe(twin);
  });

  it('names the last hop of a relayed channel message and keeps the channel', async () => {
    const d = await decode(groupTextFrame(TEST_SECRET, 'Mike', 'hello', 'a1b2c3', 3));
    expect(d.hops).toBe(1);
    expect(d.sender).toEqual({ kind: 'relay', id: 'a1b2c3', label: null, role: null });
    expect(d.channel).toBe('#test');
    expect(d.heardDirect).toBe(true);
  });

  it('keeps a 1-byte last hop as a path hash', async () => {
    const d = await decode(groupTextFrame(TEST_SECRET, 'Mike', 'hello', '64'));
    expect(d.sender).toEqual({ kind: 'path_hash', id: '64', label: '64', role: null });
  });

  it('gives a trace no sender', async () => {
    const d = await decode(TRACE_FRAME);
    expect(d.packetType).toBe('Trace');
    expect(d.sender.kind).toBeNull();
    expect(d.heardDirect).toBe(false);
  });

  it.each([
    ['garbage', 'zz'],
    ['three bytes', '150001'],
    ['empty', ''],
  ])('reads %s as Unknown without throwing', async (_label, hex) => {
    const d = await decodeReception(
      hex === 'zz' ? new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : hexToBytes(hex),
      keys
    );
    expect(d).toEqual({
      packetType: UNKNOWN_TYPE,
      hops: 0,
      heardDirect: false,
      sender: { kind: null, id: null, label: null, role: null },
      channel: null,
      text: null,
    });
  });
});
