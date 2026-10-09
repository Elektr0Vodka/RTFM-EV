import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageList } from '../components/MessageList';
import { MessageLayoutProvider } from '../contexts/MessageLayoutContext';
import { formatTime } from '../utils/messageParser';
import type { Message } from '../types';

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

function renderCards(messages: Message[], props: Partial<Parameters<typeof MessageList>[0]> = {}) {
  return render(
    <MessageLayoutProvider value="cards">
      <MessageList messages={messages} contacts={[]} loading={false} {...props} />
    </MessageLayoutProvider>
  );
}

describe('MessageList cards layout', () => {
  it('renders a message as a card with sender, time and text', () => {
    const msg = createMessage();
    const { container } = renderCards([msg]);

    const card = container.querySelector(`[data-message-id="${msg.id}"]`)!;
    expect(card).toHaveClass('msg-card', 'bg-msg-incoming');
    expect(card.textContent).toContain('Alice');
    expect(card.textContent).toContain(formatTime(msg.received_at));
    expect(card.textContent).toContain('hello world');
  });

  it('gives every card its own header instead of grouping by sender', () => {
    const { container } = renderCards([
      createMessage({ id: 1, text: 'Alice: one' }),
      createMessage({ id: 2, text: 'Alice: two', received_at: 1700000002 }),
    ]);

    const second = container.querySelector('[data-message-id="2"]')!;
    expect(second.textContent).toContain('Alice');
    expect(second.textContent).toContain(formatTime(1700000002));
  });

  it('shows the hop count as a chip without brackets, still opening the path', () => {
    const msg = createMessage({
      paths: [{ path: 'aabb', received_at: 1700000001, path_len: 2 }],
    });
    renderCards([msg]);

    const chip = screen.getByRole('button', { name: /view path/i });
    expect(chip.textContent).toBe('2');
    expect(chip.textContent).not.toContain('(');
  });

  it('tints an outgoing card and shows its delivery mark in the chip row', () => {
    const msg = createMessage({ outgoing: true, acked: 2, text: 'on my way' });
    const { container } = renderCards([msg]);

    const card = container.querySelector(`[data-message-id="${msg.id}"]`)!;
    expect(card).toHaveClass('msg-card', 'bg-msg-outgoing');
    expect(card.textContent).toContain('You');
    expect(card.textContent).toContain('✓2');
    expect(card.querySelector('.avatar-action-button')).toBeNull();
  });

  it('leaves the bubble layout alone without the provider', () => {
    const msg = createMessage();
    const { container } = render(<MessageList messages={[msg]} contacts={[]} loading={false} />);

    expect(container.querySelector('.msg-card')).toBeNull();
    expect(container.querySelector('.bg-msg-incoming')).not.toBeNull();
  });
});
