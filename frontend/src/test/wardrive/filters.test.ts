import { getPayloadTypeName } from '@michaelhart/meshcore-decoder';
import { afterEach, describe, expect, it } from 'vitest';

import type { Sender } from '../../wardrive/decode/reception';
import { payloadTypeName } from '../../wardrive/forward/payloads';
import {
  ALL_TIME,
  DEFAULT_FILTER,
  FILTER_KEY,
  IGNORE_KEY,
  PACKET_TYPES,
  STAND_KEY,
  TIME_WINDOWS,
  activeFilterCount,
  idClass,
  loadFilter,
  loadIgnore,
  loadStand,
  makeFilter,
  packetTypeLabel,
  saveFilter,
  saveIgnore,
  saveStand,
  standFilter,
  windowMs,
  type Filter,
  type Filterable,
} from '../../wardrive/filters';

const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const MIN = 60000;

const sender = (kind: Sender['kind'], id: string | null): Sender => ({
  kind,
  id,
  label: null,
  role: null,
});

function entry(over: Partial<Filterable> = {}): Filterable {
  return {
    at: NOW - MIN,
    hops: 0,
    packetType: 'GroupText',
    sender: sender('relay', 'a1b2'),
    ...over,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('packet types', () => {
  it('lists 14 types covering every decoder payload type', () => {
    expect(PACKET_TYPES).toHaveLength(14);
    const values = PACKET_TYPES.map((p) => p.value);
    for (let i = 0; i <= 11; i++) expect(values).toContain(getPayloadTypeName(i));
    expect(values).toContain(getPayloadTypeName(15));
    expect(values).toContain('Unknown');
    for (let i = 0; i <= 11; i++) expect(values).toContain(payloadTypeName(i));
  });

  it('labels a type through i18n', () => {
    expect(packetTypeLabel('GroupText', (k) => `<${k}>`)).toBe('<wardrive_page_type_group_text>');
    expect(packetTypeLabel('Odd', (k) => k)).toBe('Odd');
  });
});

describe('idClass', () => {
  it('sorts senders by what kind of id they carry', () => {
    expect(idClass(sender('channel_name', 'Mike'))).toBe('channel');
    expect(idClass(sender('path_hash', '64'))).toBe('1b');
    expect(idClass(sender('relay', 'a1b2'))).toBe('2b');
    expect(idClass(sender('relay', 'a1b2c3'))).toBe('3b');
    expect(idClass(sender('advert_pubkey', 'ab'.repeat(32)))).toBe('pubkey');
    expect(idClass(sender('discover_pubkey', 'ab'.repeat(8)))).toBe('pubkey');
    expect(idClass(sender(null, null))).toBe('unnamed');
  });
});

describe('time windows', () => {
  it('reads the window tokens', () => {
    expect(TIME_WINDOWS).toHaveLength(10);
    expect(windowMs('5m')).toBe(300000);
    expect(windowMs('2d')).toBe(172800000);
    expect(windowMs('x')).toBeNull();
    expect(ALL_TIME).toBe(0);
  });
});

describe('activeFilterCount', () => {
  it('counts what narrows the view, not the targets', () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_FILTER, types: ['Advert', 'Trace'], directOnly: true })
    ).toBe(2);
    expect(activeFilterCount({ ...DEFAULT_FILTER, windowMs: 300000 })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTER, targets: ['a1b2'] })).toBe(0);
  });
});

describe('makeFilter', () => {
  const none = new Set<string>();

  it('drops receptions older than the window', () => {
    const f = makeFilter(DEFAULT_FILTER, none);
    expect(f(entry({ at: NOW - 29 * MIN }), NOW)).toBe(true);
    expect(f(entry({ at: NOW - 31 * MIN }), NOW)).toBe(false);
    expect(makeFilter({ ...DEFAULT_FILTER, windowMs: ALL_TIME }, none)(entry({ at: 0 }), NOW)).toBe(
      true
    );
  });

  it('keeps only zero-hop receptions with No path', () => {
    const f = makeFilter({ ...DEFAULT_FILTER, directOnly: true }, none);
    expect(f(entry({ hops: 2 }), NOW)).toBe(false);
    expect(f(entry({ hops: 0 }), NOW)).toBe(true);
  });

  it('matches targets case-insensitively', () => {
    const f = makeFilter({ ...DEFAULT_FILTER, targets: ['A1B2'] }, none);
    expect(f(entry(), NOW)).toBe(true);
    expect(f(entry({ sender: sender('relay', 'c3d4') }), NOW)).toBe(false);
  });

  it('filters by type and id class', () => {
    const byType = makeFilter({ ...DEFAULT_FILTER, types: ['Advert'] }, none);
    expect(byType(entry(), NOW)).toBe(false);
    const byClass = makeFilter({ ...DEFAULT_FILTER, idClasses: ['3b'] }, none);
    expect(byClass(entry(), NOW)).toBe(false);
    expect(byClass(entry({ sender: sender('relay', 'a1b2c3') }), NOW)).toBe(true);
  });

  it('leaves out an ignored sender in both stands', () => {
    const ignore = new Set(['a1b2']);
    const f: Filter = { ...DEFAULT_FILTER, types: ['GroupText'] };
    expect(makeFilter(f, ignore)(entry(), NOW)).toBe(false);
    expect(makeFilter(standFilter('all', f), ignore)(entry(), NOW)).toBe(false);
  });
});

describe('standFilter', () => {
  it('shows everything in the window when the stand is all', () => {
    const f: Filter = {
      targets: ['zz'],
      types: ['Advert'],
      idClasses: ['pubkey'],
      windowMs: 300000,
      directOnly: true,
    };
    const all = standFilter('all', f);
    expect(all.windowMs).toBe(300000);
    expect(makeFilter(all, new Set())(entry({ hops: 3 }), NOW)).toBe(true);
    expect(standFilter('filtered', f)).toEqual(f);
  });
});

describe('persistence', () => {
  it('keeps the filter, the stand and the ignore list', () => {
    const f: Filter = { ...DEFAULT_FILTER, types: ['Advert'] };
    saveFilter(f);
    expect(loadFilter()).toEqual(f);
    saveStand('all');
    expect(loadStand()).toBe('all');
    saveIgnore(['a1b2']);
    expect(loadIgnore()).toEqual(['a1b2']);
    expect(localStorage.getItem(FILTER_KEY)).not.toBeNull();
    expect(localStorage.getItem(STAND_KEY)).toBe('all');
    expect(localStorage.getItem(IGNORE_KEY)).toBe('["a1b2"]');
  });

  it('falls back to the defaults on bad storage', () => {
    localStorage.setItem(FILTER_KEY, '{bad');
    localStorage.setItem(STAND_KEY, 'sideways');
    localStorage.setItem(IGNORE_KEY, '{"a": 1}');
    expect(loadFilter()).toEqual(DEFAULT_FILTER);
    expect(loadStand()).toBe('filtered');
    expect(loadIgnore()).toEqual([]);
  });

  it('fills fields a stored filter lacks', () => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ types: ['Trace'], windowMs: 'x' }));
    expect(loadFilter()).toEqual({ ...DEFAULT_FILTER, types: ['Trace'] });
  });
});
