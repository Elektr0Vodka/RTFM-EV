// Power-outage resilience model for the Mesh Health "Power Outage" tab. Pure:
// takes nodes (already classified by power source) and RF links, returns which
// nodes stay online when the grid goes down and how the surviving nodes group
// into islands that can still reach each other.

import { survivesOutage, type PowerSource } from './powerSource';

export interface ResilienceNode {
  key: string; // lowercase public key
  power: PowerSource;
}

export interface ResilienceLink {
  a: string; // lowercase public key
  b: string;
}

export interface ResilienceResult {
  /** Island id per surviving node (1 = largest island). Dark nodes are absent. */
  islandOf: Map<string, number>;
  /** Island sizes, index 0 = island 1, largest first. */
  islandSizes: number[];
  survivors: number;
  dark: number;
  /** Links whose endpoints are both known nodes. */
  links: number;
  /** Links whose endpoints both survive. */
  survivingLinks: number;
}

/**
 * Surviving nodes are grouped by connected components over links where both
 * endpoints survive. A surviving node without any surviving link is an island
 * of one. Links to nodes outside `nodes` are ignored.
 */
export function computeResilience(
  nodes: readonly ResilienceNode[],
  links: readonly ResilienceLink[]
): ResilienceResult {
  const powerOf = new Map<string, PowerSource>();
  for (const n of nodes) powerOf.set(n.key, n.power);

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    // Path compression.
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c) as string;
      parent.set(c, r);
      c = next;
    }
    return r;
  };

  let survivors = 0;
  for (const n of nodes) {
    if (survivesOutage(n.power)) {
      survivors += 1;
      parent.set(n.key, n.key);
    }
  }

  let linkCount = 0;
  let survivingLinks = 0;
  const seen = new Set<string>();
  for (const l of links) {
    if (l.a === l.b) continue;
    const pair = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const pa = powerOf.get(l.a);
    const pb = powerOf.get(l.b);
    if (pa === undefined || pb === undefined) continue;
    linkCount += 1;
    if (!survivesOutage(pa) || !survivesOutage(pb)) continue;
    survivingLinks += 1;
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const members = new Map<string, string[]>();
  for (const key of parent.keys()) {
    const r = find(key);
    const list = members.get(r);
    if (list) list.push(key);
    else members.set(r, [key]);
  }
  // Largest island first; ties broken by smallest member key for stable ids.
  const groups = [...members.values()].map((g) => g.sort());
  groups.sort((x, y) => y.length - x.length || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  const islandOf = new Map<string, number>();
  groups.forEach((g, i) => {
    for (const key of g) islandOf.set(key, i + 1);
  });

  return {
    islandOf,
    islandSizes: groups.map((g) => g.length),
    survivors,
    dark: nodes.length - survivors,
    links: linkCount,
    survivingLinks,
  };
}
