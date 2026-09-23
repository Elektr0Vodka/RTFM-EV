import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';
import { useAppSettings } from '../hooks/useAppSettings';
import type { AppSettings } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(),
    toggleTrackedTelemetry: vi.fn(),
    toggleTrackedTelemetryContact: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ApiError: actual.ApiError, api: mocks.api };
});
vi.mock('../components/ui/sonner', () => ({ toast: mocks.toast }));

function makeSettings(): AppSettings {
  return {
    tracked_telemetry_repeaters: [],
    tracked_telemetry_contacts: [],
  } as unknown as AppSettings;
}

describe('useAppSettings tracked telemetry toggle errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.getSettings.mockResolvedValue(makeSettings());
  });

  it('shows the server error text for a contact toggle failure', async () => {
    mocks.api.toggleTrackedTelemetryContact.mockRejectedValue(
      new ApiError('Contact not found', 404)
    );
    const { result } = renderHook(() => useAppSettings());

    await act(async () => {
      await result.current.handleToggleTrackedTelemetryContact('AA'.repeat(32));
    });

    expect(mocks.toast.error).toHaveBeenCalledWith('Contact not found');
  });

  it('shows the server error text for a repeater toggle failure', async () => {
    mocks.api.toggleTrackedTelemetry.mockRejectedValue(
      new ApiError('Limit of 8 tracked repeaters reached', 409)
    );
    const { result } = renderHook(() => useAppSettings());

    await act(async () => {
      await result.current.handleToggleTrackedTelemetry('bb'.repeat(32));
    });

    expect(mocks.toast.error).toHaveBeenCalledWith('Limit of 8 tracked repeaters reached');
  });

  it('falls back to the generic message on a network failure', async () => {
    mocks.api.toggleTrackedTelemetryContact.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAppSettings());

    await act(async () => {
      await result.current.handleToggleTrackedTelemetryContact('cc'.repeat(32));
    });

    expect(mocks.toast.error).toHaveBeenCalledWith('Failed to update tracked contact telemetry');
  });
});
