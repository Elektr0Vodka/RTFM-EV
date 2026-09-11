import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('../mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MapSurface } from '../../map/MapSurface';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapMock = maplibre.Map as unknown as ReturnType<typeof vi.fn>;
const stub = (maplibre as any).__stub as { fire: (ev: string) => void; remove: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  // Use a raster basemap so mount builds a synchronous style and never fetches.
  localStorage.setItem('remoteterm-map-layer', 'light');
});

describe('MapSurface', () => {
  it('creates a MapLibre map on mount and calls onReady after load', async () => {
    const onReady = vi.fn();
    render(
      <I18nProvider>
        <MapSurface fabs={{ layers: true }} onReady={onReady} />
      </I18nProvider>,
    );
    expect(mapMock).toHaveBeenCalledTimes(1);
    stub.fire('load');
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(stub));
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(
      <I18nProvider>
        <MapSurface fabs={{ layers: true }} />
      </I18nProvider>,
    );
    unmount();
    expect(stub.remove).toHaveBeenCalled();
  });
});
