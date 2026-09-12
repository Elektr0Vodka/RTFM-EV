import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { I18nProvider } from '../i18n/I18nProvider';
import { LocationPickerModal } from '../components/LocationPickerModal';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as { fire: (ev: string, e?: unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('remoteterm-map-layer', 'light');
});

function renderModal(onConfirm = vi.fn()) {
  render(
    <I18nProvider>
      <LocationPickerModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        contacts={[]}
        initialCenter={[52.123456, 4.123456]}
        initialLabel=""
      />
    </I18nProvider>
  );
  return onConfirm;
}

describe('LocationPickerModal', () => {
  it('confirms with the initial center and a typed label', () => {
    const onConfirm = renderModal();
    stub.fire('load');
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Meetup' } });
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    expect(onConfirm).toHaveBeenCalledWith(52.123456, 4.123456, 'Meetup');
  });

  it('picks the clicked map point and confirms it', () => {
    const onConfirm = renderModal();
    act(() => stub.fire('load'));
    // Fire the map click handler with a lngLat; no node under the point.
    act(() => stub.fire('click', { point: { x: 10, y: 10 }, lngLat: { lat: 51.5, lng: 5.25 } }));
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    expect(onConfirm).toHaveBeenCalledWith(51.5, 5.25, '');
  });
});
