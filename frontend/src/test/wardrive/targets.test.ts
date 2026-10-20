import { describe, expect, it } from 'vitest';

import type { Sender } from '../../wardrive/decode/reception';
import type { NameParts } from '../../wardrive/names';
import {
  TARGET_KINDS,
  matchesQuery,
  senderList,
  senderRows,
  topSenders,
  type TargetEntry,
} from '../../wardrive/targets';

const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);

function entry(
  kind: Sender['kind'],
  id: string,
  over: Omit<Partial<TargetEntry>, 'name'> & { name?: string } = {}
): TargetEntry {
  const { name = '', ...rest } = over;
  const parts: NameParts = { mark: '', name };
  return {
    at: NOW - 1000,
    hops: 0,
    packetType: 'Advert',
    rssi: -80,
    sender: { kind, id, label: null, role: null },
    name: parts,
    ...rest,
  };
}

describe('senderRows', () => {
  it('keeps the senders a driver can follow', () => {
    expect(TARGET_KINDS).toEqual(['channel_name', 'advert_pubkey', 'discover_pubkey', 'relay']);
    const rows = senderRows(
      [
        entry('discover_pubkey', 'ab'.repeat(8)),
        entry('relay', 'a1b2'),
        entry('path_hash', '64'),
        entry('direct_hash', '4a'),
        entry(null, ''),
      ],
      new Set()
    );
    expect(rows.map((r) => r.id).sort()).toEqual(['a1b2', 'ab'.repeat(8)]);
  });

  it('leaves out ignored ids', () => {
    expect(senderRows([entry('relay', 'a1b2')], new Set(['a1b2']))).toEqual([]);
  });

  it('keeps the newest reception per id', () => {
    const rows = senderRows(
      [
        entry('relay', 'a1b2', { at: NOW - 5000, rssi: -100 }),
        entry('relay', 'a1b2', { rssi: -70 }),
      ],
      new Set()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rssi).toBe(-70);
  });
});

describe('search', () => {
  const rows = senderRows(
    [
      entry('advert_pubkey', 'ff'.repeat(32), { name: 'Toren' }),
      entry('relay', 'a1b2c3'),
      entry('channel_name', 'Mike', { name: 'Mike' }),
    ],
    new Set()
  );

  it('finds by name part or id prefix', () => {
    expect(rows.filter((r) => matchesQuery(r, 'tor')).map((r) => r.name.name)).toEqual(['Toren']);
    expect(rows.filter((r) => matchesQuery(r, 'a1')).map((r) => r.id)).toEqual(['a1b2c3']);
    expect(rows.filter((r) => matchesQuery(r, 'zzz'))).toEqual([]);
  });

  it('sorts the list by name, else id', () => {
    expect(senderList(rows, '').map((r) => r.name.name || r.id)).toEqual([
      'a1b2c3',
      'Mike',
      'Toren',
    ]);
    expect(senderList(rows, 'mi').map((r) => r.id)).toEqual(['Mike']);
  });
});

describe('topSenders', () => {
  const four = senderRows(
    [
      entry('relay', 'aaaa', { rssi: -60, at: NOW - 1200000 }),
      entry('relay', 'bbbb', { rssi: -70 }),
      entry('relay', 'cccc', { rssi: -90 }),
      entry('relay', 'dddd', { rssi: -80 }),
    ],
    new Set()
  );

  it('is empty when the full list is no longer than the top', () => {
    expect(topSenders(four.slice(0, 3), NOW)).toEqual([]);
  });

  it('ranks by signal less age', () => {
    expect(topSenders(four, NOW).map((r) => r.id)).toEqual(['bbbb', 'dddd', 'cccc']);
  });
});
