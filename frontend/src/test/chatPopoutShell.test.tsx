import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/ConversationPane', () => ({
  ConversationPane: ({ activeConversation }: { activeConversation: { name: string } | null }) => (
    <div data-testid="conversation-pane">{activeConversation?.name ?? 'none'}</div>
  ),
}));
vi.mock('../components/SearchView', () => ({
  SearchView: () => <div data-testid="search-view" />,
}));
vi.mock('../components/NewMessageModal', () => ({ NewMessageModal: () => null }));
vi.mock('../components/BulkAddChannelResultModal', () => ({
  BulkAddChannelResultModal: () => null,
}));
vi.mock('../components/ContactInfoPane', () => ({ ContactInfoPane: () => null }));
vi.mock('../components/ChannelInfoPane', () => ({ ChannelInfoPane: () => null }));
vi.mock('../components/ui/sonner', () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ChatPopoutShell } from '../popout/ChatPopoutShell';
import { POPOUT_LIST_PREFS_KEY } from '../popout/popoutListPrefs';
import { buildMainUrl, buildPopoutUrl, MAIN_WINDOW_NAME } from '../popout/popoutMode';
import { POPOUT_LAYOUT_KEY, POPOUT_SKIN_KEY } from '../popout/popoutSkin';
import { toast } from '../components/ui/sonner';
import { CONTACT_TYPE_CLIENT, type Channel, type Contact, type Conversation } from '../types';
import { getStateKey } from '../utils/conversationState';

type ShellProps = ComponentProps<typeof ChatPopoutShell>;

const PUBLIC_KEY = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';
const channels = [
  { key: PUBLIC_KEY, name: 'Public', muted: false, favorite: false },
  { key: 'K2', name: '#nl', muted: false, favorite: false },
] as Channel[];
const alice = { public_key: 'aa'.repeat(32), name: 'Alice', type: CONTACT_TYPE_CLIENT } as Contact;
const publicConversation: Conversation = { type: 'channel', id: PUBLIC_KEY, name: 'Public' };

function buildProps(overrides: Partial<ShellProps> = {}): ShellProps {
  const activeConversation =
    overrides.sidebarProps?.activeConversation === undefined
      ? publicConversation
      : overrides.sidebarProps.activeConversation;
  return {
    mode: 'chat',
    showNewMessage: false,
    showBulkAddResults: false,
    onCloseNewMessage: vi.fn(),
    onCloseBulkAddResults: vi.fn(),
    statusProps: { health: null, config: null },
    conversationPaneProps: {
      activeConversation,
      messages: [],
      onOpenContactInfo: vi.fn(),
    } as unknown as ShellProps['conversationPaneProps'],
    searchProps: { contacts: [], channels: [], onNavigateToMessage: vi.fn() },
    newMessageModalProps: {} as ShellProps['newMessageModalProps'],
    bulkAddChannelResultModalProps: {} as ShellProps['bulkAddChannelResultModalProps'],
    contactInfoPaneProps: {} as ShellProps['contactInfoPaneProps'],
    channelInfoPaneProps: {} as ShellProps['channelInfoPaneProps'],
    ...overrides,
    sidebarProps: {
      contacts: [alice],
      channels,
      onSelectConversation: vi.fn(),
      onNewMessage: vi.fn(),
      lastMessageTimes: { [getStateKey('contact', alice.public_key)]: 10 },
      unreadCounts: { [getStateKey('channel', 'K2')]: 3 },
      mentions: {},
      onMarkAllRead: vi.fn(),
      ...overrides.sidebarProps,
      activeConversation,
    },
  };
}

describe('ChatPopoutShell', () => {
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    open = vi.spyOn(window, 'open').mockReturnValue({ focus: vi.fn() } as unknown as Window);
  });
  afterEach(() => {
    open.mockRestore();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('lists conversations with unread counts and marks the open one', () => {
    render(<ChatPopoutShell {...buildProps()} />);

    const list = screen.getByRole('navigation', { name: 'Conversations' });
    expect(within(list).getByRole('button', { name: /Public/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(within(list).getByRole('button', { name: /#nl/ })).toHaveTextContent('(3)');
    expect(within(list).getByRole('button', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.getByTestId('conversation-pane')).toHaveTextContent('Public');
  });

  it('selects a conversation from the list and filters it', async () => {
    const user = userEvent.setup();
    const props = buildProps();
    render(<ChatPopoutShell {...props} />);

    await user.click(screen.getByRole('button', { name: /#nl/ }));
    expect(props.sidebarProps.onSelectConversation).toHaveBeenCalledWith({
      type: 'channel',
      id: 'K2',
      name: '#nl',
    });

    await user.type(screen.getByRole('searchbox'), 'ali');
    const list = screen.getByRole('navigation', { name: 'Conversations' });
    expect(within(list).queryByRole('button', { name: /Public/ })).toBeNull();
    expect(within(list).getByRole('button', { name: /Alice/ })).toBeInTheDocument();
  });

  it('applies the mIRC skin by default and remembers skin and layout choices', async () => {
    const user = userEvent.setup();
    render(<ChatPopoutShell {...buildProps()} />);

    expect(document.documentElement.dataset.theme).toBe('mirc');
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'true');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Skin' }), 'mirc-dark');
    expect(document.documentElement.dataset.theme).toBe('mirc-dark');
    expect(localStorage.getItem(POPOUT_SKIN_KEY)).toBe('mirc-dark');

    await user.click(screen.getByRole('button', { name: 'Bubbles' }));
    expect(screen.getByRole('button', { name: 'Bubbles' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(POPOUT_LAYOUT_KEY)).toBe('bubbles');
  });

  it('detaches the open chat into its own window', async () => {
    const user = userEvent.setup();
    render(<ChatPopoutShell {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: 'Detach' }));
    expect(open).toHaveBeenCalledWith(
      buildPopoutUrl('single', publicConversation),
      expect.any(String),
      expect.stringContaining('popup=yes')
    );
  });

  it('says so when the browser blocks the detached window', async () => {
    const user = userEvent.setup();
    open.mockReturnValue(null);
    render(<ChatPopoutShell {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: 'Detach' }));
    expect(toast.error).toHaveBeenCalled();
  });

  it('opens the main app on the same conversation', async () => {
    const user = userEvent.setup();
    render(<ChatPopoutShell {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: 'Main app' }));
    expect(open).toHaveBeenCalledWith(
      buildMainUrl(`#channel/${PUBLIC_KEY}/Public`),
      MAIN_WINDOW_NAME
    );
  });

  it('is only the chat in a detached window', () => {
    render(<ChatPopoutShell {...buildProps({ mode: 'single' })} />);

    expect(screen.queryByRole('navigation', { name: 'Conversations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull();
    expect(screen.getByTestId('conversation-pane')).toBeInTheDocument();
  });

  it('lists recent senders and opens their contact info', async () => {
    const user = userEvent.setup();
    const props = buildProps();
    props.conversationPaneProps = {
      ...props.conversationPaneProps,
      messages: [{ type: 'CHAN', text: 'Bob: hi', outgoing: false, sender_name: null }],
    } as unknown as ShellProps['conversationPaneProps'];
    render(<ChatPopoutShell {...props} />);

    const senders = screen.getByRole('complementary', { name: 'Recent senders' });
    await user.click(within(senders).getByRole('button', { name: 'Bob' }));
    expect(props.conversationPaneProps.onOpenContactInfo).toHaveBeenCalledWith('name:Bob', true);
  });

  it('offers the main app instead of rendering a non-chat view', async () => {
    const user = userEvent.setup();
    const map: Conversation = { type: 'map', id: 'map', name: 'Node Map' };
    render(
      <ChatPopoutShell
        {...buildProps({ sidebarProps: { activeConversation: map } as ShellProps['sidebarProps'] })}
      />
    );

    expect(screen.queryByTestId('conversation-pane')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open in main app' }));
    expect(open).toHaveBeenCalledWith(buildMainUrl('#map'), MAIN_WINDOW_NAME);
  });

  it('shows search inside the popup', async () => {
    const search: Conversation = { type: 'search', id: 'search', name: 'Message Search' };
    render(
      <ChatPopoutShell
        {...buildProps({
          sidebarProps: { activeConversation: search } as ShellProps['sidebarProps'],
        })}
      />
    );
    expect(await screen.findByTestId('search-view')).toBeInTheDocument();
  });

  it('toggles search: a second click returns to the chat it was opened from', async () => {
    const user = userEvent.setup();
    const search: Conversation = { type: 'search', id: 'search', name: 'Message Search' };
    const props = buildProps();
    const { rerender } = render(<ChatPopoutShell {...props} />);

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(props.sidebarProps.onSelectConversation).toHaveBeenLastCalledWith(search);

    rerender(
      <ChatPopoutShell
        {...props}
        sidebarProps={{ ...props.sidebarProps, activeConversation: search }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(props.sidebarProps.onSelectConversation).toHaveBeenLastCalledWith(publicConversation);
  });

  describe('list controls', () => {
    const rows = (section: string) =>
      within(screen.getByRole('group', { name: section }))
        .getAllByRole('button')
        .map((row) => row.textContent);
    const savedPrefs = () => JSON.parse(localStorage.getItem(POPOUT_LIST_PREFS_KEY) ?? '{}');
    const moreChannels = [
      ...channels,
      { key: 'K3', name: '#fav', muted: false, favorite: true },
      { key: 'K4', name: '#muted', muted: true, favorite: false },
    ] as Channel[];
    const withChannels = () =>
      buildProps({ sidebarProps: { channels: moreChannels } as ShellProps['sidebarProps'] });

    it('sorts a section by the chosen order and remembers it', async () => {
      const user = userEvent.setup();
      const { unmount } = render(<ChatPopoutShell {...withChannels()} />);
      expect(rows('Channels')).toEqual(['Public', '#fav', '#nl(3)', '#muted']);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Sort Channels' }), 'unread');
      expect(rows('Channels')).toEqual(['Public', '#nl(3)', '#fav', '#muted']);
      expect(savedPrefs().sort.channels).toBe('unread');

      unmount();
      render(<ChatPopoutShell {...withChannels()} />);
      expect(screen.getByRole('combobox', { name: 'Sort Channels' })).toHaveValue('unread');
      expect(rows('Channels')).toEqual(['Public', '#nl(3)', '#fav', '#muted']);
    });

    it('folds a section, keeps its unread total in view and opens it while filtering', async () => {
      const user = userEvent.setup();
      render(<ChatPopoutShell {...withChannels()} />);

      const header = screen.getByRole('button', { name: /^Channels/ });
      expect(header).toHaveAttribute('aria-expanded', 'true');
      await user.click(header);

      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(header).toHaveTextContent('(3)');
      expect(screen.queryByRole('group', { name: 'Channels' })).toBeNull();
      expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument();
      expect(savedPrefs().collapsed.channels).toBe(true);

      await user.type(screen.getByRole('searchbox'), 'nl');
      expect(rows('Channels')).toEqual(['#nl(3)']);
    });

    it('filters the list to favorites, to unread chats and without muted channels', async () => {
      const user = userEvent.setup();
      render(<ChatPopoutShell {...withChannels()} />);

      const favorites = screen.getByRole('button', { name: 'Favorites only' });
      await user.click(favorites);
      expect(favorites).toHaveAttribute('aria-pressed', 'true');
      // Public is the open chat, so it stays listed.
      expect(rows('Channels')).toEqual(['Public', '#fav']);
      expect(screen.queryByRole('button', { name: /Alice/ })).toBeNull();
      await user.click(favorites);

      await user.click(screen.getByRole('button', { name: 'Unread only' }));
      expect(rows('Channels')).toEqual(['Public', '#nl(3)']);
      await user.click(screen.getByRole('button', { name: 'Unread only' }));

      await user.click(screen.getByRole('button', { name: 'Hide muted channels' }));
      expect(rows('Channels')).toEqual(['Public', '#fav', '#nl(3)']);
      expect(savedPrefs()).toMatchObject({
        favoritesOnly: false,
        unreadOnly: false,
        hideMuted: true,
      });
    });

    it('sorts contacts by distance from the radio and shows the distance', async () => {
      const user = userEvent.setup();
      const near = { ...alice, name: 'Near', public_key: 'bb'.repeat(32), lat: 52.1, lon: 5 };
      const far = { ...alice, name: 'Far', public_key: 'cc'.repeat(32), lat: 53, lon: 5 };
      render(
        <ChatPopoutShell
          {...buildProps({
            statusProps: {
              health: null,
              config: { name: 'Home', lat: 52, lon: 5 },
            } as ShellProps['statusProps'],
            sidebarProps: {
              contacts: [far, near].map((contact) => ({ ...contact, favorite: true })),
            } as ShellProps['sidebarProps'],
          })}
        />
      );
      expect(rows('Direct')).toEqual(['Far', 'Near']);

      const sort = screen.getByRole('combobox', { name: 'Sort Direct' });
      await user.selectOptions(sort, 'nearest');
      expect(rows('Direct')).toEqual(['Near11.1km', 'Far111.2km']);

      const channelSort = screen.getByRole('combobox', { name: 'Sort Channels' });
      expect(within(channelSort).queryByRole('option', { name: 'Nearest' })).toBeNull();
    });

    it('does not offer distance orders while the radio has no location', () => {
      render(<ChatPopoutShell {...buildProps()} />);

      const sort = screen.getByRole('combobox', { name: 'Sort Direct' });
      expect(within(sort).getByRole('option', { name: 'Nearest' })).toBeDisabled();
      expect(within(sort).getByRole('option', { name: 'Farthest' })).toBeDisabled();
      expect(within(sort).getByRole('option', { name: 'A-Z' })).toBeEnabled();
    });

    it('sorts the recent senders and folds them away', async () => {
      const user = userEvent.setup();
      const props = buildProps();
      props.conversationPaneProps = {
        ...props.conversationPaneProps,
        messages: [
          { type: 'CHAN', text: 'Zed: one', outgoing: false, sender_name: null },
          { type: 'CHAN', text: 'Bob: two', outgoing: false, sender_name: null },
          { type: 'CHAN', text: 'Zed: three', outgoing: false, sender_name: null },
        ],
      } as unknown as ShellProps['conversationPaneProps'];
      render(<ChatPopoutShell {...props} />);

      const senders = screen.getByRole('complementary', { name: 'Recent senders' });
      const senderRows = () =>
        within(senders)
          .getAllByRole('button', { name: /^(Bob|Zed)/ })
          .map((row) => row.textContent);
      expect(senderRows()).toEqual(['Bob', 'Zed']);

      await user.selectOptions(
        within(senders).getByRole('combobox', { name: 'Sort recent senders' }),
        'messages'
      );
      expect(senderRows()).toEqual(['Zed', 'Bob']);
      expect(savedPrefs().senderSort).toBe('messages');

      await user.click(within(senders).getByRole('button', { name: 'Hide recent senders' }));
      expect(within(senders).queryByRole('button', { name: /^(Bob|Zed)/ })).toBeNull();
      expect(savedPrefs().sendersCollapsed).toBe(true);

      await user.click(within(senders).getByRole('button', { name: 'Show recent senders' }));
      expect(senderRows()).toEqual(['Zed', 'Bob']);
    });
  });
});
