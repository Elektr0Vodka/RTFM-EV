import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useHostRepeaterArmed } from '../hooks/useHostRepeaterArmed';
import type { HostRepeaterState } from '../types';
import { emitHostRepeaterEvent } from '../utils/hostRepeaterEvents';

const armedState = { state: 'armed' } as HostRepeaterState;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useHostRepeaterArmed', () => {
  it('reads the armed state once and then follows host_repeater events', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(armedState);
    const { result } = renderHook(() => useHostRepeaterArmed());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      emitHostRepeaterEvent({
        version: 3,
        settings: armedState.settings,
        state: 'shadow',
        env_enabled: true,
        disarm_reason: 'user',
      });
    });
    expect(result.current).toBe(false);

    act(() => {
      emitHostRepeaterEvent({
        version: 3,
        settings: armedState.settings,
        state: 'armed',
        env_enabled: true,
      });
    });
    expect(result.current).toBe(true);
  });

  it('stays off when the state cannot be read', async () => {
    const get = vi.spyOn(api, 'getHostRepeater').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useHostRepeaterArmed());
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(result.current).toBe(false);
  });
});
