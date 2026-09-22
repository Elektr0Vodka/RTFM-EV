import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { SettingsMapSection } from '../components/settings/SettingsMapSection';
import type { AppSettings } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as { fire: (ev: string, e?: unknown) => void };

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    map_home_mode: 'auto',
    map_home_lat: null,
    map_home_lon: null,
    map_home_zoom: null,
    ...overrides,
  } as AppSettings;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Use a keyless raster basemap so MapSurface's load handler skips the
  // vector-recolor applyBasemap path (matches other map component tests).
  localStorage.setItem('remoteterm-map-layer', 'light');
});

describe('SettingsMapSection', () => {
  it('hides the location picker in auto mode', () => {
    render(<SettingsMapSection appSettings={settings()} onSaveAppSettings={vi.fn()} />);
    expect(screen.queryByLabelText(/latitude/i)).not.toBeInTheDocument();
  });

  it('saves the mode when the dropdown changes', () => {
    const onSave = vi.fn();
    render(<SettingsMapSection appSettings={settings()} onSaveAppSettings={onSave} />);
    fireEvent.change(screen.getByLabelText(/when the map opens/i), {
      target: { value: 'home' },
    });
    expect(onSave).toHaveBeenCalledWith({ map_home_mode: 'home' });
  });

  it('shows the picker and lat/lon/zoom inputs in home mode', () => {
    render(
      <SettingsMapSection
        appSettings={settings({ map_home_mode: 'home' })}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/latitude/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/longitude/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/zoom/i)).toBeInTheDocument();
  });

  it('disables save until valid coordinates are entered', () => {
    render(
      <SettingsMapSection
        appSettings={settings({ map_home_mode: 'home' })}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /save home location/i })).toBeDisabled();
  });

  it('saves the home camera from typed lat/lon/zoom', () => {
    const onSave = vi.fn();
    render(
      <SettingsMapSection
        appSettings={settings({ map_home_mode: 'home', map_home_zoom: 11 })}
        onSaveAppSettings={onSave}
      />
    );
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: '52.3' } });
    fireEvent.change(screen.getByLabelText(/longitude/i), { target: { value: '5.5' } });
    fireEvent.change(screen.getByLabelText(/zoom/i), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: /save home location/i }));
    expect(onSave).toHaveBeenCalledWith({
      map_home_mode: 'home',
      map_home_lat: 52.3,
      map_home_lon: 5.5,
      map_home_zoom: 13,
    });
  });

  it('sets coordinates when the picker map is clicked', () => {
    render(
      <SettingsMapSection
        appSettings={settings({ map_home_mode: 'home' })}
        onSaveAppSettings={vi.fn()}
      />
    );
    // MapSurface wires its load handler, which invokes our onReady.
    act(() => stub.fire('load'));
    act(() => stub.fire('click', { lngLat: { lng: 4.9, lat: 51.2 } }));
    expect((screen.getByLabelText(/latitude/i) as HTMLInputElement).value).toBe('51.2');
    expect((screen.getByLabelText(/longitude/i) as HTMLInputElement).value).toBe('4.9');
  });
});
