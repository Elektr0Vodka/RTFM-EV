import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { useUpdateStatus, __resetUpdateStatusCache } from '../hooks/useUpdateStatus';

const sample = {
  check_enabled: true,
  update_available: true,
  current_commit: 'dc11fbe0',
  latest_commit: 'a1b2c3d4',
  commits_behind: 7,
  compare_url: 'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main',
  checked_at: 1757600000,
};

afterEach(() => {
  __resetUpdateStatusCache();
  vi.restoreAllMocks();
});

describe('useUpdateStatus', () => {
  it('fetches once and shares the result across hook instances', async () => {
    const spy = vi.spyOn(api, 'getUpdateStatus').mockResolvedValue(sample);

    const first = renderHook(() => useUpdateStatus());
    const second = renderHook(() => useUpdateStatus());

    await waitFor(() => expect(first.result.current?.update_available).toBe(true));
    await waitFor(() => expect(second.result.current?.commits_behind).toBe(7));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns null when the request fails', async () => {
    vi.spyOn(api, 'getUpdateStatus').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toBeNull());
  });
});
