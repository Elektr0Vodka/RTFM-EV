import { describe, expect, it } from 'vitest';
import { radioFloodScopeRegions } from '../components/settings/hostRepeater/floodScopeRegions';
import {
  MAX_REGIONS,
  importRepeaterRegions,
  regionRows,
  selfAndDescendants,
} from '../components/settings/hostRepeater/regionTree';
import type { Channel, HostRepeaterRegion } from '../types';

const tree: HostRepeaterRegion[] = [
  { name: 'nl-nh-ams', parent: 'nl-nh', deny_flood: false },
  { name: 'nl', parent: null, deny_flood: false },
  { name: 'be', parent: null, deny_flood: true },
  { name: 'nl-nh', parent: 'nl', deny_flood: false },
];

describe('radioFloodScopeRegions', () => {
  it('takes the default scope and channel overrides, strips # and skips unscoped markers', () => {
    const channels = [
      { flood_scope_override: '#be' },
      { flood_scope_override: '*' },
      { flood_scope_override: null },
      { flood_scope_override: 'nl' },
    ] as Channel[];
    expect(radioFloodScopeRegions('#nl', channels)).toEqual(['nl', 'be']);
    expect(radioFloodScopeRegions('', undefined)).toEqual([]);
    expect(radioFloodScopeRegions('0', [])).toEqual([]);
  });
});

describe('regionTree', () => {
  it('orders rows parents first with firmware depths', () => {
    expect(regionRows(tree).map((r) => [r.region.name, r.depth])).toEqual([
      ['nl', 1],
      ['nl-nh', 2],
      ['nl-nh-ams', 3],
      ['be', 1],
    ]);
  });

  it('does not offer a region or its descendants as its own parent', () => {
    expect([...selfAndDescendants(tree, 'nl')].sort()).toEqual(['nl', 'nl-nh', 'nl-nh-ams']);
  });

  it('maps an admin region dump to parents, deny flags, home and the wildcard', () => {
    const imported = importRepeaterRegions({
      regions: [
        { name: '*', depth: 0, flood_allowed: true, is_home: false },
        { name: 'nl', depth: 1, flood_allowed: true, is_home: false },
        { name: 'nl-nh', depth: 2, flood_allowed: true, is_home: true },
        { name: 'nl-zh', depth: 2, flood_allowed: false, is_home: false },
        { name: 'be', depth: 1, flood_allowed: true, is_home: false },
      ],
      raw: null,
      truncated: true,
      source: 'cli',
    });
    expect(imported.regions).toEqual([
      { name: 'nl', parent: null, deny_flood: false },
      { name: 'nl-nh', parent: 'nl', deny_flood: false },
      { name: 'nl-zh', parent: 'nl', deny_flood: true },
      { name: 'be', parent: null, deny_flood: false },
    ]);
    expect(imported.homeRegion).toBe('nl-nh');
    expect(imported.wildcardAllowed).toBe(true);
    expect(imported.truncated).toBe(true);
    expect(imported.anon).toBe(false);
  });

  it('treats a guest answer as a flat allow list and * missing as denied', () => {
    const imported = importRepeaterRegions({
      regions: [
        { name: 'nl', depth: 0, flood_allowed: true, is_home: false },
        { name: 'be', depth: 0, flood_allowed: true, is_home: false },
      ],
      raw: null,
      truncated: false,
      source: 'anon',
    });
    expect(imported.regions.map((r) => [r.name, r.parent])).toEqual([
      ['nl', null],
      ['be', null],
    ]);
    expect(imported.wildcardAllowed).toBe(false);
    expect(imported.anon).toBe(true);
  });

  it('keeps at most the firmware limit of regions', () => {
    const imported = importRepeaterRegions({
      regions: Array.from({ length: MAX_REGIONS + 3 }, (_, i) => ({
        name: `r${i}`,
        depth: 1,
        flood_allowed: true,
        is_home: false,
      })),
      raw: null,
      truncated: false,
      source: 'cli',
    });
    expect(imported.regions).toHaveLength(MAX_REGIONS);
    expect(imported.capped).toBe(true);
  });
});
