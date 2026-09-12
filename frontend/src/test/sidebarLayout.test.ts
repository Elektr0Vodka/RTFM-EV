import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  loadSectionOrder,
  saveSectionOrder,
  loadToolOrder,
  loadRailCollapsed,
  saveRailCollapsed,
  type SidebarSectionKey,
  type SidebarToolKey,
} from '../utils/sidebarLayout';

describe('sidebarLayout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing stored', () => {
    expect(loadSectionOrder()).toEqual(ALL_SECTION_KEYS);
    expect(loadToolOrder()).toEqual(ALL_TOOL_KEYS);
    expect(loadRailCollapsed()).toBe(false);
  });

  it('round-trips a custom section order', () => {
    const order: SidebarSectionKey[] = ['favorites', 'tools', 'channels', 'contacts'];
    saveSectionOrder(order);
    expect(loadSectionOrder()).toEqual(order);
  });

  it('drops legacy repeaters/rooms keys from a stored order', () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['contacts', 'repeaters', 'rooms', 'channels'])
    );
    const loaded = loadSectionOrder();
    expect(loaded).not.toContain('repeaters');
    expect(loaded).not.toContain('rooms');
    expect(loaded[0]).toBe('contacts');
    expect([...loaded].sort()).toEqual([...ALL_SECTION_KEYS].sort());
  });

  it('appends newly-added keys missing from stored order and drops unknown keys', () => {
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(['map', 'bogus-old-key']));
    const loaded = loadToolOrder();
    expect(loaded[0]).toBe('map');
    expect(loaded).not.toContain('bogus-old-key');
    // every canonical key present exactly once
    expect([...loaded].sort()).toEqual([...ALL_TOOL_KEYS].sort());
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('remoteterm-sidebar-section-order', '{not json');
    expect(loadSectionOrder()).toEqual(ALL_SECTION_KEYS);
  });

  it('round-trips rail collapsed', () => {
    saveRailCollapsed(true);
    expect(loadRailCollapsed()).toBe(true);
  });

  const tk: SidebarToolKey = 'cracker';
  it('has cracker as a valid tool key', () => expect(ALL_TOOL_KEYS).toContain(tk));
});
