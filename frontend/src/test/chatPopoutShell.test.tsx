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
});
