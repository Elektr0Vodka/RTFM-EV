import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../components/MessageList';
import { PathHopWidthProvider } from '../contexts/PathHopWidthContext';
import { buildNameSet } from '../lib/hashtagChannelState';
import {
  CONTACT_TYPE_ROOM,
  TXT_TYPE_GROUP_DATA,
  type Channel,
  type Contact,
  type Message,
} from '../types';

const scrollIntoViewMock = vi.fn();
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'C3B889530D4F02DB5662EA13C417F530',
    text: 'Alice: hello world',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    ...overrides,
  };
}

describe('MessageList channel sender rendering', () => {
  beforeEach(() => {
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
      writable: true,
    });
  });

  it('renders explicit corrupt placeholder and warning avatar for unnamed corrupt channel packets', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            text: "Nv\x0ek\x16ɩ'\x7fg:",
            sender_name: null,
            sender_key: null,
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('<No name -- corrupt packet?>')).toBeInTheDocument();
    expect(screen.getByTestId('corrupt-avatar')).toBeInTheDocument();
  });

  it('renders an image placeholder for GRP_DATA rows instead of the marker text', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            text: '1F2E: [image] id=3b chunks=2',
            txt_type: TXT_TYPE_GROUP_DATA,
            sender_timestamp: null,
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    const placeholder = screen.getByTestId('group-data-placeholder');
    expect(placeholder).toHaveTextContent('Image (not supported)');
    expect(placeholder).toHaveAttribute('title', expect.stringContaining('id 3b, 2 chunk(s)'));
    expect(screen.queryByText('[image] id=3b chunks=2')).not.toBeInTheDocument();
    expect(screen.getByText('1F2E')).toBeInTheDocument();
  });

  it('renders a generic placeholder for non-image GRP_DATA rows', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            text: '[data] type=0x1234 len=5 sha=2cf24dba',
            txt_type: TXT_TYPE_GROUP_DATA,
            sender_timestamp: null,
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    const placeholder = screen.getByTestId('group-data-placeholder');
    expect(placeholder).toHaveTextContent('Data (not supported)');
    expect(placeholder).toHaveAttribute('title', expect.stringContaining('0x1234, 5 bytes'));
  });

  it('renders a region badge for region-scoped channel messages', () => {
    render(
      <MessageList
        messages={[createMessage({ sender_name: 'Alice', region: 'nl-gr' })]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('nl-gr')).toBeInTheDocument();
    expect(screen.getByTitle('Regional scope: nl-gr')).toBeInTheDocument();
  });

  it('does not render a region badge for unscoped messages', () => {
    render(
      <MessageList
        messages={[createMessage({ sender_name: 'Alice', region: null })]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.queryByText('nl-gr')).not.toBeInTheDocument();
  });

  it('shows per-hop byte width in the path badge when the toggle is on', () => {
    render(
      <PathHopWidthProvider showPathHopWidth setShowPathHopWidth={() => {}}>
        <MessageList
          messages={[
            createMessage({
              sender_name: 'Alice',
              // 8 hex chars over 2 hops = 2 bytes/hop.
              paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
            }),
          ]}
          contacts={[]}
          loading={false}
        />
      </PathHopWidthProvider>
    );

    expect(screen.getByText('(2 · 2B)')).toBeInTheDocument();
    expect(screen.getByTitle('View message path (2B per hop)')).toBeInTheDocument();
  });

  it('hides the width by default (toggle off) and shows only the hop count', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            sender_name: 'Alice',
            paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.queryByText('(2 · 2B)')).not.toBeInTheDocument();
    expect(screen.getByTitle('View message path')).toBeInTheDocument();
  });

  it('omits the width for direct (0-hop) paths even when the toggle is on', () => {
    render(
      <PathHopWidthProvider showPathHopWidth setShowPathHopWidth={() => {}}>
        <MessageList
          messages={[
            createMessage({
              sender_name: 'Alice',
              paths: [{ path: '', path_len: 0, received_at: 1700000001 }],
            }),
          ]}
          contacts={[]}
          loading={false}
        />
      </PathHopWidthProvider>
    );

    expect(screen.getByText('(d)')).toBeInTheDocument();
    expect(screen.getByTitle('View message path')).toBeInTheDocument();
  });

  it('does not display the channel key as the sender key in the path modal', async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[
          createMessage({
            // Distinctive channel key so its prefix cannot collide with hop prefixes.
            conversation_key: 'DEADBEEF00112233445566778899AABB',
            sender_name: 'Alice',
            sender_key: null,
            paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    await user.click(screen.getByTitle('View message path'));

    const dialog = await screen.findByRole('dialog');
    // The sender has no resolvable public key, so the sender prefix must be the
    // unknown marker - never the channel key (which is shared by every sender in
    // the channel and would otherwise show identically for all of them).
    expect(within(dialog).getByText('Alice')).toBeInTheDocument();
    expect(within(dialog).queryByText('DEAD')).not.toBeInTheDocument();
  });

  it('does not display the channel key for an unnamed channel sender in the path modal', async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[
          createMessage({
            conversation_key: 'DEADBEEF00112233445566778899AABB',
            // No stored sender name and no parseable "Name: message" prefix, so
            // the sender is fully unknown and hits the final fallback branch.
            text: 'garbled payload with no sender prefix',
            sender_name: null,
            sender_key: null,
            paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    await user.click(screen.getByTitle('View message path'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('DEAD')).not.toBeInTheDocument();
  });

  it('prefers stored sender_name for channel messages even when text is not sender-prefixed', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            text: 'garbled payload with no sender prefix',
            sender_name: 'Alice',
            sender_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders room-server DM messages using stored sender attribution instead of the room contact', () => {
    const roomContact: Contact = {
      public_key: 'ab'.repeat(32),
      name: 'Ops Board',
      type: CONTACT_TYPE_ROOM,
      flags: 0,
      direct_path: null,
      direct_path_len: -1,
      direct_path_hash_mode: -1,
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
    };

    render(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            conversation_key: roomContact.public_key,
            text: 'status update: ready',
            sender_name: 'Alice',
            sender_key: '12'.repeat(32),
          }),
        ]}
        contacts={[roomContact]}
        loading={false}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Ops Board')).not.toBeInTheDocument();
    expect(screen.getByText('status update: ready')).toBeInTheDocument();
  });

  it('gives clickable sender avatars an accessible label', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            text: 'garbled payload with no sender prefix',
            sender_name: 'Alice',
            sender_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
        onOpenContactInfo={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'View info for Alice' })).toBeInTheDocument();
  });

  it('renders valid channel references as clickable links and ignores invalid ones', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    render(
      <MessageList
        messages={[
          createMessage({
            text: 'Alice: Join #mesh-room now skip #bad--room and visit https://example.com/#also-skip',
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    const linkedChannel = screen.getByRole('button', { name: '#mesh-room' });
    expect(linkedChannel).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '#bad--room' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://example.com/#also-skip' })
    ).toBeInTheDocument();

    await user.click(linkedChannel);

    expect(onChannelReferenceClick).toHaveBeenCalledWith('#mesh-room');
  });

  it('links valid channel references when followed by clause punctuation', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    render(
      <MessageList
        messages={[
          createMessage({
            text: 'Alice: Check #mesh-room, then #ops-room; then #alpha-room.',
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    await user.click(screen.getByRole('button', { name: '#mesh-room' }));
    await user.click(screen.getByRole('button', { name: '#ops-room' }));
    await user.click(screen.getByRole('button', { name: '#alpha-room' }));

    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(1, '#mesh-room');
    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(2, '#ops-room');
    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(3, '#alpha-room');
  });

  it('links valid channel references in direct messages too', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    render(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            text: 'check #ops-room',
            conversation_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    await user.click(screen.getByRole('button', { name: '#ops-room' }));

    expect(onChannelReferenceClick).toHaveBeenCalledWith('#ops-room');
  });

  it('does not strip colon-prefixed text in direct messages (issue #198)', () => {
    render(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            conversation_key: 'ab'.repeat(32),
            text: 'TEST1: TEST2',
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('TEST1: TEST2')).toBeInTheDocument();
  });

  it('offers a jump instead of a divider when the unread boundary is not loaded', async () => {
    const user = userEvent.setup();
    const onNavigateToUnread = vi.fn();
    // Boundary id 999 is not among the loaded messages: the real first-unread is
    // further back than this window. The divider must not be invented at the top.
    render(
      <MessageList
        messages={[
          createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
          createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
        ]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={999}
        onNavigateToUnread={onNavigateToUnread}
      />
    );

    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();

    const jump = await screen.findByRole('button', { name: 'Jump to unread' });
    await user.click(jump);

    // Hands off to the jump-to-message path rather than scrolling to a wrong row.
    expect(onNavigateToUnread).toHaveBeenCalledWith(999);
  });

  it('shows no unread affordance at all when nothing is unread', () => {
    render(
      <MessageList
        messages={[createMessage({ id: 1, received_at: 1700000001, text: 'Alice: hi' })]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={null}
      />
    );

    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
  });

  it('renders and dismisses an unread marker at the first unread message boundary', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    function DismissibleUnreadMarkerList() {
      const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState<number | undefined>(2);

      return (
        <MessageList
          messages={messages}
          contacts={[]}
          loading={false}
          unreadMarkerMessageId={unreadMarkerMessageId}
          onDismissUnreadMarker={() => setUnreadMarkerMessageId(undefined)}
        />
      );
    }

    render(<DismissibleUnreadMarkerList />);

    const marker = screen.getByRole('button', { name: /Unread messages/i });
    expect(marker).toBeInTheDocument();
    expect(screen.getByText('older')).toBeInTheDocument();
    expect(screen.getByText('newer')).toBeInTheDocument();

    await user.click(marker);

    expect(screen.queryByRole('button', { name: /Unread messages/i })).not.toBeInTheDocument();
  });

  it('shows a jump-to-unread button and dismisses it after use without hiding the marker', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    render(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to unread' });
    expect(jumpButton).toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();

    await user.click(jumpButton);

    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('lets the user dismiss the jump-to-unread button without scrolling or hiding the marker', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    render(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss jump to unread' }));

    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('hides the jump-to-unread button when the unread marker is already visible', () => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function () {
        const element = this as HTMLElement;
        if (element.textContent?.includes('Unread messages')) {
          return {
            top: 200,
            bottom: 240,
            left: 0,
            right: 300,
            width: 300,
            height: 40,
            x: 0,
            y: 200,
            toJSON: () => '',
          };
        }
        if (element.className.includes('overflow-y-auto')) {
          return {
            top: 100,
            bottom: 500,
            left: 0,
            right: 400,
            width: 400,
            height: 400,
            x: 0,
            y: 100,
            toJSON: () => '',
          };
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => '',
        };
      },
    });

    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    render(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
  });
  it('mounts only a window of rows for a long history', () => {
    const messages = Array.from({ length: 500 }, (_, i) =>
      createMessage({
        id: i + 1,
        text: `Alice: message ${i}`,
        sender_timestamp: 1700000000 + i,
        received_at: 1700000001 + i,
      })
    );

    const { container } = render(<MessageList messages={messages} contacts={[]} loading={false} />);

    // jsdom reports no layout, so the list falls back to a nominal viewport. The point
    // is that the window is bounded: a 500-message history must not mount 500 rows.
    const mounted = container.querySelectorAll('[data-message-id]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });
});

describe('MessageList hop-size filter', () => {
  beforeEach(() => {
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
      writable: true,
    });
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  const oneByte = (id: number) =>
    createMessage({
      id,
      sender_name: 'Alice',
      text: `Alice: msg ${id}`,
      received_at: 1700000000 + id,
      paths: [{ path: '1A2B', path_len: 2, received_at: 1700000000 + id }],
    });
  const twoByte = (id: number) =>
    createMessage({
      id,
      sender_name: 'Bob',
      text: `Bob: msg ${id}`,
      received_at: 1700000000 + id,
      paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000000 + id }],
    });
  const noPath = (id: number) =>
    createMessage({
      id,
      outgoing: true,
      text: `msg ${id}`,
      received_at: 1700000000 + id,
      paths: null,
    });

  const row = (container: HTMLElement, id: number) =>
    container.querySelector(`[data-message-id="${id}"]`);

  async function openFilterAndCheck(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    await user.click(screen.getByRole('button', { name: /filter messages/i }));
    await user.click(screen.getByRole('checkbox', { name }));
  }
  const hideWidth = openFilterAndCheck;

  it('renders all messages before any width is hidden', () => {
    const { container } = render(
      <MessageList messages={[oneByte(1), twoByte(2), noPath(3)]} contacts={[]} loading={false} />
    );
    expect(row(container, 1)).not.toBeNull();
    expect(row(container, 2)).not.toBeNull();
    expect(row(container, 3)).not.toBeNull();
  });

  it('hides only messages whose observed path width matches the hidden width', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList messages={[oneByte(1), twoByte(2), noPath(3)]} contacts={[]} loading={false} />
    );

    await hideWidth(user, /1-byte hops/i);

    expect(row(container, 1)).toBeNull(); // 1-byte hidden
    expect(row(container, 2)).not.toBeNull(); // 2-byte still shown
    expect(row(container, 3)).not.toBeNull(); // no derivable width always shown
  });

  // The virtual row wrapper holding a message; the unread divider renders inside it.
  const virtualRow = (container: HTMLElement, id: number) =>
    row(container, id)?.closest('[data-index]') ?? null;

  it('hides a hidden-width unread anchor and moves the divider to the next visible message', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList
        messages={[oneByte(1), twoByte(2), oneByte(3), twoByte(4)]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={1}
      />
    );

    await hideWidth(user, /1-byte hops/i);

    // The server's boundary (id 1) is a 1-byte message: it is hidden like any
    // other, and the divider sits on the first visible unread message instead.
    expect(row(container, 1)).toBeNull();
    expect(row(container, 3)).toBeNull();
    const divider = screen.getByText('Unread messages');
    expect(virtualRow(container, 2)?.contains(divider)).toBe(true);
  });

  it('drops the unread divider when every unread message is hidden', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList
        messages={[twoByte(1), oneByte(2), oneByte(3)]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={2}
      />
    );

    await hideWidth(user, /1-byte hops/i);

    expect(row(container, 1)).not.toBeNull();
    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();
  });

  it('applies a server-provided hidden-width selection on first render', () => {
    // A channel opened while the filter is already set must be filtered at once,
    // without a reload, including a hidden unread boundary.
    const { container } = render(
      <MessageList
        messages={[oneByte(1), twoByte(2)]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={1}
        hiddenHopWidths={[1]}
      />
    );
    expect(row(container, 1)).toBeNull();
    expect(row(container, 2)).not.toBeNull();
    expect(virtualRow(container, 2)?.contains(screen.getByText('Unread messages'))).toBe(true);
  });

  it('leaves server-driven pagination chrome intact when everything visible is filtered', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList
        messages={[oneByte(1), oneByte(2)]}
        contacts={[]}
        loading={false}
        hasOlderMessages={true}
      />
    );

    await hideWidth(user, /1-byte hops/i);

    // All rows are filtered out of the view...
    expect(container.querySelectorAll('[data-message-id]').length).toBe(0);
    // ...but the older-messages banner is driven by the server cursor prop, not
    // the rendered count, so it must still be offered.
    expect(screen.getByText('Scroll up for older messages')).toBeInTheDocument();
  });

  it('reports toggles to the server-backed setting when controlled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MessageList
        messages={[oneByte(1), twoByte(2)]}
        contacts={[]}
        loading={false}
        hiddenHopWidths={[]}
        onHiddenHopWidthsChange={onChange}
      />
    );
    await hideWidth(user, /1-byte hops/i);
    expect(onChange).toHaveBeenCalledWith([1]);

    // The parent echoes the saved setting back; the list follows the prop.
    rerender(
      <MessageList
        messages={[oneByte(1), twoByte(2)]}
        contacts={[]}
        loading={false}
        hiddenHopWidths={[1]}
        onHiddenHopWidthsChange={onChange}
      />
    );
    expect(row(container, 1)).toBeNull();
    expect(row(container, 2)).not.toBeNull();
  });

  const scoped = (id: number) =>
    createMessage({
      id,
      sender_name: 'Alice',
      text: `Alice: scoped ${id}`,
      region: 'nl-gr',
      received_at: 1700000000 + id,
    });
  const unscopedIncoming = (id: number) =>
    createMessage({
      id,
      sender_name: 'Bob',
      text: `Bob: unscoped ${id}`,
      region: null,
      received_at: 1700000000 + id,
    });
  const unscopedOutgoing = (id: number) =>
    createMessage({
      id,
      outgoing: true,
      text: `mine ${id}`,
      region: null,
      received_at: 1700000000 + id,
    });

  it('hides unscoped incoming messages while keeping scoped and own messages', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList
        messages={[scoped(10), unscopedIncoming(11), unscopedOutgoing(12)]}
        contacts={[]}
        loading={false}
      />
    );

    await openFilterAndCheck(user, /hide unscoped/i);

    expect(row(container, 10)).not.toBeNull(); // region-scoped stays
    expect(row(container, 11)).toBeNull(); // unscoped incoming hidden
    expect(row(container, 12)).not.toBeNull(); // your own message always stays
  });

  it('moves the unread divider past an unscoped anchor too', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MessageList
        messages={[unscopedIncoming(11), scoped(12), unscopedIncoming(13)]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={11}
      />
    );

    await openFilterAndCheck(user, /hide unscoped/i);

    expect(row(container, 11)).toBeNull(); // anchor no longer forced visible
    expect(row(container, 13)).toBeNull();
    expect(virtualRow(container, 12)?.contains(screen.getByText('Unread messages'))).toBe(true);
  });
});

describe('MessageList #hashtag mention states', () => {
  beforeEach(() => {
    // Earlier tests persist view filters (hideUnscoped / hop widths) in
    // localStorage; without clearing them our region-less test message would be
    // filtered out and no rows would mount.
    localStorage.clear();
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
      writable: true,
    });
  });

  function createChannel(name: string): Channel {
    return {
      key: name,
      name,
      is_hashtag: true,
      on_radio: true,
      last_read_at: null,
      favorite: false,
      muted: false,
    };
  }

  it('styles followed/known/unknown mentions and captures an unknown one via the + button', async () => {
    const onHashtagAdded = vi.fn();
    render(
      <MessageList
        messages={[createMessage({ text: 'Alice: try #amsterdam and #saarland and #wetter' })]}
        contacts={[]}
        channels={[createChannel('#amsterdam')]}
        registryNames={buildNameSet(['#saarland'])}
        onHashtagAdded={onHashtagAdded}
        loading={false}
      />
    );

    // Distinct titles reflect the three states.
    expect(screen.getByTitle('#amsterdam: followed channel')).toBeInTheDocument();
    expect(screen.getByTitle('#saarland: in your channel registry')).toBeInTheDocument();
    expect(screen.getByTitle('#wetter: not in your registry')).toBeInTheDocument();

    // Only the unknown mention gets an inline capture button.
    expect(screen.queryByLabelText('Add #amsterdam to the channel registry')).toBeNull();
    const addBtn = screen.getByLabelText('Add #wetter to the channel registry');
    await userEvent.click(addBtn);
    expect(onHashtagAdded).toHaveBeenCalledWith('#wetter');
  });

  it('auto-captures unknown mentions when the setting is on', () => {
    const onHashtagAdded = vi.fn();
    render(
      <MessageList
        messages={[createMessage({ text: 'Alice: hi #newchan' })]}
        contacts={[]}
        channels={[]}
        registryNames={buildNameSet([])}
        autoAddMentionedChannels
        onHashtagAdded={onHashtagAdded}
        loading={false}
      />
    );
    expect(onHashtagAdded).toHaveBeenCalledWith('#newchan');
  });
});

describe('MessageList entity parsing', () => {
  const KEY = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

  function createContact(overrides: Partial<Contact> = {}): Contact {
    return {
      public_key: KEY,
      name: 'KeyOwner',
      type: 0,
      flags: 0,
      direct_path: null,
      direct_path_len: 0,
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

  it('renders an inline contact share with an Add contact button and adds it', async () => {
    const onAddSharedContact = vi.fn().mockResolvedValue(undefined);
    render(
      <MessageList
        messages={[createMessage({ text: `meet <${KEY}:1:Fl1p>`, sender_name: 'Bob' })]}
        contacts={[]}
        loading={false}
        onAddSharedContact={onAddSharedContact}
      />
    );
    const chip = screen.getByTestId('contact-share');
    expect(chip).toHaveTextContent('Fl1p');
    expect(chip).toHaveTextContent('Client');
    expect(screen.queryByText(`<${KEY}:1:Fl1p>`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(onAddSharedContact).toHaveBeenCalledWith(KEY, 'Fl1p', 1);
  });

  it('renders an inline contact share for a known contact as an open-contact button', async () => {
    const onOpenContactInfo = vi.fn();
    render(
      <MessageList
        messages={[createMessage({ text: `meet <${KEY}:1:Fl1p>`, sender_name: 'Bob' })]}
        contacts={[createContact()]}
        loading={false}
        onOpenContactInfo={onOpenContactInfo}
        onAddSharedContact={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('contact-share-known'));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY);
  });

  it('renders a known pubkey as a contact button', async () => {
    const onOpenContactInfo = vi.fn();
    render(
      <MessageList
        messages={[createMessage({ text: `node ${KEY}`, sender_name: 'Bob' })]}
        contacts={[createContact()]}
        loading={false}
        parsePubkeys
        onOpenContactInfo={onOpenContactInfo}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /KeyOwner/ }));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY);
  });

  it('renders an unknown pubkey with an analyzer lookup link', () => {
    render(
      <MessageList
        messages={[createMessage({ text: `node ${KEY}`, sender_name: 'Bob' })]}
        contacts={[]}
        loading={false}
        parsePubkeys
        analyzerSites={[{ name: 'radar', node_url_template: 'https://r.example/{pubkey}' }]}
      />
    );
    const link = screen.getByRole('link', { name: /radar/i });
    expect(link).toHaveAttribute('href', `https://r.example/${KEY}`);
  });

  it('does not parse pubkeys when the toggle is off', () => {
    render(
      <MessageList
        messages={[createMessage({ text: `node ${KEY}`, sender_name: 'Bob' })]}
        contacts={[createContact()]}
        loading={false}
        onOpenContactInfo={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /KeyOwner/ })).not.toBeInTheDocument();
  });

  it('renders a coordinate as a clickable location card when enabled', async () => {
    const onCoordinateClick = vi.fn();
    render(
      <MessageList
        messages={[createMessage({ text: 'at 52.724169,6.997483', sender_name: 'Bob' })]}
        contacts={[]}
        loading={false}
        parseCoordinates
        onCoordinateClick={onCoordinateClick}
      />
    );
    await userEvent.click(screen.getByText('52.724169, 6.997483'));
    expect(onCoordinateClick).toHaveBeenCalledWith(52.724169, 6.997483, '');
  });
});

describe('MessageList path modal sender location', () => {
  const SENDER_KEY = 'ab'.repeat(32);

  function makeSenderContact(overrides: Partial<Contact> = {}): Contact {
    return {
      public_key: SENDER_KEY,
      name: 'Bob',
      type: 1, // companion (not a room), so getSenderInfo uses the contact coords
      flags: 0,
      direct_path: null,
      direct_path_len: 0,
      direct_path_hash_mode: 0,
      last_advert: null,
      lat: null,
      lon: null,
      manual_lat: null,
      manual_lon: null,
      last_seen: 1700000000,
      on_radio: false,
      favorite: false,
      radio_policy: 'auto',
      last_contacted: null,
      last_read_at: null,
      first_seen: null,
      ...overrides,
    };
  }

  const privMessage = createMessage({
    type: 'PRIV',
    conversation_key: SENDER_KEY,
    text: 'hi',
    sender_name: null,
    sender_key: null,
    paths: [{ path: '1A', received_at: 1700000000, path_len: 1 }],
  });

  it('shows the sender manual location in the path modal when advertised coords are missing', async () => {
    render(
      <MessageList
        messages={[privMessage]}
        contacts={[makeSenderContact({ lat: null, lon: null, manual_lat: 51.5, manual_lon: 4.25 })]}
        loading={false}
      />
    );
    await userEvent.click(screen.getByTitle('View message path'));
    expect(screen.getByText('(51.5000, 4.2500)')).toBeInTheDocument();
  });
});

describe('MessageList delete action', () => {
  it('calls onDeleteMessage with the message when Delete is clicked', async () => {
    const onDeleteMessage = vi.fn();
    const msg = createMessage();
    render(
      <MessageList
        messages={[msg]}
        contacts={[]}
        loading={false}
        onDeleteMessage={onDeleteMessage}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteMessage).toHaveBeenCalledWith(msg);
  });

  it('shows Delete even for a message with no sender_timestamp, without React/Reply', () => {
    render(
      <MessageList
        messages={[createMessage({ sender_timestamp: null })]}
        contacts={[]}
        loading={false}
        onReactToMessage={vi.fn()}
        onReplyToMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('renders no row actions when onDeleteMessage is not provided and the message is a reaction', () => {
    render(
      <MessageList
        messages={[createMessage({ text: 'Alice: \u{1F44D}\nabcdefgh' })]}
        contacts={[]}
        loading={false}
        onReactToMessage={vi.fn()}
        onReplyToMessage={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
  });
});

describe('MessageList failed direct messages', () => {
  const dm = (overrides: Partial<Message> = {}) =>
    createMessage({
      id: 10,
      type: 'PRIV',
      conversation_key: 'ab'.repeat(32),
      text: 'are you there?',
      outgoing: true,
      ...overrides,
    });

  it('shows a failed marker and a Retry action instead of the pending ?', async () => {
    const onRetry = vi.fn();
    render(
      <MessageList
        messages={[dm({ failed_at: 1700000100 })]}
        contacts={[]}
        loading={false}
        onRetryDirectMessage={onRetry}
      />
    );

    expect(screen.getByText(/Failed/)).toBeInTheDocument();
    expect(screen.queryByTitle('No repeats heard yet')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith(10);
  });

  it('keeps the pending ? and no Retry while the DM is not failed', () => {
    render(
      <MessageList messages={[dm()]} contacts={[]} loading={false} onRetryDirectMessage={vi.fn()} />
    );

    expect(screen.getByTitle('No repeats heard yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('treats an acked DM as delivered even if a failed marker is still set', () => {
    render(
      <MessageList
        messages={[dm({ acked: 1, failed_at: 1700000100 })]}
        contacts={[]}
        loading={false}
        onRetryDirectMessage={vi.fn()}
      />
    );

    expect(screen.queryByText(/Failed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
