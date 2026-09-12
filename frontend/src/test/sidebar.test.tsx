import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../components/Sidebar';
import {
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Channel,
  type Contact,
} from '../types';
import { getStateKey, type ConversationTimes } from '../utils/conversationState';
import { PUBLIC_CHANNEL_KEY } from '../utils/publicChannel';

function makeChannel(key: string, name: string): Channel {
  return {
    key,
    name,
    is_hashtag: false,
    on_radio: false,
    last_read_at: null,
    favorite: false,
    muted: false,
  };
}

function makeContact(
  public_key: string,
  name: string,
  type = 1,
  overrides: Partial<Contact> = {}
): Contact {
  return {
    public_key,
    name,
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

function renderSidebar(overrides?: {
  unreadCounts?: Record<string, number>;
  mentions?: Record<string, boolean>;
  lastMessageTimes?: ConversationTimes;
  channels?: Channel[];
  isConversationNotificationsEnabled?: (type: 'channel' | 'contact', id: string) => boolean;
  onMarkSectionRead?: (items: { type: 'channel' | 'contact'; id: string }[]) => void;
}) {
  const aliceName = 'Alice';
  const roomName = 'Ops Board';
  const publicChannel = makeChannel('AA'.repeat(16), 'Public');
  const flightChannel = { ...makeChannel('BB'.repeat(16), '#flight'), favorite: true };
  const opsChannel = makeChannel('CC'.repeat(16), '#ops');
  const alice = makeContact('11'.repeat(32), aliceName);
  const board = makeContact('33'.repeat(32), roomName, CONTACT_TYPE_ROOM);
  const relay = makeContact('22'.repeat(32), 'Relay', CONTACT_TYPE_REPEATER);

  const unreadCounts = overrides?.unreadCounts ?? {
    [getStateKey('channel', flightChannel.key)]: 2,
    [getStateKey('channel', opsChannel.key)]: 1,
    [getStateKey('contact', alice.public_key)]: 3,
    [getStateKey('contact', board.public_key)]: 5,
    [getStateKey('contact', relay.public_key)]: 4,
  };

  const channels = overrides?.channels ?? [publicChannel, flightChannel, opsChannel];
  const onSelectConversation = vi.fn();
  const onMarkSectionRead = overrides?.onMarkSectionRead ?? vi.fn();

  const view = render(
    <Sidebar
      contacts={[alice, board, relay]}
      channels={channels}
      activeConversation={null}
      onSelectConversation={onSelectConversation}
      onNewMessage={vi.fn()}
      lastMessageTimes={overrides?.lastMessageTimes ?? {}}
      unreadCounts={unreadCounts}
      mentions={overrides?.mentions ?? {}}
      showCracker={false}
      crackerRunning={false}
      onToggleCracker={vi.fn()}
      onMarkAllRead={vi.fn()}
      onMarkSectionRead={onMarkSectionRead}
      isConversationNotificationsEnabled={overrides?.isConversationNotificationsEnabled}
    />
  );

  return {
    ...view,
    flightChannel,
    opsChannel,
    aliceName,
    roomName,
    onSelectConversation,
    onMarkSectionRead,
  };
}

function getSectionHeaderContainer(title: string): HTMLElement {
  const btn = screen.getByRole('button', { name: title });
  const container = btn.closest('div');
  if (!container) throw new Error(`Missing header container for section ${title}`);
  return container;
}

describe('Sidebar section summaries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows muted section unread totals in each visible section header', () => {
    renderSidebar();

    expect(
      within(getSectionHeaderContainer('Favorites')).getByLabelText('2 unread')
    ).toBeInTheDocument();
    expect(
      within(getSectionHeaderContainer('Channels')).getByLabelText('1 unread')
    ).toBeInTheDocument();
    // Contacts is now one merged section; its header shows the aggregate unread
    // across Companions + Sensors + Repeaters + Rooms (3 + 4 + 5 = 12).
    expect(
      within(getSectionHeaderContainer('Contacts')).getByLabelText('12 unread')
    ).toBeInTheDocument();
    // Per-type unread surfaces as pill dots, not separate section headers.
    const filter = screen.getByRole('radiogroup', { name: 'Filter contacts by type' });
    expect(within(filter).getByRole('radio', { name: /Repeaters/ })).toBeInTheDocument();
    expect(within(filter).getByRole('radio', { name: /Room/ })).toBeInTheDocument();
  });

  it('shows a green new pill and a per-row new dot for newly discovered items', () => {
    // Baseline seen-set that excludes Alice, so Contacts shows 1 new + a row dot.
    const everythingElse = [
      getStateKey('channel', 'AA'.repeat(16)),
      getStateKey('channel', 'BB'.repeat(16)),
      getStateKey('channel', 'CC'.repeat(16)),
      getStateKey('contact', '33'.repeat(32)), // room
      getStateKey('contact', '22'.repeat(32)), // repeater
    ];
    localStorage.setItem('remoteterm-sidebar-seen-items', JSON.stringify(everythingElse));
    renderSidebar();

    expect(
      within(getSectionHeaderContainer('Contacts')).getByLabelText('1 new')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New')).toBeInTheDocument();
  });

  it('per-section clear button marks that section read and seen', () => {
    const alicePk = '11'.repeat(32);
    localStorage.setItem(
      'remoteterm-sidebar-seen-items',
      JSON.stringify([
        getStateKey('channel', 'AA'.repeat(16)),
        getStateKey('channel', 'BB'.repeat(16)),
        getStateKey('channel', 'CC'.repeat(16)),
        getStateKey('contact', '33'.repeat(32)),
        getStateKey('contact', '22'.repeat(32)),
      ])
    );
    const { onMarkSectionRead } = renderSidebar({ onMarkSectionRead: vi.fn() });

    const header = getSectionHeaderContainer('Contacts');
    const clearBtn = within(header).getByRole('button', {
      name: 'Mark section read and seen',
    });
    fireEvent.click(clearBtn);
    // With the All pill active, clearing marks every unread contact across types
    // (companions, then repeaters, then rooms) read.
    expect(onMarkSectionRead).toHaveBeenCalledWith([
      { type: 'contact', id: alicePk },
      { type: 'contact', id: '22'.repeat(32) },
      { type: 'contact', id: '33'.repeat(32) },
    ]);
  });

  it('shows a total-item counter in each section header', () => {
    renderSidebar();

    expect(
      within(getSectionHeaderContainer('Channels')).getByLabelText('2 total')
    ).toBeInTheDocument();
    // Merged Contacts total spans all types: Alice + Relay + Ops Board = 3.
    expect(
      within(getSectionHeaderContainer('Contacts')).getByLabelText('3 total')
    ).toBeInTheDocument();
  });

  it('renders a full add channel/contact button above search and calls onNewMessage', () => {
    const onNewMessage = vi.fn();

    render(
      <Sidebar
        contacts={[]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public')]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={onNewMessage}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: 'Add channel or contact' });
    const search = screen.getByLabelText('Search conversations');
    const nav = screen.getByRole('navigation', { name: 'Conversations' });
    const toolsButton = screen.getByRole('button', { name: 'Tools' });

    expect(addButton).toHaveTextContent('Add Channel/Contact');
    expect(
      addButton.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(nav.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(
      search.compareDocumentPosition(toolsButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(addButton);
    expect(onNewMessage).toHaveBeenCalledTimes(1);
  });

  it('turns favorites and channels rollups red when they contain a mention', () => {
    renderSidebar({
      mentions: {
        [getStateKey('channel', 'BB'.repeat(16))]: true,
        [getStateKey('channel', 'CC'.repeat(16))]: true,
      },
    });

    expect(within(getSectionHeaderContainer('Favorites')).getByText('2')).toHaveClass(
      'bg-badge-mention',
      'text-badge-mention-foreground'
    );
    expect(within(getSectionHeaderContainer('Channels')).getByText('1')).toHaveClass(
      'bg-badge-mention',
      'text-badge-mention-foreground'
    );
  });

  it('turns a mentioned contact row red and reddens the contacts rollup', () => {
    const { aliceName } = renderSidebar({
      mentions: { [getStateKey('contact', '11'.repeat(32))]: true },
    });

    // The aggregate unread badge (12) reddens because a contact has a mention.
    expect(within(getSectionHeaderContainer('Contacts')).getByText('12')).toHaveClass(
      'bg-badge-mention',
      'text-badge-mention-foreground'
    );

    const aliceRow = screen.getByText(aliceName).closest('div');
    if (!aliceRow) throw new Error('Missing Alice row');
    expect(within(aliceRow).getByText('3')).toHaveClass(
      'bg-badge-mention',
      'text-badge-mention-foreground'
    );
  });

  it('turns favorite contact row badges red', () => {
    const alice = makeContact('11'.repeat(32), 'Alice', 1, { favorite: true });

    render(
      <Sidebar
        contacts={[alice]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public')]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{ [getStateKey('contact', alice.public_key)]: 3 }}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const aliceRow = screen.getByText('Alice').closest('div');
    if (!aliceRow) throw new Error('Missing Alice row');
    expect(within(aliceRow).getByText('3')).toHaveClass(
      'bg-badge-mention',
      'text-badge-mention-foreground'
    );
  });

  it('keeps repeater row badges neutral', () => {
    renderSidebar();

    const relayRow = screen.getByText('Relay').closest('div');
    if (!relayRow) throw new Error('Missing Relay row');
    expect(within(relayRow).getByText('4')).toHaveClass(
      'bg-badge-unread/90',
      'text-badge-unread-foreground'
    );
  });

  it('renders room servers under the Contacts section via a Room pill', () => {
    const { roomName } = renderSidebar();

    const filter = screen.getByRole('radiogroup', { name: 'Filter contacts by type' });
    expect(within(filter).getByRole('radio', { name: /Room/ })).toBeInTheDocument();
    expect(screen.getByText(roomName)).toBeInTheDocument();
  });

  it('expands collapsed sections during search and restores collapse state after clearing search', async () => {
    const { opsChannel, aliceName, roomName } = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));

    expect(screen.queryByText('Packet Feed')).not.toBeInTheDocument();
    expect(screen.queryByText(opsChannel.name)).not.toBeInTheDocument();
    expect(screen.queryByText(aliceName)).not.toBeInTheDocument();
    // Collapsing the merged Contacts section hides room servers too.
    expect(screen.queryByText(roomName)).not.toBeInTheDocument();

    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'alice' } });

    await waitFor(() => {
      expect(screen.getByText(aliceName)).toBeInTheDocument();
    });

    fireEvent.change(search, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.queryByText('Packet Feed')).not.toBeInTheDocument();
      expect(screen.queryByText(opsChannel.name)).not.toBeInTheDocument();
      expect(screen.queryByText(aliceName)).not.toBeInTheDocument();
      expect(screen.queryByText(roomName)).not.toBeInTheDocument();
    });
  });

  it('persists collapsed section state across unmount and remount', () => {
    const { opsChannel, aliceName, roomName, unmount } = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));

    expect(screen.queryByText('Packet Feed')).not.toBeInTheDocument();
    expect(screen.queryByText(opsChannel.name)).not.toBeInTheDocument();
    expect(screen.queryByText(aliceName)).not.toBeInTheDocument();
    expect(screen.queryByText(roomName)).not.toBeInTheDocument();

    unmount();
    renderSidebar();

    expect(screen.queryByText('Packet Feed')).not.toBeInTheDocument();
    expect(screen.queryByText(opsChannel.name)).not.toBeInTheDocument();
    expect(screen.queryByText(aliceName)).not.toBeInTheDocument();
    expect(screen.queryByText(roomName)).not.toBeInTheDocument();
  });

  it('renders same-name channels when keys differ and allows selecting both', () => {
    const publicChannel = makeChannel('AA'.repeat(16), 'Public');
    const channelA = makeChannel('DD'.repeat(16), '#shared');
    const channelB = makeChannel('EE'.repeat(16), '#shared');
    const onSelectConversation = vi.fn();

    render(
      <Sidebar
        contacts={[]}
        channels={[publicChannel, channelA, channelB]}
        activeConversation={null}
        onSelectConversation={onSelectConversation}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const sharedRows = screen.getAllByText('#shared');
    expect(sharedRows).toHaveLength(2);

    fireEvent.click(sharedRows[0]);
    fireEvent.click(sharedRows[1]);

    const selectedIds = onSelectConversation.mock.calls.map(([conv]) => conv.id);
    expect(new Set(selectedIds)).toEqual(new Set([channelA.key, channelB.key]));
  });

  it('shows a notification bell for conversations with notifications enabled', () => {
    const { aliceName } = renderSidebar({
      unreadCounts: {},
      isConversationNotificationsEnabled: (type, id) =>
        (type === 'contact' && id === '11'.repeat(32)) ||
        (type === 'channel' && id === 'BB'.repeat(16)),
    });

    const aliceRow = screen.getByText(aliceName).closest('div');
    const flightRow = screen.getByText('#flight').closest('div');
    if (!aliceRow || !flightRow) throw new Error('Missing sidebar rows');

    expect(within(aliceRow).getByLabelText('Notifications enabled')).toBeInTheDocument();
    expect(within(flightRow).getByLabelText('Notifications enabled')).toBeInTheDocument();
  });

  it('keeps the notification bell to the left of the unread pill when both are present', () => {
    const { aliceName } = renderSidebar({
      unreadCounts: {
        [getStateKey('contact', '11'.repeat(32))]: 3,
      },
      isConversationNotificationsEnabled: (type, id) =>
        type === 'contact' && id === '11'.repeat(32),
    });

    const aliceRow = screen.getByText(aliceName).closest('div');
    if (!aliceRow) throw new Error('Missing Alice row');

    const bell = within(aliceRow).getByLabelText('Notifications enabled');
    const unread = within(aliceRow).getByText('3');
    expect(bell.compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the trace tool row and selects it', () => {
    const { onSelectConversation } = renderSidebar();

    fireEvent.click(screen.getByText('Trace'));

    expect(onSelectConversation).toHaveBeenCalledWith({
      type: 'trace',
      id: 'trace',
      name: 'Trace',
    });
  });

  it('sorts each section independently and persists per-section sort preferences', () => {
    const publicChannel = makeChannel('AA'.repeat(16), 'Public');
    const zebraChannel = makeChannel('BB'.repeat(16), '#zebra');
    const alphaChannel = makeChannel('CC'.repeat(16), '#alpha');
    const zed = makeContact('11'.repeat(32), 'Zed', 1, { last_advert: 150 });
    const amy = makeContact('22'.repeat(32), 'Amy');
    const zebraRoom = makeContact('55'.repeat(32), 'Zebra Room', CONTACT_TYPE_ROOM, {
      last_seen: 100,
    });
    const alphaRoom = makeContact('66'.repeat(32), 'Alpha Room', CONTACT_TYPE_ROOM, {
      last_advert: 300,
    });
    const relayZulu = makeContact('33'.repeat(32), 'Zulu Relay', CONTACT_TYPE_REPEATER, {
      last_seen: 100,
    });
    const relayAlpha = makeContact('44'.repeat(32), 'Alpha Relay', CONTACT_TYPE_REPEATER, {
      last_seen: 300,
    });

    const props = {
      contacts: [zed, amy, zebraRoom, alphaRoom, relayZulu, relayAlpha],
      channels: [publicChannel, zebraChannel, alphaChannel],
      activeConversation: null,
      onSelectConversation: vi.fn(),
      onNewMessage: vi.fn(),
      lastMessageTimes: {
        [getStateKey('channel', zebraChannel.key)]: 300,
        [getStateKey('channel', alphaChannel.key)]: 100,
        [getStateKey('contact', zed.public_key)]: 200,
        [getStateKey('contact', zebraRoom.public_key)]: 350,
      },
      unreadCounts: {},
      mentions: {},
      showCracker: false,
      crackerRunning: false,
      onToggleCracker: vi.fn(),
      onMarkAllRead: vi.fn(),
    };

    const getChannelsOrder = () => screen.getAllByText(/^#/).map((node) => node.textContent);
    const getContactsOrder = () =>
      screen
        .getAllByText(/^(Amy|Zed)$/)
        .map((node) => node.textContent)
        .filter((text): text is string => Boolean(text));
    const getRepeatersOrder = () =>
      screen
        .getAllByText(/Relay$/)
        .map((node) => node.textContent)
        .filter((text): text is string => Boolean(text));
    const getRoomsOrder = () =>
      screen
        .getAllByText(/Room$/)
        .map((node) => node.textContent)
        .filter((text): text is string => Boolean(text));

    const { unmount } = render(<Sidebar {...props} />);

    expect(getChannelsOrder()).toEqual(['#zebra', '#alpha']);
    expect(getContactsOrder()).toEqual(['Zed', 'Amy']);
    expect(getRoomsOrder()).toEqual(['Zebra Room', 'Alpha Room']);
    expect(getRepeatersOrder()).toEqual(['Alpha Relay', 'Zulu Relay']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort Channels alphabetically' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort Contacts alphabetically' }));

    expect(getChannelsOrder()).toEqual(['#alpha', '#zebra']);
    expect(getContactsOrder()).toEqual(['Amy', 'Zed']);
    // Rooms and repeaters no longer have their own sort toggle; they keep their
    // recency order regardless of the Contacts toggle.
    expect(getRoomsOrder()).toEqual(['Zebra Room', 'Alpha Room']);
    expect(getRepeatersOrder()).toEqual(['Alpha Relay', 'Zulu Relay']);

    unmount();
    render(<Sidebar {...props} />);

    expect(getChannelsOrder()).toEqual(['#alpha', '#zebra']);
    expect(getContactsOrder()).toEqual(['Amy', 'Zed']);
    expect(getRoomsOrder()).toEqual(['Zebra Room', 'Alpha Room']);
    expect(getRepeatersOrder()).toEqual(['Alpha Relay', 'Zulu Relay']);
  });

  it('sorts room servers like contacts by DM recency first, then advert recency', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const dmRecentRoom = makeContact('77'.repeat(32), 'DM Recent Room', CONTACT_TYPE_ROOM, {
      last_advert: 100,
    });
    const advertOnlyRoom = makeContact('88'.repeat(32), 'Advert Only Room', CONTACT_TYPE_ROOM, {
      last_seen: 300,
    });
    const noRecencyRoom = makeContact('99'.repeat(32), 'No Recency Room', CONTACT_TYPE_ROOM);

    render(
      <Sidebar
        contacts={[noRecencyRoom, advertOnlyRoom, dmRecentRoom]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{
          [getStateKey('contact', dmRecentRoom.public_key)]: 400,
        }}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const roomRows = screen
      .getAllByText(/Room$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    expect(roomRows).toEqual(['DM Recent Room', 'Advert Only Room', 'No Recency Room']);
  });

  it('sorts contacts by DM recency first, then advert recency, then no-recency at the bottom', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const dmRecent = makeContact('11'.repeat(32), 'DM Recent', 1, { last_advert: 100 });
    const advertOnly = makeContact('22'.repeat(32), 'Advert Only', 1, { last_seen: 300 });
    const noRecency = makeContact('33'.repeat(32), 'No Recency');

    render(
      <Sidebar
        contacts={[noRecency, advertOnly, dmRecent]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{
          [getStateKey('contact', dmRecent.public_key)]: 400,
        }}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const contactRows = screen
      .getAllByText(/^(DM Recent|Advert Only|No Recency)$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    expect(contactRows).toEqual(['DM Recent', 'Advert Only', 'No Recency']);
  });

  it('floats contacts with unread DMs above read contacts regardless of recency', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const readRecent = makeContact('11'.repeat(32), 'Read Recent', 1, { last_advert: 500 });
    const unreadOld = makeContact('22'.repeat(32), 'Unread Old', 1, { last_advert: 100 });

    render(
      <Sidebar
        contacts={[readRecent, unreadOld]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{
          [getStateKey('contact', readRecent.public_key)]: 500,
          [getStateKey('contact', unreadOld.public_key)]: 200,
        }}
        unreadCounts={{
          [getStateKey('contact', unreadOld.public_key)]: 3,
        }}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const contactRows = screen
      .getAllByText(/^(Read Recent|Unread Old)$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    // Unread Old has unread DMs so it floats above Read Recent despite older recency
    expect(contactRows).toEqual(['Unread Old', 'Read Recent']);
  });

  it('sorts repeaters by heard recency even when message times disagree', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const staleMessageRelay = makeContact(
      '44'.repeat(32),
      'Stale Message Relay',
      CONTACT_TYPE_REPEATER,
      {
        last_seen: 100,
      }
    );
    const freshAdvertRelay = makeContact(
      '55'.repeat(32),
      'Fresh Advert Relay',
      CONTACT_TYPE_REPEATER,
      {
        last_advert: 500,
      }
    );

    render(
      <Sidebar
        contacts={[staleMessageRelay, freshAdvertRelay]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{
          [getStateKey('contact', staleMessageRelay.public_key)]: 1000,
          [getStateKey('contact', freshAdvertRelay.public_key)]: 50,
        }}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const repeaterRows = screen
      .getAllByText(/Relay$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    expect(repeaterRows).toEqual(['Fresh Advert Relay', 'Stale Message Relay']);
  });

  it('sorts a favorite repeater by its displayed last_seen, not an inflated last_advert', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    // Radio contact sync overwrites last_advert with the radio's sender-clock
    // value, which can land far ahead of (or in the future relative to) the
    // server's last_seen. The sidebar shows last_seen as "Last heard", so the
    // recency sort must follow last_seen rather than the skewed last_advert.
    const skewedRelay = makeContact('44'.repeat(32), 'Skewed Relay', CONTACT_TYPE_REPEATER, {
      last_seen: 100,
      last_advert: 9_999_999,
      favorite: true,
    });
    const recentRelay = makeContact('55'.repeat(32), 'Recent Relay', CONTACT_TYPE_REPEATER, {
      last_seen: 500,
      favorite: true,
    });

    render(
      <Sidebar
        contacts={[skewedRelay, recentRelay]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const repeaterRows = screen
      .getAllByText(/Relay$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    // Recent Relay was actually heard more recently (last_seen 500 > 100), so it
    // sorts above the relay with the inflated last_advert.
    expect(repeaterRows).toEqual(['Recent Relay', 'Skewed Relay']);
  });

  it('pins only the canonical Public channel to the top of channel sorting', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const fakePublic = makeChannel('DD'.repeat(16), 'Public');
    const alphaChannel = makeChannel('CC'.repeat(16), '#alpha');
    const onSelectConversation = vi.fn();

    render(
      <Sidebar
        contacts={[]}
        channels={[fakePublic, alphaChannel, publicChannel]}
        activeConversation={null}
        onSelectConversation={onSelectConversation}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByText('Public')[0]);

    expect(onSelectConversation).toHaveBeenCalledWith({
      type: 'channel',
      id: PUBLIC_CHANNEL_KEY,
      name: 'Public',
    });
  });

  it('sorts favorites independently and persists the favorites sort preference', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const zed = makeContact('11'.repeat(32), 'Zed', 1, { last_advert: 150, favorite: true });
    const amy = makeContact('22'.repeat(32), 'Amy', 1, { favorite: true });

    const props = {
      contacts: [zed, amy],
      channels: [publicChannel],
      activeConversation: null,
      onSelectConversation: vi.fn(),
      onNewMessage: vi.fn(),
      lastMessageTimes: {
        [getStateKey('contact', zed.public_key)]: 200,
      },
      unreadCounts: {},
      mentions: {},
      showCracker: false,
      crackerRunning: false,
      onToggleCracker: vi.fn(),
      onMarkAllRead: vi.fn(),
    };

    const getFavoritesOrder = () =>
      screen
        .getAllByText(/^(Amy|Zed)$/)
        .map((node) => node.textContent)
        .filter((text): text is string => Boolean(text));

    const { unmount } = render(<Sidebar {...props} />);

    expect(getFavoritesOrder()).toEqual(['Zed', 'Amy']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort Favorites alphabetically' }));

    expect(getFavoritesOrder()).toEqual(['Amy', 'Zed']);

    unmount();
    render(<Sidebar {...props} />);

    expect(getFavoritesOrder()).toEqual(['Amy', 'Zed']);
  });

  it('cycles favorites through the four sort orders, grouping by type', () => {
    // Mixed-type favorites: a channel (rank 0), two clients (rank 1), a repeater
    // (rank 3). Names are chosen so plain-alpha and type-grouped orders differ.
    const chan = makeChannel('cd'.repeat(16), 'Zulu');
    const alpha = makeContact('11'.repeat(32), 'Alpha', 1, { favorite: true });
    const bravo = makeContact('22'.repeat(32), 'Bravo', 1, { favorite: true });
    const yankee = makeContact('33'.repeat(32), 'Yankee', 2, { favorite: true }); // repeater
    const favChannel = { ...chan, favorite: true };

    const props = {
      contacts: [alpha, bravo, yankee],
      channels: [favChannel],
      activeConversation: null,
      onSelectConversation: vi.fn(),
      onNewMessage: vi.fn(),
      lastMessageTimes: {
        [getStateKey('contact', alpha.public_key)]: 100,
        [getStateKey('contact', bravo.public_key)]: 300, // Bravo more recent than Alpha
      },
      unreadCounts: {},
      mentions: {},
      showCracker: false,
      crackerRunning: false,
      onToggleCracker: vi.fn(),
      onMarkAllRead: vi.fn(),
    };

    const getFavoritesOrder = () =>
      screen
        .getAllByText(/^(Alpha|Bravo|Yankee|Zulu)$/)
        .map((node) => node.textContent)
        .filter((text): text is string => Boolean(text));

    render(<Sidebar {...props} />);

    // recent -> alpha: pure name order regardless of type.
    fireEvent.click(screen.getByRole('button', { name: 'Sort Favorites alphabetically' }));
    expect(getFavoritesOrder()).toEqual(['Alpha', 'Bravo', 'Yankee', 'Zulu']);

    // alpha -> type-recent: group by type (channel, clients, repeater); within the
    // client group, more-recent Bravo precedes Alpha.
    fireEvent.click(screen.getByRole('button', { name: 'Sort Favorites by type, then recent' }));
    expect(getFavoritesOrder()).toEqual(['Zulu', 'Bravo', 'Alpha', 'Yankee']);

    // type-recent -> type-alpha: same grouping, clients now A-Z (Alpha before Bravo).
    fireEvent.click(
      screen.getByRole('button', { name: 'Sort Favorites by type, then alphabetically' })
    );
    expect(getFavoritesOrder()).toEqual(['Zulu', 'Alpha', 'Bravo', 'Yankee']);

    // type-alpha -> recent: cycle wraps back to the recency sort.
    expect(screen.getByRole('button', { name: 'Sort Favorites by recent' })).toBeInTheDocument();
  });

  it('dims and italicizes a muted channel row name while leaving unmuted names normal', () => {
    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const mutedChannel = { ...makeChannel('DD'.repeat(16), '#offtopic'), muted: true };
    const normalChannel = makeChannel('CC'.repeat(16), '#general');

    render(
      <Sidebar
        contacts={[]}
        channels={[publicChannel, normalChannel, mutedChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    expect(screen.getByText('#offtopic')).toHaveClass('opacity-40', 'italic');

    const normalName = screen.getByText('#general');
    expect(normalName).not.toHaveClass('opacity-40');
    expect(normalName).not.toHaveClass('italic');
  });

  it('dims and italicizes a muted Public channel row name', () => {
    const mutedPublic = { ...makeChannel(PUBLIC_CHANNEL_KEY, 'Public'), muted: true };

    render(
      <Sidebar
        contacts={[]}
        channels={[mutedPublic]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    expect(screen.getByText('Public')).toHaveClass('opacity-40', 'italic');
  });

  it('seeds favorites sort from the legacy global sort order when section prefs are missing', () => {
    localStorage.setItem('remoteterm-sortOrder', 'alpha');

    const publicChannel = makeChannel(PUBLIC_CHANNEL_KEY, 'Public');
    const zed = makeContact('11'.repeat(32), 'Zed', 1, { last_advert: 150, favorite: true });
    const amy = makeContact('22'.repeat(32), 'Amy', 1, { favorite: true });

    render(
      <Sidebar
        contacts={[zed, amy]}
        channels={[publicChannel]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{
          [getStateKey('contact', zed.public_key)]: 200,
        }}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    const favoriteRows = screen
      .getAllByText(/^(Amy|Zed)$/)
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text));

    expect(favoriteRows).toEqual(['Amy', 'Zed']);
    // Favorites now cycles recent -> alpha -> type-recent -> type-alpha, so the
    // next order after the seeded 'alpha' is the type-grouped recency sort.
    expect(
      screen.getByRole('button', { name: 'Sort Favorites by type, then recent' })
    ).toBeInTheDocument();
  });
});

describe('Sidebar customisation (plan 17)', () => {
  beforeEach(() => localStorage.clear());

  it('renders tools in a stored custom order', () => {
    localStorage.setItem(
      'remoteterm-sidebar-tool-order',
      JSON.stringify([
        'map',
        'my-node',
        'mesh-health',
        'raw',
        'visualizer',
        'trace',
        'search',
        'channel-registry',
        'cracker',
      ])
    );
    renderSidebar();
    const mapRow = screen.getByRole('button', { name: 'Node Map' });
    const myNodeRow = screen.getByRole('button', { name: 'My Node' });
    expect(
      mapRow.compareDocumentPosition(myNodeRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders sections in a stored custom order (favorites before tools)', () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['favorites', 'tools', 'channels', 'contacts', 'repeaters', 'rooms'])
    );
    renderSidebar();
    const favorites = screen.getByRole('button', { name: 'Favorites' });
    const tools = screen.getByRole('button', { name: 'Tools' });
    expect(
      favorites.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('collapses to an icon rail and hides search + section headers', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByLabelText('Search conversations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Favorites' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Node Map' })).toBeInTheDocument();
  });

  it('ignores rail state and hides the toggle when forceExpanded', () => {
    localStorage.setItem('remoteterm-sidebar-rail-collapsed', 'true');
    render(
      <Sidebar
        contacts={[]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public')]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
        forceExpanded
      />
    );
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
  });

  it('opens the customize panel and reorders a section via move-down', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    const panel = screen.getByRole('group', { name: 'Customize sidebar' });
    const toolsRow = within(panel)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Tools'))!;
    fireEvent.click(within(toolsRow).getByRole('button', { name: 'Move down' }));
    expect(JSON.parse(localStorage.getItem('remoteterm-sidebar-section-order')!)[0]).toBe(
      'favorites'
    );
  });

  it('resets layout to defaults', () => {
    localStorage.setItem(
      'remoteterm-sidebar-tool-order',
      JSON.stringify([
        'map',
        'my-node',
        'mesh-health',
        'raw',
        'visualizer',
        'trace',
        'search',
        'channel-registry',
        'cracker',
      ])
    );
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(localStorage.getItem('remoteterm-sidebar-tool-order')).toBeNull();
  });

  it('renders per-type favourite sub-headers when favourites of multiple types exist', () => {
    const favChan = { ...makeChannel('BB'.repeat(16), '#flight'), favorite: true };
    const favContact = makeContact('11'.repeat(32), 'Alice', 1, { favorite: true });
    render(
      <Sidebar
        contacts={[favContact]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public'), favChan]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    // Sub-headers only appear in a type-grouped sort mode. From the default
    // 'recent', cycle: recent -> alpha -> type-recent.
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort Favorites alphabetically' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort Favorites by type, then recent' }));
    expect(screen.getByRole('button', { name: 'Favorite Channels' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite Contacts' })).toBeInTheDocument();
  });

  it('renders favourites as a flat list in the default (recent) sort mode', () => {
    const favChan = { ...makeChannel('BB'.repeat(16), '#flight'), favorite: true };
    const favContact = makeContact('11'.repeat(32), 'Alice', 1, { favorite: true });
    render(
      <Sidebar
        contacts={[favContact]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public'), favChan]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    // No per-type sub-headers in flat mode.
    expect(screen.queryByRole('button', { name: 'Favorite Channels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Favorite Contacts' })).not.toBeInTheDocument();
  });
});

describe('Sidebar contacts pills', () => {
  beforeEach(() => localStorage.clear());

  function renderMixed(extra?: Partial<Parameters<typeof Sidebar>[0]>) {
    const contacts: Contact[] = [
      makeContact('11'.repeat(32), 'Alice', 1),
      makeContact('44'.repeat(32), 'Sensor-1', CONTACT_TYPE_SENSOR),
      makeContact('22'.repeat(32), 'Relay', CONTACT_TYPE_REPEATER),
      makeContact('33'.repeat(32), 'Ops Board', CONTACT_TYPE_ROOM),
    ];
    return render(
      <Sidebar
        contacts={contacts}
        channels={[]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
        {...extra}
      />
    );
  }

  it('shows one Contacts section with a pill per non-empty type', () => {
    renderMixed();
    const group = screen.getByRole('radiogroup', { name: 'Filter contacts by type' });
    expect(within(group).getByRole('radio', { name: /All/ })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /Companions/ })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /Sensors/ })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /Repeaters/ })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /Room/ })).toBeInTheDocument();
    // No separate section headers for the merged types.
    expect(screen.queryByRole('button', { name: 'Repeaters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Room Servers' })).not.toBeInTheDocument();
  });

  it('All shows every type; a type pill filters to that type', () => {
    renderMixed();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Relay')).toBeInTheDocument();
    expect(screen.getByText('Sensor-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Repeaters/ }));
    expect(screen.getByText('Relay')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Sensor-1')).not.toBeInTheDocument();
  });

  it('hides the pill row when only one type is present', () => {
    render(
      <Sidebar
        contacts={[makeContact('11'.repeat(32), 'Alice', 1)]}
        channels={[]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(
      screen.queryByRole('radiogroup', { name: 'Filter contacts by type' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('persists the selected pill across remount', () => {
    const { unmount } = renderMixed();
    fireEvent.click(screen.getByRole('radio', { name: /Repeaters/ }));
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    unmount();
    renderMixed();
    expect(screen.getByText('Relay')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});
