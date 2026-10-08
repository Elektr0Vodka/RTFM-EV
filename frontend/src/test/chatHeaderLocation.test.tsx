import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChatHeader } from '../components/ChatHeader';
import type { Channel, Conversation, RadioConfig } from '../types';
import type { TeamLocationFormat } from '../utils/teamPayloads';
import { PUBLIC_CHANNEL_KEY } from '../utils/publicChannel';

// The modal pulls in a WebGL map; stub it so ChatHeader renders in jsdom.
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

type InsertLocation = (
  lat: number,
  lon: number,
  label: string,
  options?: TeamLocationFormat
) => void;

function baseProps(onInsertLocation: InsertLocation) {
  return {
    conversation,
    contacts: [],
    channels: [] as Channel[],
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

function channel(key: string, name: string, isHashtag: boolean): Channel {
  return {
    key,
    name,
    is_hashtag: isHashtag,
    on_radio: false,
    last_read_at: null,
    favorite: false,
    muted: false,
  };
}

function renderChannelHeader(
  target: Channel,
  onInsertLocation: InsertLocation = vi.fn(),
  radioConfig: RadioConfig = config
) {
  render(
    <ChatHeader
      {...baseProps(onInsertLocation)}
      conversation={{ type: 'channel', id: target.key, name: target.name }}
      channels={[target]}
      config={radioConfig}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /share location/i }));
  return onInsertLocation;
}

const privateChannel = channel('AA'.repeat(16), 'Team', false);

describe('ChatHeader location insert', () => {
  it('inserts the radio location from the pin popover', () => {
    const onInsertLocation = vi.fn<InsertLocation>();
    render(<ChatHeader {...baseProps(onInsertLocation)} />);
    fireEvent.click(screen.getByRole('button', { name: /share location/i }));
    fireEvent.click(screen.getByRole('button', { name: /my radio location/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(52.123456, 4.123456, 'MyRadio');
  });
});

describe('ChatHeader MeshCore TEAM beacon entries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a beacon with the radio location on a private channel', () => {
    const onInsertLocation = renderChannelHeader(privateChannel);
    fireEvent.click(screen.getByRole('button', { name: /beacon: my radio location/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(52.123456, 4.123456, 'MyRadio', {
      teamBeacon: true,
    });
  });

  it('inserts a beacon with the browser GPS position on a private channel', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: (position: unknown) => void) =>
          ok({ coords: { latitude: 51.5, longitude: 5.25 } }),
      },
    });
    const onInsertLocation = renderChannelHeader(privateChannel);
    fireEvent.click(screen.getByRole('button', { name: /beacon: my current gps/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(51.5, 5.25, 'MyRadio', { teamBeacon: true });
  });

  it('keeps the plain entries as markers next to the beacon entries', () => {
    const onInsertLocation = renderChannelHeader(privateChannel);
    fireEvent.click(screen.getByRole('button', { name: /^my radio location$/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(52.123456, 4.123456, 'MyRadio');
  });

  it('offers no radio beacon when the radio has no position, but still the GPS one', () => {
    renderChannelHeader(privateChannel, vi.fn(), { ...config, lat: 0, lon: 0 });
    expect(screen.queryByRole('button', { name: /beacon: my radio location/i })).toBeNull();
    expect(screen.getByRole('button', { name: /beacon: my current gps/i })).toBeInTheDocument();
  });

  it('offers no beacon on the Public channel', () => {
    renderChannelHeader(channel(PUBLIC_CHANNEL_KEY, 'Public', false));
    expect(screen.getByRole('button', { name: /^my radio location$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /beacon/i })).toBeNull();
  });

  it('offers no beacon on a hashtag channel', () => {
    renderChannelHeader(channel('BB'.repeat(16), '#test', true));
    expect(screen.queryByRole('button', { name: /beacon/i })).toBeNull();
  });

  it('offers no beacon in a direct message', () => {
    render(<ChatHeader {...baseProps(vi.fn())} />);
    fireEvent.click(screen.getByRole('button', { name: /share location/i }));
    expect(screen.queryByRole('button', { name: /beacon/i })).toBeNull();
  });
});
