import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  ALL_FAVORITE_GROUP_KEYS,
  resolveSectionOrder,
  resolveToolOrder,
  resolveFavoritesOrder,
  resolveHidden,
  readLegacyLocalOrders,
  clearLegacyLocalOrders,
  loadRailCollapsed,
  saveRailCollapsed,
  resetSidebarLayout,
  type SidebarToolKey,
} from '../utils/sidebarLayout';

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
