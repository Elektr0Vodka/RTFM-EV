import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePacketFilters } from '../hooks/usePacketFilters';
import { HOP_BYTE_WIDTH_BUCKETS, KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';

describe('usePacketFilters', () => {
  it('starts with everything enabled, ungrouped, and zero active filters', () => {
    const { result } = renderHook(() => usePacketFilters());
    expect(result.current.allTypesEnabled).toBe(true);
    expect(result.current.allHopWidthsEnabled).toBe(true);
    expect(result.current.groupByHash).toBe(false);
    expect(result.current.hexFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('toggleType removes and re-adds a single type and counts it active', () => {
    const { result } = renderHook(() => usePacketFilters());
    act(() => result.current.toggleType(KNOWN_PAYLOAD_TYPES[0]));
    expect(result.current.enabledTypes.has(KNOWN_PAYLOAD_TYPES[0])).toBe(false);
    expect(result.current.allTypesEnabled).toBe(false);
    expect(result.current.activeFilterCount).toBe(1);
    act(() => result.current.toggleType(KNOWN_PAYLOAD_TYPES[0]));
    expect(result.current.allTypesEnabled).toBe(true);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('onlyType selects exactly one type; toggleAll clears then restores', () => {
    const { result } = renderHook(() => usePacketFilters());
    act(() => result.current.onlyType(KNOWN_PAYLOAD_TYPES[1]));
    expect(result.current.enabledTypes.size).toBe(1);
    expect(result.current.enabledTypes.has(KNOWN_PAYLOAD_TYPES[1])).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.enabledTypes.size).toBe(KNOWN_PAYLOAD_TYPES.length);
  });

  it('counts hop-width, hex, and group each as one active filter', () => {
    const { result } = renderHook(() => usePacketFilters());
    act(() => result.current.toggleHopWidth(HOP_BYTE_WIDTH_BUCKETS[0]));
    act(() => result.current.setHexFilter('a1b2'));
    act(() => result.current.setGroupByHash(true));
    expect(result.current.activeFilterCount).toBe(3);
  });

  it('exposes a trimmed searchTerm and keeps search out of activeFilterCount', () => {
    const { result } = renderHook(() => usePacketFilters());
    act(() => result.current.setSearchQuery('  alice  '));
    expect(result.current.searchQuery).toBe('  alice  ');
    expect(result.current.searchTerm).toBe('alice');
    // Search has its own visible input + clear, so it is not counted here.
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('initializes groupByHash from the persisted value and adopts later changes', () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: boolean }) => usePacketFilters({ initialGroupByHash: initial }),
      { initialProps: { initial: true } }
    );
    // Starts from the persisted "on" value.
    expect(result.current.groupByHash).toBe(true);
    // Adopts a later change (e.g. app settings loading in).
    rerender({ initial: false });
    expect(result.current.groupByHash).toBe(false);
  });

  it('persists group-by-content changes via onGroupByHashChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      usePacketFilters({ initialGroupByHash: false, onGroupByHashChange: onChange })
    );
    act(() => result.current.setGroupByHash(true));
    expect(result.current.groupByHash).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
    // reset also persists the toggle back to off.
    act(() => result.current.reset());
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reset restores defaults including search', () => {
    const { result } = renderHook(() => usePacketFilters());
    act(() => result.current.onlyType(KNOWN_PAYLOAD_TYPES[0]));
    act(() => result.current.setHexFilter('ff'));
    act(() => result.current.setGroupByHash(true));
    act(() => result.current.setSearchQuery('alice'));
    act(() => result.current.reset());
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.groupByHash).toBe(false);
    expect(result.current.hexFilter).toBe('');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.searchTerm).toBe('');
  });
});
