import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHeader } from '../components/ChatHeader';
import type { Conversation, RadioConfig } from '../types';

// The modal pulls in Leaflet; stub it so ChatHeader renders in jsdom.
vi.mock('../components/LocationPickerModal', () => ({
  LocationPickerModal: () => null,
}));

const config = {
  public_key: 'bb'.repeat(32),
  name: 'MyRadio',
  lat: 52.123456,
  lon: 4.123456,
  tx_power: 20,
  max_tx_power: 22,
  radio: { freq: 869.525, bw: 250, sf: 11, cr: 5 },
  path_hash_mode: 0,
  path_hash_mode_supported: false,
} as unknown as RadioConfig;

const conversation: Conversation = { type: 'contact', id: 'cc'.repeat(32), name: 'Bob' };

function baseProps(onInsertLocation: (lat: number, lon: number, label: string) => void) {
  return {
    conversation,
    contacts: [],
    channels: [],
    config,
    notificationsSupported: false,
    notificationsEnabled: false,
    notificationsPermission: 'default' as NotificationPermission,
    onTrace: vi.fn(),
    onPathDiscovery: vi.fn(),
    onToggleNotifications: vi.fn(),
    onToggleFavorite: vi.fn(),
    onDeleteChannel: vi.fn(),
    onDeleteContact: vi.fn(),
    onInsertLocation,
  };
}

describe('ChatHeader location insert', () => {
  it('inserts the radio location from the pin popover', () => {
    const onInsertLocation = vi.fn<(lat: number, lon: number, label: string) => void>();
    render(<ChatHeader {...baseProps(onInsertLocation)} />);
    fireEvent.click(screen.getByRole('button', { name: /share location/i }));
    fireEvent.click(screen.getByRole('button', { name: /my radio location/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(52.123456, 4.123456, 'MyRadio');
  });
});
