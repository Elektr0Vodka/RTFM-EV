import type { Channel } from '../../../types';

// Values that mean "plain flood, no region" (app/region_scope.py _UNSCOPED_SENTINELS).
const UNSCOPED = new Set(['', '0', '*']);

/**
 * Region names the radio floods with: the default flood scope plus every channel
 * flood-scope override. Returned without the leading ``#``, the same form as
 * ``known_regions`` and the host repeater region list.
 */
export function radioFloodScopeRegions(
  floodScope: string | null | undefined,
  channels: Channel[] | undefined
): string[] {
  const names = new Set<string>();
  const add = (scope: string | null | undefined) => {
    const trimmed = (scope ?? '').trim();
    if (UNSCOPED.has(trimmed)) return;
    const name = trimmed.replace(/^#/, '');
    if (name) names.add(name);
  };
  add(floodScope);
  for (const channel of channels ?? []) add(channel.flood_scope_override);
  return Array.from(names);
}
