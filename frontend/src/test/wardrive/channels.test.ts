import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_CHANNEL,
  buildChannelKeys,
  deriveChannelSecret,
  publicChannelKeys,
} from '../../wardrive/decode/channels';

const firstByte = (secretHex: string) =>
  createHash('sha256')
    .update(Buffer.from(secretHex, 'hex'))
    .digest()
    .subarray(0, 1)
    .toString('hex');

describe('deriveChannelSecret', () => {
  it('hashes the hashtag name verbatim', async () => {
    expect(await deriveChannelSecret('#test')).toBe('9cd8fcf22a47333b591d96a2b848b73f');
    expect(await deriveChannelSecret('#chat')).toBe('d0bdd6d71538138ed979eec00d98ad97');
  });

  it('adds the # when it is missing', async () => {
    expect(await deriveChannelSecret('public')).toBe('8b4b705b080c0d943b1c80f6b3ef6b6d');
    expect(await deriveChannelSecret('test')).toBe('9cd8fcf22a47333b591d96a2b848b73f');
  });
});

describe('buildChannelKeys', () => {
  it('maps the channel hash of Public and each hashtag to its name', async () => {
    const keys = await buildChannelKeys(['#test']);
    expect(keys.nameByHash.get(firstByte('9cd8fcf22a47333b591d96a2b848b73f'))).toBe('#test');
    expect(keys.nameByHash.get(firstByte(PUBLIC_CHANNEL.secret))).toBe('Public');
    expect(keys.options.keyStore?.hasChannelKey(firstByte(PUBLIC_CHANNEL.secret))).toBe(true);
  });

  it('skips names it cannot use', async () => {
    const keys = await buildChannelKeys(['#', '   ', '#' + 'x'.repeat(40)]);
    expect([...keys.nameByHash.values()]).toEqual(['Public']);
  });
});

describe('publicChannelKeys', () => {
  it('matches the Public keys buildChannelKeys makes', async () => {
    const built = await buildChannelKeys([]);
    expect([...publicChannelKeys().nameByHash]).toEqual([...built.nameByHash]);
  });
});
