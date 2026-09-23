import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('../mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../../map/engine/webgl', () => ({ isWebglAvailable: vi.fn(() => true) }));

import * as maplibre from 'maplibre-gl';
import { isWebglAvailable } from '../../map/engine/webgl';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MapSurface } from '../../map/MapSurface';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapMock = maplibre.Map as unknown as ReturnType<typeof vi.fn>;
const webglProbe = isWebglAvailable as unknown as ReturnType<typeof vi.fn>;
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  remove: ReturnType<typeof vi.fn>;
};

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
      </I18nProvider>
    );
    expect(mapMock).toHaveBeenCalledTimes(1);
    stub.fire('load');
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(stub));
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(
      <I18nProvider>
        <MapSurface fabs={{ layers: true }} />
      </I18nProvider>
    );
    unmount();
    expect(stub.remove).toHaveBeenCalled();
  });

  // Each probe creates a WebGL context. Probing on every render (the live packet
  // overlay re-renders several times a second) exhausted Chrome's context limit,
  // which force-loses the oldest context: the map's (black map for seconds).
  it('probes WebGL once per mount, not on every re-render', () => {
    const { rerender } = render(
      <I18nProvider>
        <MapSurface fabs={{ layers: true }} nodeScale={1} />
      </I18nProvider>
    );
    for (let i = 2; i <= 5; i++) {
      rerender(
        <I18nProvider>
          <MapSurface fabs={{ layers: true }} nodeScale={i} />
        </I18nProvider>
      );
    }
    expect(webglProbe).toHaveBeenCalledTimes(1);
  });

  it('hides the fullscreen FAB when the Fullscreen API is unavailable', () => {
    render(
      <I18nProvider>
        <MapSurface fabs={{ fullscreen: true }} />
      </I18nProvider>
    );
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();
  });

  it('puts the map surface into fullscreen and back via the FAB', async () => {
    const doc = document as any;
    const originalEnabled = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
    let current: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => current,
    });
    const setCurrent = (el: Element | null) => {
      current = el;
    };
    const request = vi.fn(function (this: Element) {
      setCurrent(this);
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      current = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    (HTMLElement.prototype as any).requestFullscreen = request;
    doc.exitFullscreen = exit;
    try {
      render(
        <I18nProvider>
          <MapSurface fabs={{ fullscreen: true }} />
        </I18nProvider>
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
      });
      expect(request).toHaveBeenCalledTimes(1);
      const exitBtn = await screen.findByRole('button', { name: 'Exit fullscreen' });
      expect(exitBtn).toHaveAttribute('aria-pressed', 'true');
      await act(async () => {
        fireEvent.click(exitBtn);
      });
      expect(exit).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
    } finally {
      delete (HTMLElement.prototype as any).requestFullscreen;
      delete doc.exitFullscreen;
      delete doc.fullscreenElement;
      if (originalEnabled) Object.defineProperty(document, 'fullscreenEnabled', originalEnabled);
      else delete doc.fullscreenEnabled;
    }
  });
});
