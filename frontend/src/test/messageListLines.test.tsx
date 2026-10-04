import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

function renderLines(messages: Message[], props: Partial<Parameters<typeof MessageList>[0]> = {}) {
  return render(
    <MessageLayoutProvider value="lines">
      <MessageList messages={messages} contacts={[]} loading={false} {...props} />
    </MessageLayoutProvider>
  );
}

describe('MessageList classic lines layout', () => {
  it('renders a row as [time] <Nick> text without a bubble', () => {
    const msg = createMessage();
    const { container } = renderLines([msg]);

    const row = container.querySelector(`[data-message-id="${msg.id}"]`)!;
    expect(row.textContent).toContain(`[${formatTime(msg.received_at)}]`);
    expect(row.textContent).toContain('<Alice>');
    expect(row.textContent).toContain('hello world');
    expect(container.querySelector('.bg-msg-incoming')).toBeNull();
  });

  it('repeats the nick on every line instead of grouping by sender', () => {
    const { container } = renderLines([
      createMessage({ id: 1, text: 'Alice: one' }),
      createMessage({ id: 2, text: 'Alice: two', received_at: 1700000002 }),
    ]);
    expect(container.querySelector('[data-message-id="2"]')!.textContent).toContain('<Alice>');
  });

  it('shows the radio name for own messages, with the delivery status', () => {
    const { container } = renderLines(
      [createMessage({ text: 'Mike: sent', outgoing: true, acked: 3 })],
      { radioName: 'Mike' }
    );
    const row = container.querySelector('[data-message-id="1"]')!;
    expect(row.textContent).toContain('<Mike>');
    expect(row.textContent).toContain('✓3');
    expect(container.querySelector('.bg-msg-outgoing')).toBeNull();
  });

  it('keeps both sender actions: nick mentions, avatar dot opens contact info', async () => {
    const user = userEvent.setup();
    const onSenderClick = vi.fn();
    const onOpenContactInfo = vi.fn();
    renderLines([createMessage()], { onSenderClick, onOpenContactInfo });

    await user.click(screen.getByText('Alice'));
    expect(onSenderClick).toHaveBeenCalledWith('Alice');

    await user.click(screen.getByRole('button', { name: /view info for alice/i }));
    expect(onOpenContactInfo).toHaveBeenCalledWith('name:Alice', true);
  });

  it('keeps the row actions', () => {
    renderLines([createMessage()], { onReplyToMessage: vi.fn(), onDeleteMessage: vi.fn() });
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('is not used unless a provider asks for it', () => {
    const { container } = render(
      <MessageList messages={[createMessage()]} contacts={[]} loading={false} />
    );
    expect(container.querySelector('.bg-msg-incoming')).not.toBeNull();
    expect(container.querySelector('[data-message-id="1"]')!.textContent).not.toContain('<Alice>');
  });
});
