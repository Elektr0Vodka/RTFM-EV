import { describe, expect, it } from 'vitest';

import { groupDataOwner } from '../utils/groupDataTypes';

describe('groupDataOwner', () => {
  it('names registered and known third-party data types', () => {
    expect(groupDataOwner(0x0100)).toBe('MeshCore Open');
    expect(groupDataOwner(0x0110)).toBe('Ripple');
    expect(groupDataOwner(0x011f)).toBe('Ripple');
    expect(groupDataOwner(0x0120)).toBe('MCO Advanced');
    expect(groupDataOwner(0x0135)).toBe('StreamSensor');
    expect(groupDataOwner(0x0140)).toBe('Nelos');
    expect(groupDataOwner(0x0200)).toBe('MeshCoreNG');
    expect(groupDataOwner(0xfff0)).toBe('MCO Advanced');
    expect(groupDataOwner(0xff01)).toBe('TAK-MESHCORE');
    expect(groupDataOwner(0x4447)).toBe('Trail Mate');
  });

  it('leaves unknown and shared developer types unnamed', () => {
    expect(groupDataOwner(0x1234)).toBeNull();
    expect(groupDataOwner(0x0141)).toBeNull();
    // 0xFFFF is shared by MeshCore SAR and MeshCore Companion.
    expect(groupDataOwner(0xffff)).toBeNull();
  });
});
