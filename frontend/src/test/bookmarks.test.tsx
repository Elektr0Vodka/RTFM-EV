import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookmarkEntry, Message, MessageBookmarkPayload } from '../types';

const mockGetBookmarks = vi.fn<(...args: unknown[]) => Promise<BookmarkEntry[]>>();
const mockSetBookmark = vi.fn<(id: number, note: string | null) => Promise<BookmarkEntry>>();
const mockRemoveBookmark = vi.fn<(id: number) => Promise<{ status: string; removed: boolean }>>();

vi.mock('../api', () => ({
  api: {
    getBookmarks: (...args: unknown[]) => mockGetBookmarks(...args),
    setBookmark: (id: number, note: string | null) => mockSetBookmark(id, note),
    removeBookmark: (id: number) => mockRemoveBookmark(id),
    bookmarkExportUrl: (format: string) => `./api/bookmarks/export?format=${format}`,
  },
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
}));

import { BookmarksView } from '../components/BookmarksView';
import { MessageRowActions } from '../components/MessageRowActions';
import { emitBookmarkEvent, subscribeBookmarkEvents } from '../utils/bookmarkEvents';
import { saveMessageBookmarkNote, toggleMessageBookmark } from '../utils/bookmarkActions';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'ABC123',
    text: 'Bob: meet at the mast',
    sender_timestamp: 1700000000,
    received_at: 1700000000,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Bob',
    bookmarked: true,
    bookmark_note: null,
    ...overrides,
  };
}

function entry(overrides: Partial<BookmarkEntry> = {}): BookmarkEntry {
  return {
    message: message(),
    note: 'antenna site',
    created_at: 1700000100,
    conversation_name: '#ops',
    ...overrides,
  };
}

function captureEvents(): MessageBookmarkPayload[] {
  const seen: MessageBookmarkPayload[] = [];
  subscribeBookmarkEvents((p) => seen.push(p));
  return seen;
}

describe('MessageRowActions bookmark', () => {
  it('bookmarks an unbookmarked message', () => {
    const onToggle = vi.fn();
    render(<MessageRowActions onToggleBookmark={onToggle} onSaveBookmarkNote={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Bookmark note' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('offers remove and a note editor once bookmarked', () => {
    const onSave = vi.fn();
    render(
      <MessageRowActions
        bookmarked
        bookmarkNote="old"
        onToggleBookmark={vi.fn()}
        onSaveBookmarkNote={onSave}
      />
    );
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark note' }));
    const box = screen.getByRole('textbox', { name: 'Note' });
    expect(box).toHaveValue('old');
    fireEvent.change(box, { target: { value: '  new note  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('new note');
  });

  it('saves an emptied note as null', () => {
    const onSave = vi.fn();
    render(
      <MessageRowActions
        bookmarked
        bookmarkNote="old"
        onToggleBookmark={vi.fn()}
        onSaveBookmarkNote={onSave}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});

describe('bookmark actions', () => {
  beforeEach(() => {
    mockSetBookmark.mockReset();
    mockRemoveBookmark.mockReset();
  });

  it('toggles on and off and tells this tab right away', async () => {
    const seen = captureEvents();
    mockSetBookmark.mockResolvedValue(entry({ note: null }));
    await toggleMessageBookmark(message({ bookmarked: false }));
    expect(mockSetBookmark).toHaveBeenCalledWith(1, null);
    mockRemoveBookmark.mockResolvedValue({ status: 'ok', removed: true });
    await toggleMessageBookmark(message({ bookmarked: true }));
    expect(mockRemoveBookmark).toHaveBeenCalledWith(1);
    expect(seen.map((p) => p.bookmarked)).toEqual([true, false]);
    expect(seen[0]).toMatchObject({ message_id: 1, conversation_key: 'ABC123', note: null });
  });

  it('saves a note and passes the stored note along', async () => {
    const seen = captureEvents();
    mockSetBookmark.mockResolvedValue(entry({ note: 'stored' }));
    await saveMessageBookmarkNote(message(), 'stored');
    expect(mockSetBookmark).toHaveBeenCalledWith(1, 'stored');
    expect(seen[seen.length - 1]).toMatchObject({ bookmarked: true, note: 'stored' });
  });
});

describe('BookmarksView', () => {
  beforeEach(() => {
    mockGetBookmarks.mockReset();
    mockSetBookmark.mockReset();
    mockRemoveBookmark.mockReset();
  });

  it('lists bookmarks with note and export links, and opens one on click', async () => {
    mockGetBookmarks.mockResolvedValue([entry()]);
    const onSelect = vi.fn();
    render(<BookmarksView contacts={[]} channels={[]} onSelect={onSelect} />);

    expect(await screen.findByText('meet at the mast')).toBeInTheDocument();
    expect(screen.getByText('antenna site')).toBeInTheDocument();
    expect(screen.getByText('#ops')).toBeInTheDocument();
    expect(screen.getByTitle('Export all bookmarks as CSV')).toHaveAttribute(
      'href',
      './api/bookmarks/export?format=csv'
    );
    expect(screen.getByTitle('Export all bookmarks as Markdown')).toHaveAttribute(
      'href',
      './api/bookmarks/export?format=md'
    );

    fireEvent.click(screen.getByText('meet at the mast').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '#ops');
  });

  it('shows a bookmarked picture as a thumbnail, not its im3: text', async () => {
    mockGetBookmarks.mockResolvedValue([
      entry({
        message: message({
          text: 'Bob: im3:abcdef',
          mcoimg: {
            format: 'mcoimg_v3',
            source: 'text',
            ok: true,
            width: 8,
            height: 4,
            byte_length: 12,
            png_base64: 'iVBORw0KGgo=',
          },
        }),
      }),
    ]);
    render(<BookmarksView contacts={[]} channels={[]} onSelect={vi.fn()} />);
    const img = await screen.findByTestId('bookmark-picture');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(screen.queryByText(/im3:abcdef/)).toBeNull();
  });

  it('scopes to one conversation and says so when empty', async () => {
    mockGetBookmarks.mockResolvedValue([]);
    render(
      <BookmarksView
        embedded
        contacts={[]}
        channels={[]}
        conversationKey="ABC123"
        onSelect={vi.fn()}
      />
    );
    expect(await screen.findByText('No bookmarks in this chat.')).toBeInTheDocument();
    expect(mockGetBookmarks.mock.calls[0][0]).toMatchObject({ conversation_key: 'ABC123' });
    expect(screen.queryByTitle('Export all bookmarks as CSV')).toBeNull();
  });

  it('removes a bookmark and drops it from the list', async () => {
    mockGetBookmarks.mockResolvedValue([entry()]);
    mockRemoveBookmark.mockResolvedValue({ status: 'ok', removed: true });
    render(<BookmarksView contacts={[]} channels={[]} onSelect={vi.fn()} />);
    await screen.findByText('meet at the mast');
    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }));
    await waitFor(() => expect(screen.queryByText('meet at the mast')).toBeNull());
    expect(mockRemoveBookmark).toHaveBeenCalledWith(1);
  });

  it('edits the note', async () => {
    mockGetBookmarks.mockResolvedValue([entry()]);
    mockSetBookmark.mockResolvedValue(entry({ note: 'changed' }));
    render(<BookmarksView contacts={[]} channels={[]} onSelect={vi.fn()} />);
    await screen.findByText('meet at the mast');
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('changed')).toBeInTheDocument();
    expect(mockSetBookmark).toHaveBeenCalledWith(1, 'changed');
  });

  it('follows changes from other tabs', async () => {
    mockGetBookmarks.mockResolvedValue([entry()]);
    render(<BookmarksView contacts={[]} channels={[]} onSelect={vi.fn()} />);
    await screen.findByText('meet at the mast');

    act(() =>
      emitBookmarkEvent({
        message_id: 1,
        type: 'CHAN',
        conversation_key: 'ABC123',
        bookmarked: true,
        note: 'from elsewhere',
      })
    );
    expect(await screen.findByText('from elsewhere')).toBeInTheDocument();

    act(() =>
      emitBookmarkEvent({
        message_id: 1,
        type: 'CHAN',
        conversation_key: 'ABC123',
        bookmarked: false,
        note: null,
      })
    );
    await waitFor(() => expect(screen.queryByText('meet at the mast')).toBeNull());
  });
});
