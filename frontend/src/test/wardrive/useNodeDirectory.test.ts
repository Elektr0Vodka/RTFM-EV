import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WardriveApiError, wardriveApi } from '../../wardrive/api';
import type { Fix } from '../../wardrive/messages';
import type { DirectoryNode } from '../../wardrive/names';
import {
  DRIVER_CHANNELS_KEY,
  type NodeCache,
  type NodeCacheData,
} from '../../wardrive/nodeSources';
import { useNodeDirectory, type RadioContacts } from '../../wardrive/useNodeDirectory';

const KEY = 'ab'.repeat(32);
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);
const MIN = 60000;

function memoryCache(initial: Partial<NodeCacheData> = {}): NodeCache & { saved: NodeCacheData[] } {
  let data: NodeCacheData = { box: null, nodes: [], channels: [], ...initial };
  const saved: NodeCacheData[] = [];
  return {
    saved,
    load: async () => data,
    save: async (next) => {
      data = next;
      saved.push(next);
    },
  };
}

const fixAt = (lat: number, lon: number): Fix => ({ lat, lon, accM: 5, at: Date.now() });

function served(name: string, seen: number) {
  return { public_key: KEY.toUpperCase(), name, role: 'Repeater', lat: 52, lon: 6, seen };
}

function radio(nodes: DirectoryNode[]): RadioContacts & { calls: number } {
  const r = {
    calls: 0,
    contacts: async () => {
      r.calls++;
      return nodes;
    },
  };
  return r;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe('useNodeDirectory', () => {
  it('names from the cache when logged out and offline', async () => {
    const config = vi.spyOn(wardriveApi, 'config');
    const nodes = vi.spyOn(wardriveApi, 'nodes');
    const cache = memoryCache({
      nodes: [{ publicKey: KEY, name: 'Cached', role: null, lat: null, lon: null, seen: 1 }],
    });
    const { result } = renderHook(() =>
      useNodeDirectory({ loggedIn: false, offline: true, fix: null, companion: null, cache })
    );
    await waitFor(() => expect(result.current.directory.byKey(KEY)?.name).toBe('Cached'));
    expect(config).not.toHaveBeenCalled();
    expect(nodes).not.toHaveBeenCalled();
  });

  it('fetches config once and nodes again only after leaving the box and 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const config = vi.spyOn(wardriveApi, 'config').mockResolvedValue({ hashtag_channels: ['#a'] });
    const nodes = vi
      .spyOn(wardriveApi, 'nodes')
      .mockResolvedValue({ nodes: [served('Toren', 5)], truncated: false });
    const cache = memoryCache();
    const { result, rerender } = renderHook(
      ({ fix }: { fix: Fix | null }) =>
        useNodeDirectory({ loggedIn: true, offline: false, fix, companion: null, cache }),
      { initialProps: { fix: fixAt(52, 6) } }
    );
    await waitFor(() => expect(result.current.directory.byKey(KEY)?.name).toBe('Toren'));
    expect(result.current.channels).toEqual(['#a']);
    rerender({ fix: fixAt(52.009, 6) });
    vi.setSystemTime(T0 + 5 * MIN);
    rerender({ fix: fixAt(52.6, 6) });
    await act(async () => {});
    expect(nodes).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 11 * MIN);
    rerender({ fix: fixAt(52.61, 6) });
    await waitFor(() => expect(nodes).toHaveBeenCalledTimes(2));
    expect(nodes.mock.calls[1][0].minLat).toBeCloseTo(51.61);
    expect(config).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cache.saved[cache.saved.length - 1]?.channels).toEqual(['#a']));
  });

  it('names a key from the newer of the radio and RTFM-EV', async () => {
    vi.spyOn(wardriveApi, 'config').mockResolvedValue({ hashtag_channels: [] });
    vi.spyOn(wardriveApi, 'nodes').mockResolvedValue({
      nodes: [served('Served', 5)],
      truncated: false,
    });
    const companion = radio([
      { publicKey: KEY, name: 'Radio', role: null, lat: null, lon: null, seen: 9 },
    ]);
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: true,
        offline: false,
        fix: fixAt(52, 6),
        companion,
        cache: memoryCache(),
      })
    );
    await waitFor(() => expect(result.current.directory.byKey(KEY)?.name).toBe('Radio'));
  });

  it('reads the radio contacts once per connection', async () => {
    const first = radio([]);
    const second = radio([]);
    const cache = memoryCache();
    const { rerender } = renderHook(
      ({ companion }: { companion: RadioContacts }) =>
        useNodeDirectory({ loggedIn: false, offline: true, fix: null, companion, cache }),
      { initialProps: { companion: first } }
    );
    await waitFor(() => expect(first.calls).toBe(1));
    rerender({ companion: first });
    rerender({ companion: second });
    await waitFor(() => expect(second.calls).toBe(1));
    expect(first.calls).toBe(1);
  });

  it('keeps the cached nodes when the fetch fails', async () => {
    vi.spyOn(wardriveApi, 'config').mockResolvedValue({ hashtag_channels: [] });
    const nodes = vi
      .spyOn(wardriveApi, 'nodes')
      .mockRejectedValue(new WardriveApiError('Internal Server Error', 500));
    const cache = memoryCache({
      nodes: [{ publicKey: KEY, name: 'Cached', role: null, lat: null, lon: null, seen: 1 }],
    });
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: true,
        offline: false,
        fix: fixAt(52, 6),
        companion: null,
        cache,
      })
    );
    await waitFor(() => expect(nodes).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.directory.byKey(KEY)?.name).toBe('Cached');
  });

  it('adds the driver channels to the keys and keeps them', async () => {
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: false,
        offline: true,
        fix: null,
        companion: null,
        cache: memoryCache(),
      })
    );
    act(() => result.current.setDriverChannels(['#zwolle']));
    await waitFor(() =>
      expect([...result.current.channelKeys.nameByHash.values()]).toContain('#zwolle')
    );
    expect(result.current.driverChannels).toEqual(['#zwolle']);
    expect(localStorage.getItem(DRIVER_CHANNELS_KEY)).toBe('["#zwolle"]');
  });

  it('decodes Public before anything has loaded', () => {
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: false,
        offline: true,
        fix: null,
        companion: null,
        cache: memoryCache(),
      })
    );
    expect([...result.current.channelKeys.nameByHash.values()]).toEqual(['Public']);
  });

  it('keeps the Public keys while no channel is known', async () => {
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: false,
        offline: true,
        fix: null,
        companion: null,
        cache: memoryCache(),
      })
    );
    const first = result.current.channelKeys;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.channelKeys).toBe(first);
  });

  it('builds the keys once when RTFM-EV serves the list the cache already had', async () => {
    const config = vi.spyOn(wardriveApi, 'config').mockResolvedValue({ hashtag_channels: ['#a'] });
    vi.spyOn(wardriveApi, 'nodes').mockResolvedValue({ nodes: [], truncated: false });
    const { result } = renderHook(() =>
      useNodeDirectory({
        loggedIn: true,
        offline: false,
        fix: null,
        companion: null,
        cache: memoryCache({ channels: ['#a'] }),
      })
    );
    await waitFor(() =>
      expect([...result.current.channelKeys.nameByHash.values()]).toContain('#a')
    );
    const built = result.current.channelKeys;
    await waitFor(() => expect(config).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.channelKeys).toBe(built);
  });
});
