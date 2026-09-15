import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppSettings } from '../hooks/useAppSettings';
import type { AppSettings } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../api', () => ({ api: mocks.api }));
vi.mock('../components/ui/sonner', () => ({ toast: mocks.toast }));
// takePrefetchOrFetch just calls the fetcher in tests (no prefetch cache).
vi.mock('../prefetch', () => ({
  takePrefetchOrFetch: (_key: string, fetcher: () => Promise<unknown>) => fetcher(),
}));

function makeServerSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  // The hook only reads the fields below for migration + init; the rest of
  // AppSettings is not exercised by these tests.
  return {
    sidebar_section_order: [],
    sidebar_tool_order: [],
    sidebar_favorites_order: [],
    last_message_times: {},
    blocked_keys: [],
    blocked_names: [],
    known_regions: [],
    ...overrides,
  } as unknown as AppSettings;
}

describe('useAppSettings legacy sidebar-order migration', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.api.getSettings.mockReset();
    mocks.api.updateSettings.mockReset();
    mocks.api.getSettings.mockResolvedValue(makeServerSettings());
    mocks.api.updateSettings.mockResolvedValue(makeServerSettings());
  });

  it('migrates legacy localStorage sidebar orders to the server once, then clears them', async () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['favorites', 'tools', 'channels', 'contacts'])
    );
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(['map', 'my-node']));

    const { result } = renderHook(() => useAppSettings());
    await act(async () => {
      await result.current.fetchAppSettings();
    });

    await waitFor(() => expect(mocks.api.updateSettings).toHaveBeenCalledTimes(1));
    const payload = mocks.api.updateSettings.mock.calls[0][0];
    expect(payload.sidebar_section_order).toEqual(['favorites', 'tools', 'channels', 'contacts']);
    expect(payload.sidebar_tool_order?.[0]).toBe('map');

    await waitFor(() => {
      expect(localStorage.getItem('remoteterm-sidebar-section-order')).toBeNull();
      expect(localStorage.getItem('remoteterm-sidebar-tool-order')).toBeNull();
    });
  });

  it('does not PATCH when the server already has a sidebar order', async () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['tools', 'favorites'])
    );
    mocks.api.getSettings.mockResolvedValue(
      makeServerSettings({ sidebar_section_order: ['favorites', 'tools', 'channels', 'contacts'] })
    );

    const { result } = renderHook(() => useAppSettings());
    await act(async () => {
      await result.current.fetchAppSettings();
    });

    // Give the effect a tick; it should clear the stale local key but not PATCH.
    await waitFor(() =>
      expect(localStorage.getItem('remoteterm-sidebar-section-order')).toBeNull()
    );
    expect(mocks.api.updateSettings).not.toHaveBeenCalled();
  });
});
