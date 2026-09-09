import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useMeshcomodConfig, __resetMeshcomodConfigCache } from '../hooks/useMeshcomodConfig';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getMeshcomodConfig: vi.fn(),
    updateMeshcomodConfig: vi.fn(),
  },
}));

const cfg = (cad_enabled: boolean | null) => ({
  cad_supported: true,
  cad_enabled,
  gps_supported: false,
  gps_enabled: null,
  gps_interval: null,
});

describe('useMeshcomodConfig', () => {
  beforeEach(() => {
    __resetMeshcomodConfigCache();
    vi.clearAllMocks();
  });

  it('does not fetch when not meshcomod', () => {
    renderHook(() => useMeshcomodConfig(false));
    expect(api.getMeshcomodConfig).not.toHaveBeenCalled();
  });

  it('fetches once and shares state across consumers', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(false));
    const a = renderHook(() => useMeshcomodConfig(true));
    const b = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(a.result.current.cadSupported).toBe(true));
    expect(b.result.current.cadEnabled).toBe(false);
    expect(api.getMeshcomodConfig).toHaveBeenCalledTimes(1);
  });

  it('toggles cad (false -> true) and broadcasts the new value', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(false));
    (api.updateMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(true));
    const { result } = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(result.current.cadSupported).toBe(true));
    await act(async () => {
      await result.current.toggleCad();
    });
    expect(api.updateMeshcomodConfig).toHaveBeenCalledWith({ cad_enabled: true });
    expect(result.current.cadEnabled).toBe(true);
  });

  it('toggles unknown (null -> true)', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(null));
    (api.updateMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(true));
    const { result } = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(result.current.cadEnabled).toBe(null));
    await act(async () => {
      await result.current.toggleCad();
    });
    expect(api.updateMeshcomodConfig).toHaveBeenCalledWith({ cad_enabled: true });
  });
});
