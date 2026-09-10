import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LocationPickerModal } from '../components/LocationPickerModal';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn() }),
  useMapEvents: () => null,
}));

describe('LocationPickerModal', () => {
  it('confirms with the initial center and a typed label', () => {
    const onConfirm = vi.fn();
    render(
      <LocationPickerModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        contacts={[]}
        initialCenter={[52.123456, 4.123456]}
        initialLabel=""
      />
    );
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Meetup' } });
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    expect(onConfirm).toHaveBeenCalledWith(52.123456, 4.123456, 'Meetup');
  });
});
