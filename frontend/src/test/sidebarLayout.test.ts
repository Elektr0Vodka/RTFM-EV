import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  ALL_FAVORITE_GROUP_KEYS,
  resolveSectionOrder,
  resolveToolOrder,
  resolveFavoritesOrder,
  resolveFavoriteSortOrders,
  resolveHidden,
  readLegacyLocalOrders,
  clearLegacyLocalOrders,
  loadRailCollapsed,
  saveRailCollapsed,
  resetSidebarLayout,
  groupSectionKey,
  isGroupSectionKey,
  groupIdFromSectionKey,
  createContactGroup,
  renameContactGroup,
  deleteContactGroup,
  toggleGroupMember,
  groupsContainingContact,
  groupsContainingChannel,
  isContactGrouped,
  isChannelGrouped,
  loadGroupCollapsed,
  saveGroupCollapsed,
  type SidebarToolKey,
} from '../utils/sidebarLayout';
import type { ContactGroup } from '../types';

describe('sidebarLayout server-order reconcilers', () => {
  beforeEach(() => localStorage.clear());

  it('returns canonical defaults when the server value is empty/undefined', () => {
    expect(resolveSectionOrder(undefined)).toEqual(ALL_SECTION_KEYS);
    expect(resolveSectionOrder([])).toEqual(ALL_SECTION_KEYS);
    expect(resolveToolOrder(undefined)).toEqual(ALL_TOOL_KEYS);
    expect(resolveFavoritesOrder(undefined)).toEqual(ALL_FAVORITE_GROUP_KEYS);
    expect(resolveFavoritesOrder([])).toEqual(ALL_FAVORITE_GROUP_KEYS);
  });

  it('keeps valid keys in stored order, drops unknown, appends missing (favorites)', () => {
    expect(resolveFavoritesOrder(['sensors', 'bogus', 'channels'])).toEqual([
      'sensors',
      'channels',
      'companions',
      'repeaters',
      'rooms',
    ]);
  });

  it('reconciles section order the same way and drops legacy repeaters/rooms', () => {
    const loaded = resolveSectionOrder(['contacts', 'repeaters', 'rooms', 'channels']);
    expect(loaded).not.toContain('repeaters');
    expect(loaded).not.toContain('rooms');
    expect(loaded[0]).toBe('contacts');
    expect([...loaded].sort()).toEqual([...ALL_SECTION_KEYS].sort());
  });

  it('reconciles tool order, dropping unknown keys', () => {
    const out = resolveToolOrder(['map', 'bogus-old-key', 'my-node']);
    expect(out.slice(0, 2)).toEqual(['map', 'my-node']);
    expect(out).not.toContain('bogus-old-key');
    expect([...out].sort()).toEqual([...ALL_TOOL_KEYS].sort());
  });

  it('falls back to defaults on a non-array server value', () => {
    expect(resolveSectionOrder('{not an array')).toEqual(ALL_SECTION_KEYS);
  });
});

describe('contact group section keys', () => {
  it('builds and parses a group section key', () => {
    expect(groupSectionKey('abc123')).toBe('group:abc123');
    expect(isGroupSectionKey('group:abc123')).toBe(true);
    expect(isGroupSectionKey('channels')).toBe(false);
    expect(groupIdFromSectionKey('group:abc123')).toBe('abc123');
  });

  it('appends group section keys as valid, newly-added entries with no stored order', () => {
    const order = resolveSectionOrder(undefined, ['grp-1', 'grp-2']);
    expect(order).toEqual([...ALL_SECTION_KEYS, 'group:grp-1', 'group:grp-2']);
  });

  it('keeps a group key already in the stored order, in place', () => {
    const order = resolveSectionOrder(
      ['group:grp-1', 'tools', 'favorites', 'channels', 'contacts'],
      ['grp-1']
    );
    expect(order[0]).toBe('group:grp-1');
    expect(order).toHaveLength(5);
  });

  it('drops a group key for a group that no longer exists', () => {
    const order = resolveSectionOrder(
      ['group:deleted', 'tools', 'favorites', 'channels', 'contacts'],
      []
    );
    expect(order).not.toContain('group:deleted');
    expect(order).toEqual(ALL_SECTION_KEYS);
  });
});

describe('resolveHidden', () => {
  it('returns empty lists for missing/invalid input', () => {
    expect(resolveHidden(undefined)).toEqual({ sections: [], tools: [], favorites: [] });
    expect(resolveHidden(null)).toEqual({ sections: [], tools: [], favorites: [] });
    expect(resolveHidden('nope')).toEqual({ sections: [], tools: [], favorites: [] });
  });

  it('keeps only valid keys per list and drops unknown ones', () => {
    expect(
      resolveHidden({
        sections: ['contacts', 'bogus'],
        tools: ['cracker', 'nope'],
        favorites: ['sensors', 'xxx'],
      })
    ).toEqual({ sections: ['contacts'], tools: ['cracker'], favorites: ['sensors'] });
  });

  it('tolerates missing individual lists', () => {
    expect(resolveHidden({ tools: ['map'] })).toEqual({
      sections: [],
      tools: ['map'],
      favorites: [],
    });
  });
});

describe('resolveFavoriteSortOrders', () => {
  const ALL_RECENT = {
    channels: 'recent',
    companions: 'recent',
    repeaters: 'recent',
    rooms: 'recent',
    sensors: 'recent',
  };

  it('defaults every group to recent for missing/invalid input', () => {
    expect(resolveFavoriteSortOrders(undefined)).toEqual(ALL_RECENT);
    expect(resolveFavoriteSortOrders(null)).toEqual(ALL_RECENT);
    expect(resolveFavoriteSortOrders('nope')).toEqual(ALL_RECENT);
    expect(resolveFavoriteSortOrders({})).toEqual(ALL_RECENT);
  });

  it('keeps valid alpha/recent values per group', () => {
    expect(resolveFavoriteSortOrders({ channels: 'alpha', sensors: 'alpha' })).toEqual({
      ...ALL_RECENT,
      channels: 'alpha',
      sensors: 'alpha',
    });
  });

  it('coerces unknown values to recent and ignores unknown keys', () => {
    expect(resolveFavoriteSortOrders({ channels: 'weird', bogus: 'alpha' })).toEqual(ALL_RECENT);
  });
});

describe('sidebarLayout legacy localStorage migration helpers', () => {
  beforeEach(() => localStorage.clear());

  it('reads legacy orders and reconciles them', () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['favorites', 'tools', 'channels', 'contacts'])
    );
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(['map', 'bogus']));
    const legacy = readLegacyLocalOrders();
    expect(legacy.section).toEqual(['favorites', 'tools', 'channels', 'contacts']);
    expect(legacy.tool?.[0]).toBe('map');
    expect(legacy.tool).not.toContain('bogus');
  });

  it('returns null for absent legacy keys', () => {
    const legacy = readLegacyLocalOrders();
    expect(legacy.section).toBeNull();
    expect(legacy.tool).toBeNull();
  });

  it('clears legacy order keys', () => {
    localStorage.setItem('remoteterm-sidebar-section-order', JSON.stringify(ALL_SECTION_KEYS));
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(ALL_TOOL_KEYS));
    clearLegacyLocalOrders();
    expect(localStorage.getItem('remoteterm-sidebar-section-order')).toBeNull();
    expect(localStorage.getItem('remoteterm-sidebar-tool-order')).toBeNull();
  });
});

describe('sidebarLayout rail collapse (client-local)', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to false and round-trips', () => {
    expect(loadRailCollapsed()).toBe(false);
    saveRailCollapsed(true);
    expect(loadRailCollapsed()).toBe(true);
  });

  it('resetSidebarLayout clears rail + legacy order keys', () => {
    saveRailCollapsed(true);
    localStorage.setItem('remoteterm-sidebar-section-order', JSON.stringify(ALL_SECTION_KEYS));
    resetSidebarLayout();
    expect(loadRailCollapsed()).toBe(false);
    expect(localStorage.getItem('remoteterm-sidebar-section-order')).toBeNull();
  });

  const tk: SidebarToolKey = 'cracker';
  it('has cracker as a valid tool key', () => expect(ALL_TOOL_KEYS).toContain(tk));
});

describe('contact groups: pure state-transition helpers', () => {
  const makeGroup = (overrides: Partial<ContactGroup> = {}): ContactGroup => ({
    id: 'grp-1',
    name: 'Field team',
    contact_keys: [],
    channel_keys: [],
    ...overrides,
  });

  it('creates a group with a fresh id and a trimmed name', () => {
    const g = createContactGroup('  Backups  ');
    expect(g.name).toBe('Backups');
    expect(g.contact_keys).toEqual([]);
    expect(g.channel_keys).toEqual([]);
    expect(g.id).toBeTruthy();

    const g2 = createContactGroup('Backups');
    expect(g2.id).not.toBe(g.id);
  });

  it('renames a group by id, trimming the name, and ignores a blank name', () => {
    const groups = [makeGroup()];
    const renamed = renameContactGroup(groups, 'grp-1', '  Renamed  ');
    expect(renamed[0].name).toBe('Renamed');

    const unchanged = renameContactGroup(groups, 'grp-1', '   ');
    expect(unchanged).toBe(groups);

    const untouched = renameContactGroup(groups, 'grp-missing', 'X');
    expect(untouched[0].name).toBe('Field team');
  });

  it('deletes a group by id', () => {
    const groups = [makeGroup(), makeGroup({ id: 'grp-2', name: 'Backups' })];
    expect(deleteContactGroup(groups, 'grp-1')).toEqual([groups[1]]);
    expect(deleteContactGroup(groups, 'grp-missing')).toHaveLength(2);
  });

  it('toggles contact membership on and off, lowercasing the key', () => {
    const groups = [makeGroup()];
    const added = toggleGroupMember(groups, 'grp-1', 'contact', 'ABCDEF01');
    expect(added[0].contact_keys).toEqual(['abcdef01']);

    const removed = toggleGroupMember(added, 'grp-1', 'contact', 'abcdef01');
    expect(removed[0].contact_keys).toEqual([]);
  });

  it('toggles channel membership independently of contact membership', () => {
    const groups = [makeGroup()];
    const added = toggleGroupMember(groups, 'grp-1', 'channel', 'chan-key-1');
    expect(added[0].channel_keys).toEqual(['chan-key-1']);
    expect(added[0].contact_keys).toEqual([]);
  });

  it('finds groups containing a contact/channel, case-insensitively for contacts', () => {
    const groups = [
      makeGroup({ contact_keys: ['abcdef01'], channel_keys: ['chan-1'] }),
      makeGroup({ id: 'grp-2', name: 'Other', contact_keys: [], channel_keys: [] }),
    ];
    expect(groupsContainingContact(groups, 'ABCDEF01')).toEqual([groups[0]]);
    expect(groupsContainingChannel(groups, 'chan-1')).toEqual([groups[0]]);
    expect(isContactGrouped(groups, 'abcdef01')).toBe(true);
    expect(isContactGrouped(groups, 'nope')).toBe(false);
    expect(isChannelGrouped(groups, 'chan-1')).toBe(true);
    expect(isChannelGrouped(groups, 'nope')).toBe(false);
  });

  it('one item can belong to several groups at once', () => {
    const groups = [
      makeGroup({ id: 'grp-1', contact_keys: ['abcdef01'] }),
      makeGroup({ id: 'grp-2', name: 'Other', contact_keys: ['abcdef01'] }),
    ];
    expect(groupsContainingContact(groups, 'abcdef01')).toHaveLength(2);
  });
});

describe('sidebarLayout group collapse state (client-local)', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to an empty object and round-trips', () => {
    expect(loadGroupCollapsed()).toEqual({});
    saveGroupCollapsed({ 'grp-1': true });
    expect(loadGroupCollapsed()).toEqual({ 'grp-1': true });
  });

  it('tolerates corrupt storage', () => {
    localStorage.setItem('remoteterm-sidebar-group-collapse-state', 'not json');
    expect(loadGroupCollapsed()).toEqual({});
  });
});
