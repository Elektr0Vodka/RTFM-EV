import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSeenItems, SIDEBAR_SEEN_ITEMS_KEY } from '../hooks/useSeenItems';
import { getStateKey } from '../utils/conversationState';

const chan = (k: string) => getStateKey('channel', k);

describe('useSeenItems', () => {
  beforeEach(() => localStorage.clear());

  it('baselines all current identities on first run so nothing is new', () => {
    const ids = [chan('a'), chan('b')];
    const { result } = renderHook(() => useSeenItems(ids, null));
    expect(result.current.countNew(ids)).toBe(0);
    expect(result.current.isNew(chan('a'))).toBe(false);
    // baseline persisted
    expect(localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY)).not.toBeNull();
  });

  it('flags identities that appear after the baseline as new', () => {
    const initial = [chan('a')];
    const { result, rerender } = renderHook(({ ids }) => useSeenItems(ids, null), {
      initialProps: { ids: initial },
    });
    const grown = [chan('a'), chan('b')];
    rerender({ ids: grown });
    expect(result.current.isNew(chan('b'))).toBe(true);
    expect(result.current.countNew(grown)).toBe(1);
  });

  it('clears new state for the active channel/contact conversation', () => {
    // Pre-seed a baseline that excludes 'b' so 'b' is new.
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([chan('a')]));
    const ids = [chan('a'), chan('b')];
    const { result, rerender } = renderHook(({ active }) => useSeenItems(ids, active), {
      initialProps: { active: null as null | { type: 'channel'; id: string; name: string } },
    });
    expect(result.current.isNew(chan('b'))).toBe(true);
    rerender({ active: { type: 'channel', id: 'b', name: 'B' } });
    expect(result.current.isNew(chan('b'))).toBe(false);
  });

  it('markSeen adds identities and persists', () => {
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([chan('a')]));
    const ids = [chan('a'), chan('b'), chan('c')];
    const { result } = renderHook(() => useSeenItems(ids, null));
    act(() => result.current.markSeen([chan('b'), chan('c')]));
    expect(result.current.countNew(ids)).toBe(0);
    const stored = JSON.parse(localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY) as string);
    expect(new Set(stored)).toEqual(new Set([chan('a'), chan('b'), chan('c')]));
  });

  it('does not throw when localStorage is unavailable', () => {
    const spy = () => {
      throw new Error('denied');
    };
    const orig = { g: localStorage.getItem, s: localStorage.setItem };
    localStorage.getItem = spy as unknown as typeof localStorage.getItem;
    localStorage.setItem = spy as unknown as typeof localStorage.setItem;
    try {
      const ids = [chan('a')];
      const { result } = renderHook(() => useSeenItems(ids, null));
      expect(result.current.countNew(ids)).toBe(0);
    } finally {
      localStorage.getItem = orig.g;
      localStorage.setItem = orig.s;
    }
  });
});
