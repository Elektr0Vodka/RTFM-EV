// One view of the receptions for the map, the log and the HUD: each entry
// named (attribution and name, worked out again only when the directory
// changes) and filtered (per tick). Entry objects keep their identity while
// nothing about them changed, so memoised rows do not re-render.
import { useMemo, useRef } from 'react';

import { makeFilter, standFilter, type Filter, type Stand } from './filters';
import type { LiveEntry } from './liveLog';
import {
  attribute,
  nameParts,
  type Attribution,
  type NameParts,
  type NodeDirectory,
} from './names';

export interface ViewEntry extends LiveEntry {
  attr: Attribution | null;
  name: NameParts;
  /** Passes the filter (always true in the shown set of the Filtered stand). */
  inFilter: boolean;
}

interface Named {
  entry: LiveEntry;
  version: number;
  attr: Attribution | null;
  name: NameParts;
  view: { inFilter: boolean; obj: ViewEntry } | null;
}

export function useReceptionView({
  entries,
  directory,
  filter,
  stand,
  ignore,
  nowMs,
}: {
  entries: LiveEntry[];
  directory: NodeDirectory;
  filter: Filter;
  stand: Stand;
  ignore: Set<string>;
  nowMs: number;
}): { shown: ViewEntry[]; all: ViewEntry[] } {
  const cache = useRef(new Map<number, Named>());

  const named = useMemo(() => {
    const next = new Map<number, Named>();
    const list = entries.map((entry) => {
      let n = cache.current.get(entry.id);
      if (!n || n.entry !== entry || n.version !== directory.version) {
        const attr = attribute(
          entry.sender,
          { lat: entry.lat, lon: entry.lon, rssi: entry.rssi },
          directory
        );
        n = {
          entry,
          version: directory.version,
          attr,
          name: nameParts(entry.sender, attr, directory),
          view: null,
        };
      }
      next.set(entry.id, n);
      return n;
    });
    cache.current = next;
    return list;
  }, [entries, directory]);

  // The lists of the last tick: kept while every element is the same object,
  // so the map and the log only redraw when something changed.
  const last = useRef<{ shown: ViewEntry[]; all: ViewEntry[] }>({ shown: [], all: [] });

  return useMemo(() => {
    const passes = makeFilter(filter, ignore);
    const window = makeFilter(standFilter('all', filter), ignore);
    const all: ViewEntry[] = [];
    const shown: ViewEntry[] = [];
    for (const n of named) {
      const inFilter = passes(n.entry, nowMs);
      if (!n.view || n.view.inFilter !== inFilter) {
        n.view = { inFilter, obj: { ...n.entry, attr: n.attr, name: n.name, inFilter } };
      }
      const obj = n.view.obj;
      all.push(obj);
      if (stand === 'filtered' ? inFilter : window(n.entry, nowMs)) shown.push(obj);
    }
    const next = {
      shown: sameItems(last.current.shown, shown) ? last.current.shown : shown,
      all: sameItems(last.current.all, all) ? last.current.all : all,
    };
    last.current = next;
    return next;
  }, [named, filter, stand, ignore, nowMs]);
}

function sameItems<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
