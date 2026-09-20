import { describe, it, expect } from 'vitest';
import {
  ROLE_FILTER_TYPES,
  isRoleVisibleForFilter,
  parseHiddenRoles,
  serializeHiddenRoles,
} from '../../map/roleFilter';
import {
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_SENSOR,
} from '../../types';

describe('ROLE_FILTER_TYPES', () => {
  it('covers the four togglable contact roles', () => {
    expect([...ROLE_FILTER_TYPES].sort()).toEqual(
      [CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, CONTACT_TYPE_CLIENT, CONTACT_TYPE_SENSOR].sort()
    );
  });
});

describe('isRoleVisibleForFilter', () => {
  it('shows a role unless it is in the hidden set', () => {
    const hidden = new Set([CONTACT_TYPE_CLIENT]);
    expect(isRoleVisibleForFilter(CONTACT_TYPE_REPEATER, hidden)).toBe(true);
    expect(isRoleVisibleForFilter(CONTACT_TYPE_CLIENT, hidden)).toBe(false);
  });

  it('shows everything when nothing is hidden (default)', () => {
    const hidden = new Set<number>();
    for (const t of ROLE_FILTER_TYPES) {
      expect(isRoleVisibleForFilter(t, hidden)).toBe(true);
    }
  });

  it('never hides an unknown role that has no toggle', () => {
    const hidden = new Set([CONTACT_TYPE_CLIENT, CONTACT_TYPE_REPEATER]);
    expect(isRoleVisibleForFilter(99, hidden)).toBe(true);
  });
});

describe('parseHiddenRoles', () => {
  it('returns an empty set for null / invalid / non-array input', () => {
    expect(parseHiddenRoles(null).size).toBe(0);
    expect(parseHiddenRoles('not json').size).toBe(0);
    expect(parseHiddenRoles('{"a":1}').size).toBe(0);
  });

  it('keeps only known role types', () => {
    const parsed = parseHiddenRoles(JSON.stringify([CONTACT_TYPE_ROOM, 99, 'x']));
    expect(parsed.has(CONTACT_TYPE_ROOM)).toBe(true);
    expect(parsed.has(99)).toBe(false);
    expect(parsed.size).toBe(1);
  });

  it('round-trips with serializeHiddenRoles', () => {
    const original = new Set([CONTACT_TYPE_REPEATER, CONTACT_TYPE_SENSOR]);
    const round = parseHiddenRoles(serializeHiddenRoles(original));
    expect([...round].sort()).toEqual([...original].sort());
  });
});
