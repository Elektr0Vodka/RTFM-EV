import React from 'react';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: {
    getRadioConfig: vi.fn(),
    getSettings: vi.fn(),
    getUndecryptedPacketCount: vi.fn(),
    getRecentPackets: vi.fn().mockResolvedValue([]),
    getChannels: vi.fn(),
    getContacts: vi.fn(),
  },
  useWebSocket: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks.api }));
vi.mock('../useWebSocket', () => ({ useWebSocket: mocks.useWebSocket }));

vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks')>();
  return {
    ...actual,
    useConversationMessages: () => ({
      messages: [],
      messagesLoading: false,
      loadingOlder: false,
      hasOlderMessages: false,
      hasNewerMessages: false,
      loadingNewer: false,
      fetchOlderMessages: vi.fn(async () => {}),
      fetchNewerMessages: vi.fn(async () => {}),
      jumpToBottom: vi.fn(),
      reloadCurrentConversation: vi.fn(),
      observeMessage: vi.fn(() => ({ added: false, activeConversation: false })),
      receiveMessageAck: vi.fn(),
      reconcileOnReconnect: vi.fn(),
      renameConversationMessages: vi.fn(),
      removeConversationMessages: vi.fn(),
      clearConversationMessages: vi.fn(),
    }),
    useUnreadCounts: () => ({
      unreadCounts: {},
      mentions: {},
      lastMessageTimes: {},
      unreadLastReadAts: {},
      firstUnreadIds: {},
      recordMessageEvent: vi.fn(),
      renameConversationState: vi.fn(),
      markAllRead: vi.fn(),
      refreshUnreads: vi.fn(async () => {}),
    }),
  };
});

vi.mock('../components/StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));
vi.mock('../components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../components/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock('../components/MessageInput', () => ({
  MessageInput: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({ appendText: vi.fn() }));
    return <div data-testid="message-input" />;
  }),
}));
vi.mock('../components/NewMessageModal', () => ({ NewMessageModal: () => null }));
vi.mock('../components/MapView', () => ({ MapView: () => <div data-testid="map-view" /> }));
vi.mock('../components/CrackerPanel', () => ({ CrackerPanel: () => null }));
vi.mock('../components/ui/sonner', () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { App } from '../App';
import { buildMainUrl, MAIN_WINDOW_NAME } from '../popout/popoutMode';

const publicChannel = {
  key: '8B3387E9C5CDEA6AC9E5EDBAA115CD72',
  name: 'Public',
  is_hashtag: false,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

vi.setConfig({ testTimeout: 15000 });
configure({ asyncUtilTimeout: 5000 });

// replaceState, not location.hash: jsdom queues an async popstate for the latter.
function setUrl(url: string) {
  window.history.replaceState(null, '', url || window.location.pathname);
}

describe('App as chat popup', () => {
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    open = vi.spyOn(window, 'open').mockReturnValue(null);

    mocks.api.getRadioConfig.mockResolvedValue({
      public_key: 'aa'.repeat(32),
      name: 'TestNode',
      lat: 0,
      lon: 0,
      tx_power: 17,
      max_tx_power: 22,
      radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5 },
      path_hash_mode: 0,
      path_hash_mode_supported: false,
    });
    mocks.api.getSettings.mockResolvedValue({
      max_radio_contacts: 200,
      auto_decrypt_dm_on_advert: false,
      last_message_times: {},
      advert_interval: 0,
      last_advert_time: 0,
    });
    mocks.api.getUndecryptedPacketCount.mockResolvedValue({ count: 0 });
    mocks.api.getChannels.mockResolvedValue([publicChannel]);
    mocks.api.getContacts.mockResolvedValue([]);
  });

  afterEach(() => {
    open.mockRestore();
    setUrl('');
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('renders the chat-only shell on the chat stream, without the packet seed', async () => {
    setUrl(`?popout=chat#channel/${publicChannel.key}/Public`);

    render(<App />);

    const list = await screen.findByRole('navigation', { name: 'Conversations' });
    await waitFor(() =>
      expect(within(list).getByRole('button', { name: /Public/ })).toHaveAttribute(
        'aria-current',
        'true'
      )
    );
    expect(await screen.findByTestId('message-list')).toBeInTheDocument();
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(mocks.api.getRecentPackets).not.toHaveBeenCalled();
    expect(mocks.useWebSocket).toHaveBeenLastCalledWith(expect.anything(), 'chat');
  });

  it('hands a non-chat view to the main app instead of rendering it', async () => {
    const user = userEvent.setup();
    setUrl('?popout=chat#map');

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Open in main app' }));
    expect(open).toHaveBeenCalledWith(buildMainUrl('#map'), MAIN_WINDOW_NAME);
    expect(screen.queryByTestId('map-view')).toBeNull();
  });

  it('keeps the full app, packet seed and full stream without the popup query', async () => {
    setUrl('');

    render(<App />);

    expect(await screen.findByTestId('status-bar')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Conversations' })).toBeNull();
    await waitFor(() => expect(mocks.api.getRecentPackets).toHaveBeenCalled());
    expect(mocks.useWebSocket).toHaveBeenLastCalledWith(expect.anything(), undefined);
  });
});
