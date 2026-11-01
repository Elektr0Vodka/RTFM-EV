import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';

const mockGetMentions = vi.fn<(...args: unknown[]) => Promise<Message[]>>();

vi.mock('../api', () => ({
  api: {
    getMentions: (...args: unknown[]) => mockGetMentions(...args),
  },
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
}));

import { MentionsView } from '../components/MentionsView';

function mention(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'ABC123',
    text: 'Bob: hi @[MyNode] are you there',
    sender_timestamp: 1700000000,
    received_at: 1700000000,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Bob',
    ...overrides,
  };
}

const channels = [
  {
    key: 'ABC123',
    name: '#ops',
    is_hashtag: true,
    on_radio: false,
    last_read_at: null,
    favorite: false,
    muted: false,
  },
];

describe('MentionsView', () => {
  beforeEach(() => {
    mockGetMentions.mockReset();
  });

  it('lists mentions, marks the mention and opens the message on click', async () => {
    mockGetMentions.mockResolvedValue([mention()]);
    const onNavigateToMessage = vi.fn();
    render(
      <MentionsView
        contacts={[]}
        channels={channels}
        radioName="MyNode"
        onNavigateToMessage={onNavigateToMessage}
      />
    );

    const marked = await screen.findByText('@[MyNode]');
    expect(marked.tagName).toBe('MARK');
    expect(screen.getByText('#ops')).toBeInTheDocument();

    fireEvent.click(marked.closest('button')!);
    expect(onNavigateToMessage).toHaveBeenCalledWith({
      id: 1,
      type: 'CHAN',
      conversation_key: 'ABC123',
      conversation_name: '#ops',
    });
  });

  it('says so when nobody mentioned you', async () => {
    mockGetMentions.mockResolvedValue([]);
    render(
      <MentionsView contacts={[]} channels={[]} radioName="MyNode" onNavigateToMessage={vi.fn()} />
    );
    expect(await screen.findByText('Nobody has mentioned @[MyNode] yet.')).toBeInTheDocument();
  });

  it('asks for a radio when its name is unknown', async () => {
    mockGetMentions.mockResolvedValue([]);
    render(
      <MentionsView contacts={[]} channels={[]} radioName={null} onNavigateToMessage={vi.fn()} />
    );
    expect(
      await screen.findByText('Connect a radio to see the messages that mention it.')
    ).toBeInTheDocument();
  });

  it('loads older mentions from the last one shown', async () => {
    const page = Array.from({ length: 50 }, (_, i) =>
      mention({ id: 100 - i, received_at: 2000 - i })
    );
    mockGetMentions.mockResolvedValueOnce(page).mockResolvedValueOnce([mention({ id: 1 })]);
    render(
      <MentionsView
        contacts={[]}
        channels={channels}
        radioName="MyNode"
        onNavigateToMessage={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more results' }));
    await waitFor(() => expect(mockGetMentions).toHaveBeenCalledTimes(2));
    expect(mockGetMentions.mock.calls[1][0]).toEqual({ limit: 50, before: 1951, before_id: 51 });
  });
});
