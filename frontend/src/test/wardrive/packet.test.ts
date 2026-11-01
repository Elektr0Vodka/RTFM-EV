import { describe, expect, it } from 'vitest';

import { bytesToHex, frameWalk, hexToBytes, packetHash } from '../../wardrive/packet';
import { FRAME_VECTORS } from './vectors';

describe('wardrive packet walk and hash', () => {
  it('walks every vector frame like core-hunter', () => {
    for (const v of FRAME_VECTORS) {
      expect(frameWalk(hexToBytes(v.raw))).toEqual(v.walk);
    }
  });

  it('hashes every vector frame like core-hunter', async () => {
    for (const v of FRAME_VECTORS) {
      expect(await packetHash(hexToBytes(v.raw))).toBe(v.hash);
    }
  });

  it('round-trips hex in lower case', () => {
    expect(bytesToHex(hexToBytes('A1b2'))).toBe('a1b2');
  });

  it('refuses a 4-byte hop size and a path longer than 64 bytes', () => {
    expect(frameWalk(hexToBytes('15c1aabbccdd00'))).toBeNull();
    expect(frameWalk(hexToBytes('15' + '7f' + '00'.repeat(130)))).toBeNull();
  });
});
