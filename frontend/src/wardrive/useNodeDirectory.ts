// The names the page reads receptions with: RTFM-EV's nodes around the driver
// and the contacts on the driver's own radio, plus the channel keys (Public,
// the owner's hashtag channels, the driver's own). Cached in the browser so a
// drive without RTFM-EV still has names.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { wardriveApi } from './api';
import { isUsableFix } from './capture';
import { buildChannelKeys, publicChannelKeys, type ChannelKeys } from './decode/channels';
import type { Fix } from './messages';
import { NodeDirectory, type DirectoryNode } from './names';
import {
  boxAround,
  loadDriverChannels,
  needsNewBox,
  openNodeCache,
  saveDriverChannels,
  servedToNode,
  type NodeBox,
  type NodeCache,
} from './nodeSources';

/** Nodes are fetched again at most this often, and only after the driver
 * left the middle half of the last box. */
export const NODE_REFETCH_MS = 10 * 60 * 1000;

/** What the hook needs of the radio: its contact table. */
export interface RadioContacts {
  contacts(): Promise<DirectoryNode[]>;
}

export interface NodeDirectoryState {
  directory: NodeDirectory;
  channelKeys: ChannelKeys;
  /** The hashtag channels RTFM-EV serves. */
  channels: string[];
  /** The hashtag channels the driver added in this browser. */
  driverChannels: string[];
  setDriverChannels(names: string[]): void;
}

export function useNodeDirectory({
  loggedIn,
  offline,
  fix,
  companion,
  cache,
}: {
  loggedIn: boolean;
  offline: boolean;
  fix: Fix | null;
  companion: RadioContacts | null;
  /** Where to keep the nodes; the browser's IndexedDB when left out. */
  cache?: NodeCache | Promise<NodeCache | null>;
}): NodeDirectoryState {
  const [served, setServed] = useState<DirectoryNode[]>([]);
  const [radioNodes, setRadioNodes] = useState<DirectoryNode[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [driverChannels, setDriverChannelsState] = useState<string[]>(loadDriverChannels);
  const [channelKeys, setChannelKeys] = useState<ChannelKeys>(publicChannelKeys);

  // What the cache holds, kept current so each save writes all of it.
  const stored = useRef<{ box: NodeBox | null; nodes: DirectoryNode[]; channels: string[] }>({
    box: null,
    nodes: [],
    channels: [],
  });
  const cacheRef = useRef<Promise<NodeCache | null> | null>(null);
  // Set once RTFM-EV answered: a cache load that finishes later is older.
  const fetchedNodes = useRef(false);
  const fetchedChannels = useRef(false);
  // The box fetched during this page load (a cached box may be days old).
  const box = useRef<NodeBox | null>(null);
  const lastAttempt = useRef<number | null>(null);
  const fetching = useRef(false);

  // The first cache given is used for the life of the page; a caller that
  // passes a new object per render must not reload it every render.
  const firstCache = useRef(cache);
  const getCache = useCallback((): Promise<NodeCache | null> => {
    if (!cacheRef.current) {
      const given = firstCache.current;
      cacheRef.current = given
        ? Promise.resolve(given).catch(() => null)
        : openNodeCache().catch(() => null as NodeCache | null);
    }
    return cacheRef.current;
  }, []);

  const save = useCallback(() => {
    void getCache().then((c) => c?.save({ ...stored.current }).catch(() => undefined));
  }, [getCache]);

  useEffect(() => {
    let cancelled = false;
    void getCache()
      .then((c) => c?.load())
      .then((data) => {
        if (cancelled || !data) return;
        if (!fetchedNodes.current) {
          stored.current.nodes = data.nodes;
          stored.current.box = data.box;
          setServed(data.nodes);
        }
        if (!fetchedChannels.current) {
          stored.current.channels = data.channels;
          setChannels(data.channels);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [getCache]);

  useEffect(() => {
    if (!loggedIn || offline) return;
    let cancelled = false;
    wardriveApi
      .config()
      .then((c) => {
        if (cancelled) return;
        fetchedChannels.current = true;
        stored.current.channels = c.hashtag_channels;
        setChannels(c.hashtag_channels);
        save();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loggedIn, offline, save]);

  useEffect(() => {
    if (!loggedIn || offline || fetching.current) return;
    const now = Date.now();
    if (!isUsableFix(fix, now)) return;
    if (!needsNewBox(box.current, fix.lat, fix.lon)) return;
    if (lastAttempt.current !== null && now - lastAttempt.current < NODE_REFETCH_MS) return;
    const next = boxAround(fix.lat, fix.lon);
    lastAttempt.current = now;
    fetching.current = true;
    wardriveApi
      .nodes(next)
      .then((r) => {
        const nodes = r.nodes.map(servedToNode);
        fetchedNodes.current = true;
        box.current = next;
        stored.current = { ...stored.current, box: next, nodes };
        setServed(nodes);
        save();
      })
      .catch(() => undefined)
      .finally(() => {
        fetching.current = false;
      });
  }, [fix, loggedIn, offline, save]);

  useEffect(() => {
    if (!companion) return;
    let cancelled = false;
    companion
      .contacts()
      .then((nodes) => {
        if (!cancelled) setRadioNodes(nodes);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companion]);

  // New keys only when the names change: every new keys object makes the page
  // decode its stored receptions again.
  const names = [...channels, ...driverChannels].join('\n');
  const builtNames = useRef('');
  useEffect(() => {
    if (names === builtNames.current) return;
    let cancelled = false;
    void buildChannelKeys(names ? names.split('\n') : []).then((keys) => {
      if (cancelled) return;
      builtNames.current = names;
      setChannelKeys(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [names]);

  const setDriverChannels = useCallback((names: string[]) => {
    setDriverChannelsState(names);
    saveDriverChannels(names);
  }, []);

  const directory = useMemo(
    () => new NodeDirectory([...served, ...radioNodes]),
    [served, radioNodes]
  );

  return useMemo(
    () => ({ directory, channelKeys, channels, driverChannels, setDriverChannels }),
    [directory, channelKeys, channels, driverChannels, setDriverChannels]
  );
}
