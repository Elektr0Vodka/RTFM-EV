import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MOBILE_QUERY, COMPACT_MAP_QUERY, useIsCompactMap } from '../../map/controls/breakpoints';

describe('breakpoint constants', () => {
  it('match the EU analyzer vocabulary', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 768px)');
    expect(COMPACT_MAP_QUERY).toBe('(max-width: 1024px), (pointer: coarse)');
  });
});

describe('useIsCompactMap', () => {
  it('reads matchMedia for the compact query', () => {
    const mm = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('matchMedia', mm);
    const { result } = renderHook(() => useIsCompactMap());
    expect(mm).toHaveBeenCalledWith(COMPACT_MAP_QUERY);
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });
});
