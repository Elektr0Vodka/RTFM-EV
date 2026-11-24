import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookmarkEntry, Message } from '../types';

const mockGetBookmarks = vi.fn<(...args: unknown[]) => Promise<BookmarkEntry[]>>();
const mockSetBookmark = vi.fn<(id: number, note: string | null) => Promise<BookmarkEntry>>();

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBookmarks: (...args: unknown[]) => mockGetBookmarks(...args),
      setBookmark: (id: number, note: string | null) => mockSetBookmark(id, note),
    },
  };
});

import { MessageList } from '../components/MessageList';

const KEY = 'C3B889530D4F02DB5662EA13C417F530';

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: KEY,
    text: 'Alice: hello world',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Alice',
    ...overrides,
  };
}

describe('MessageList bookmarks', () => {
  beforeEach(() => {
    mockGetBookmarks.mockReset();
    mockSetBookmark.mockReset();
  });

  it('marks a bookmarked message with its note as tooltip', () => {
    render(
      <MessageList
        messages={[createMessage({ bookmarked: true, bookmark_note: 'remember this' })]}
        contacts={[]}
        loading={false}
      />
    );
    expect(screen.getByRole('img', { name: 'Bookmarked' })).toHaveAttribute(
      'title',
      'remember this'
    );
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument();
  });

  it('bookmarks a message from its row action', async () => {
    mockSetBookmark.mockResolvedValue({
      message: createMessage({ bookmarked: true }),
      note: null,
      created_at: 1,
      conversation_name: null,
    });
    render(<MessageList messages={[createMessage()]} contacts={[]} loading={false} />);
    expect(screen.queryByRole('img', { name: 'Bookmarked' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }));
    });
    expect(mockSetBookmark).toHaveBeenCalledWith(1, null);
  });

  it('"Bookmarked only" shows this chat\'s bookmarks', async () => {
    mockGetBookmarks.mockResolvedValue([
      {
        message: createMessage({ id: 7, text: 'Alice: old pinned thing', bookmarked: true }),
        note: null,
        created_at: 1,
        conversation_name: '#ops',
      },
    ]);
    render(<MessageList messages={[createMessage()]} contacts={[]} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarked only' }));
    expect(await screen.findByText('old pinned thing')).toBeInTheDocument();
    expect(mockGetBookmarks.mock.calls[0][0]).toMatchObject({ conversation_key: KEY });
    expect(screen.getByTestId('chat-bookmarks')).toBeInTheDocument();

    fireEvent.click(screen.getByText('old pinned thing').closest('button')!);
    await waitFor(() => expect(screen.queryByTestId('chat-bookmarks')).toBeNull());
  });
});
