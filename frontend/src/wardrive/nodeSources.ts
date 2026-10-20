// Where the page's names come from, and where it keeps them for offline use:
// RTFM-EV's nodes around the driver (fetched per box), the hashtag channel
// list the owner serves, and the channels the driver added in this browser.
import type { NodeBox, ServedNode } from './api';
import type { DirectoryNode } from './names';

export type { NodeBox } from './api';

const BOX_HALF_LAT = 1.0;
const BOX_HALF_LON = 1.6;
const DB_VERSION = 1;
const STORE = 'nodes';
const RECORD = 'directory';

export const DRIVER_CHANNELS_KEY = 'rtfm-wardrive-driver-channels';

/** The box of nodes fetched around a position: 1 degree of latitude and 1.6
 * of longitude each way (about 110 km by 110 km in the Netherlands). */
export function boxAround(lat: number, lon: number): NodeBox {
  return {
    minLat: lat - BOX_HALF_LAT,
    maxLat: lat + BOX_HALF_LAT,
    minLon: lon - BOX_HALF_LON,
    maxLon: lon + BOX_HALF_LON,
  };
}

/** True when there is no box yet or the position left its middle half. */
export function needsNewBox(box: NodeBox | null, lat: number, lon: number): boolean {
  if (!box) return true;
  const midLat = (box.minLat + box.maxLat) / 2;
  const midLon = (box.minLon + box.maxLon) / 2;
  const quarterLat = (box.maxLat - box.minLat) / 4;
  const quarterLon = (box.maxLon - box.minLon) / 4;
  return Math.abs(lat - midLat) > quarterLat || Math.abs(lon - midLon) > quarterLon;
}

export function servedToNode(n: ServedNode): DirectoryNode {
  return {
    publicKey: n.public_key.toLowerCase(),
    name: n.name,
    role: n.role,
    lat: n.lat,
    lon: n.lon,
    seen: n.seen,
  };
}

export interface NodeCacheData {
  box: NodeBox | null;
  nodes: DirectoryNode[];
  channels: string[];
}

export interface NodeCache {
  load(): Promise<NodeCacheData>;
  save(data: NodeCacheData): Promise<void>;
}

const EMPTY: NodeCacheData = { box: null, nodes: [], channels: [] };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The last fetched nodes and channel list, in this browser's IndexedDB. */
export function openNodeCache(name = 'rtfm-wardrive-nodes'): Promise<NodeCache> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      resolve({
        async load() {
          const tx = db.transaction(STORE, 'readonly');
          const row = (await req(tx.objectStore(STORE).get(RECORD))) as NodeCacheData | undefined;
          return row ? { ...EMPTY, ...row } : { ...EMPTY };
        },
        async save(data) {
          const tx = db.transaction(STORE, 'readwrite');
          await req(tx.objectStore(STORE).put(data, RECORD));
        },
      });
    };
  });
}

/** The hashtag channels the driver added in this browser. */
export function loadDriverChannels(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRIVER_CHANNELS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDriverChannels(names: string[]): void {
  try {
    localStorage.setItem(DRIVER_CHANNELS_KEY, JSON.stringify(names));
  } catch {
    // Storage blocked: the list lasts for this page load.
  }
}
