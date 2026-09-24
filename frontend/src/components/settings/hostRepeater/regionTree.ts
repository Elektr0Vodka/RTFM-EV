import type { HostRepeaterRegion, RepeaterRegionsResponse } from '../../../types';

/** Firmware RegionMap MAX_REGION_ENTRIES (app/services/host_repeater_settings.py MAX_REGIONS). */
export const MAX_REGIONS = 32;

export interface RegionRow {
  region: HostRepeaterRegion;
  /** Wildcard children are depth 1, like RegionMap::depthOf. */
  depth: number;
}

/** Regions in tree order (parents before children, list order within a level). */
export function regionRows(regions: HostRepeaterRegion[]): RegionRow[] {
  const names = new Set(regions.map((r) => r.name));
  const rows: RegionRow[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const region of regions) {
      const effectiveParent =
        region.parent !== null && names.has(region.parent) ? region.parent : null;
      if (effectiveParent !== parent || visited.has(region.name)) continue;
      visited.add(region.name);
      rows.push({ region, depth });
      walk(region.name, depth + 1);
    }
  };
  walk(null, 1);
  // Anything left sits in a parent loop; show it at the top level so it can be fixed.
  for (const region of regions) {
    if (!visited.has(region.name)) rows.push({ region, depth: 1 });
  }
  return rows;
}

/** ``name`` and every region below it (not valid as its parent). */
export function selfAndDescendants(regions: HostRepeaterRegion[], name: string): Set<string> {
  const result = new Set([name]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const region of regions) {
      if (region.parent !== null && result.has(region.parent) && !result.has(region.name)) {
        result.add(region.name);
        grew = true;
      }
    }
  }
  return result;
}

export interface ImportedRegions {
  regions: HostRepeaterRegion[];
  homeRegion: string | null;
  /** Whether the wildcard '*' (plain floods) is allowed; null when the dump does not say. */
  wildcardAllowed: boolean | null;
  truncated: boolean;
  anon: boolean;
  capped: boolean;
}

/**
 * Map a repeater's region answer onto the host repeater region map.
 *
 * ``cli`` is the admin ``region`` dump: one space of indent per level, the wildcard
 * ``*`` at depth 0, ``^`` marks home, a missing `` F`` means flood denied
 * (RegionMap::printChildRegions). ``anon`` is the guest list of flood-allowed names
 * only, without parents or home.
 */
export function importRepeaterRegions(response: RepeaterRegionsResponse): ImportedRegions {
  const anon = response.source === 'anon';
  const regions: HostRepeaterRegion[] = [];
  const stack: string[] = [];
  let homeRegion: string | null = null;
  let wildcardAllowed: boolean | null = anon ? false : null;
  for (const entry of response.regions) {
    const name = entry.name.replace(/^#/, '');
    if (name === '*') {
      wildcardAllowed = entry.flood_allowed;
      continue;
    }
    if (!name || regions.some((r) => r.name === name)) continue;
    const depth = anon ? 1 : Math.max(1, entry.depth);
    stack.length = depth;
    stack[depth] = name;
    const parent = depth >= 2 ? (stack[depth - 1] ?? null) : null;
    regions.push({ name, parent, deny_flood: !entry.flood_allowed });
    if (entry.is_home) homeRegion = name;
  }
  const capped = regions.length > MAX_REGIONS;
  const kept = regions.slice(0, MAX_REGIONS);
  const keptNames = new Set(kept.map((r) => r.name));
  return {
    regions: kept.map((r) =>
      r.parent !== null && !keptNames.has(r.parent) ? { ...r, parent: null } : r
    ),
    homeRegion: homeRegion !== null && keptNames.has(homeRegion) ? homeRegion : null,
    wildcardAllowed,
    truncated: response.truncated,
    anon,
    capped,
  };
}
