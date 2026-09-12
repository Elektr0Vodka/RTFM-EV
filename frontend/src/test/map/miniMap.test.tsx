import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('../mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MiniMap } from '../../map/MiniMap';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapMock = maplibre.Map as unknown as ReturnType<typeof vi.fn>;
const stub = (maplibre as any).__stub as { fire: (ev: string) => void; fitBounds: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  // Raster basemap so mount builds a synchronous style and never fetches.
  localStorage.setItem('remoteterm-map-layer', 'light');
});

describe('MiniMap', () => {
  it('creates a map and enables the Layers FAB by default', () => {
    render(
      <I18nProvider>
        <MiniMap center={[5, 52]} zoom={12} />
      </I18nProvider>,
    );
    expect(mapMock).toHaveBeenCalledTimes(1);
  });

  it('fits bounds to multiple provided points on ready', () => {
    render(
      <I18nProvider>
        <MiniMap
          fitPoints={[
            [5, 52],
            [6, 53],
          ]}
        />
      </I18nProvider>,
    );
    stub.fire('load');
    expect(stub.fitBounds).toHaveBeenCalledWith(
      [
        [5, 52],
        [6, 53],
      ],
      expect.objectContaining({ maxZoom: 13, duration: 0 }),
    );
  });
});
