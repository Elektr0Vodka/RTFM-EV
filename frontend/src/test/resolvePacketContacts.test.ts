import { describe, it, expect } from 'vitest';
import { resolvePacketContacts } from '../components/MapView';
import type { ParsedPacket } from '../utils/visualizerUtils';
import type { Contact } from '../types';

function contact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'a'.repeat(64),
    name: 'n',
    type: 0,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  } as Contact;
}

function parsed(overrides: Partial<ParsedPacket>): ParsedPacket {
  return {
    payloadType: 0,
    messageHash: null,
    pathBytes: [],
    srcHash: null,
    dstHash: null,
    advertPubkey: null,
    groupTextSender: null,
    anonRequestPubkey: null,
    ...overrides,
  };
}

function index(...contacts: Contact[]): Map<string, Contact[]> {
  const m = new Map<string, Contact[]>();
  for (const c of contacts) m.set(c.public_key.slice(0, 12), [c]);
  return m;
}

describe('resolvePacketContacts', () => {
  it('reveals an advertised-located source node', () => {
    const c = contact({ public_key: 'b'.repeat(64), lat: 52, lon: 5 });
    const keys = resolvePacketContacts(
      parsed({ advertPubkey: 'b'.repeat(64) }),
      index(c),
      new Map(),
      null
    );
    expect(keys.has(c.public_key)).toBe(true);
  });

  it('reveals a manual-only source node (advert)', () => {
    const c = contact({ public_key: 'c'.repeat(64), manual_lat: 51, manual_lon: 4 });
    const keys = resolvePacketContacts(
      parsed({ advertPubkey: 'c'.repeat(64) }),
      index(c),
      new Map(),
      null
    );
    expect(keys.has(c.public_key)).toBe(true);
  });

  it('reveals a manual-only node appearing as a path hop', () => {
    const c = contact({ public_key: 'd'.repeat(64), manual_lat: 51, manual_lon: 4 });
    const keys = resolvePacketContacts(
      parsed({ srcHash: 'ffff', pathBytes: ['d'.repeat(12)] }),
      index(c),
      new Map(),
      null
    );
    expect(keys.has(c.public_key)).toBe(true);
  });

  it('does not reveal an unlocated node', () => {
    const c = contact({ public_key: 'e'.repeat(64) });
    const keys = resolvePacketContacts(
      parsed({ advertPubkey: 'e'.repeat(64) }),
      index(c),
      new Map(),
      null
    );
    expect(keys.has(c.public_key)).toBe(false);
  });

  it('reveals a manual-only group-text sender resolved by name', () => {
    const c = contact({ public_key: 'f'.repeat(64), name: 'Alice', manual_lat: 51, manual_lon: 4 });
    const nameIndex = new Map<string, Contact>([['Alice', c]]);
    const keys = resolvePacketContacts(
      parsed({ groupTextSender: 'Alice' }),
      new Map(),
      nameIndex,
      null
    );
    expect(keys.has(c.public_key)).toBe(true);
  });
});
