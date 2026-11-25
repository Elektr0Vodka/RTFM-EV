import { useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkMinus, Download, NotebookPen, RefreshCw } from 'lucide-react';

import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type { BookmarkEntry, Channel, Contact, Message, MessageImage } from '../types';
import { subscribeBookmarkEvents } from '../utils/bookmarkEvents';
import { saveMessageBookmarkNote, toggleMessageBookmark } from '../utils/bookmarkActions';
import { formatTime } from '../utils/messageParser';
import { BOOKMARK_NOTE_MAX_LENGTH } from './MessageRowActions';
import { Button } from './ui/button';
import { toast } from './ui/sonner';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

export interface BookmarksViewProps {
  contacts: Contact[];
  channels: Channel[];
  /** Only this conversation's bookmarks (the per-chat "Bookmarked only" view). */
  conversationKey?: string;
  /** Open a bookmarked message (jump to it in its conversation). */
  onSelect: (message: Message, conversationName: string) => void;
  /** Hide the heading bar (when embedded in a chat). */
  embedded?: boolean;
}

/** Bookmarked messages, newest bookmark first, with notes, remove and export. */
export function BookmarksView({
  contacts,
  channels,
  conversationKey,
  onSelect,
  embedded = false,
}: BookmarksViewProps) {
  const t = useT();
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const entriesRef = useRef<BookmarkEntry[]>([]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const load = useCallback(
    async (after: BookmarkEntry | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const page = await api.getBookmarks(
          {
            limit: PAGE_SIZE,
            ...(after && { before: after.created_at, before_id: after.message.id }),
            ...(conversationKey && { conversation_key: conversationKey }),
          },
          controller.signal
        );
        if (abortRef.current !== controller) return;
        setEntries((prev) => {
          if (!after) return page;
          const seen = new Set(prev.map((e) => e.message.id));
          return [...prev, ...page.filter((e) => !seen.has(e.message.id))];
        });
        setHasMore(page.length >= PAGE_SIZE);
      } catch (err) {
        if (!isAbortError(err)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    },
    [conversationKey]
  );

  useEffect(() => {
    void load(null);
    return () => abortRef.current?.abort();
  }, [load]);

  // Another tab (or a chat row) changed a bookmark: drop removed ones, update
  // notes in place, and reload the first page for new ones.
  useEffect(
    () =>
      subscribeBookmarkEvents((payload) => {
        if (conversationKey && payload.conversation_key !== conversationKey) return;
        if (!payload.bookmarked) {
          setEntries((prev) => prev.filter((e) => e.message.id !== payload.message_id));
          return;
        }
        if (!entriesRef.current.some((e) => e.message.id === payload.message_id)) {
          void load(null);
          return;
        }
        setEntries((prev) =>
          prev.map((e) => (e.message.id === payload.message_id ? { ...e, note: payload.note } : e))
        );
      }),
    [conversationKey, load]
  );

  const conversationName = useCallback(
    (entry: BookmarkEntry): string => {
      if (entry.conversation_name) return entry.conversation_name;
      const message = entry.message;
      if (message.type === 'CHAN') {
        const key = message.conversation_key.toUpperCase();
        return (
          channels.find((c) => c.key.toUpperCase() === key)?.name ??
          message.conversation_key.slice(0, 8)
        );
      }
      const key = message.conversation_key.toLowerCase();
      return (
        contacts.find((c) => c.public_key.toLowerCase() === key)?.name ??
        message.conversation_key.slice(0, 12)
      );
    },
    [channels, contacts]
  );

  const remove = async (entry: BookmarkEntry) => {
    try {
      await toggleMessageBookmark({ ...entry.message, bookmarked: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const saveNote = async (entry: BookmarkEntry) => {
    setEditingId(null);
    try {
      await saveMessageBookmarkNote(entry.message, noteDraft.trim() || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const actionClass =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex flex-col h-full">
      {!embedded && (
        <h2 className="flex justify-between items-center gap-2 px-4 py-2.5 border-b border-border font-semibold text-base">
          <span>{t('nav_bookmarks')}</span>
          <span className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={api.bookmarkExportUrl('md')} download title={t('bookmarks_export_md')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs">{t('bookmarks_export_md_short')}</span>
              </a>
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={api.bookmarkExportUrl('csv')} download title={t('bookmarks_export_csv')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs">{t('bookmarks_export_csv_short')}</span>
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void load(null)}
              disabled={loading}
              aria-label={t('bookmarks_refresh')}
              title={t('bookmarks_refresh')}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </span>
        </h2>
      )}

      <div className="flex-1 overflow-y-auto">
        {!loading && !error && entries.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {t(conversationKey ? 'bookmarks_empty_chat' : 'bookmarks_empty')}
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        {entries.map((entry) => {
          const message = entry.message;
          const name = conversationName(entry);
          const prefix = message.sender_name ? `${message.sender_name}: ` : null;
          const body =
            prefix && message.text.startsWith(prefix)
              ? message.text.slice(prefix.length)
              : message.text;
          const sender = message.outgoing ? t('bookmarks_sender_you') : message.sender_name;
          return (
            <div
              key={message.id}
              className="flex items-start gap-1 border-b border-border/50 px-4 py-3"
              data-testid="bookmark-row"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left rounded hover:bg-accent/50 transition-colors focus-visible:outline-hidden focus-visible:bg-accent/50"
                onClick={() => onSelect(message, name)}
              >
                <div className="flex items-center gap-2 mb-1">
                  {!conversationKey && (
                    <>
                      <span
                        className={cn(
                          'text-[0.625rem] font-medium px-1.5 py-0.5 rounded',
                          message.type === 'CHAN'
                            ? 'bg-primary/20 text-primary'
                            : 'bg-secondary text-secondary-foreground'
                        )}
                      >
                        {message.type === 'CHAN'
                          ? t('packet_context_title_channel')
                          : t('map_packet_legend_dm')}
                      </span>
                      <span className="text-xs font-medium text-foreground truncate">{name}</span>
                    </>
                  )}
                  <span className="text-[0.6875rem] text-muted-foreground ml-auto shrink-0">
                    {formatTime(message.received_at)}
                  </span>
                </div>
                <div className="text-[0.8125rem] text-foreground/80 line-clamp-3 wrap-break-word">
                  {sender && <span className="text-muted-foreground">{sender}: </span>}
                  {message.mcoimg ? <BookmarkPicture image={message.mcoimg} /> : body}
                </div>
                {entry.note && editingId !== message.id && (
                  <div className="mt-1 text-xs italic text-muted-foreground wrap-break-word">
                    {entry.note}
                  </div>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className={actionClass}
                  aria-label={t('chat_bookmark_note_action')}
                  title={t('chat_bookmark_note_action')}
                  onClick={() => {
                    setNoteDraft(entry.note ?? '');
                    setEditingId(editingId === message.id ? null : message.id);
                  }}
                >
                  <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={actionClass}
                  aria-label={t('chat_remove_bookmark_action')}
                  title={t('chat_remove_bookmark_action')}
                  onClick={() => void remove(entry)}
                >
                  <BookmarkMinus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}

        {editingId !== null && (
          <NoteEditor
            value={noteDraft}
            onChange={setNoteDraft}
            onCancel={() => setEditingId(null)}
            onSave={() => {
              const entry = entries.find((e) => e.message.id === editingId);
              if (entry) void saveNote(entry);
            }}
          />
        )}

        {loading && (
          <div className="p-4 text-center text-muted-foreground text-sm" role="status">
            {t('common_loading')}
          </div>
        )}

        {!loading && hasMore && entries.length > 0 && (
          <div className="p-3 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(entries[entries.length - 1])}
            >
              {t('search_load_more')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** An MCOimg picture as a small thumbnail; the raw `im3:` text is never shown. */
function BookmarkPicture({ image }: { image: MessageImage }) {
  const t = useT();
  if (!image.ok || !image.png_base64 || !image.width || !image.height) {
    return <span className="italic text-muted-foreground">{t('chat_mcoimg_undecodable')}</span>;
  }
  const size = { width: image.width, height: image.height };
  return (
    <img
      src={`data:image/png;base64,${image.png_base64}`}
      alt={t('chat_mcoimg_alt', size)}
      data-testid="bookmark-picture"
      className="mt-1 block h-16 w-auto rounded-sm"
      style={{ imageRendering: 'pixelated' }}
      draggable={false}
    />
  );
}

function NoteEditor({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <form
      className="sticky bottom-0 flex flex-col gap-1.5 border-t border-border bg-popover p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <textarea
        className="min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1 text-[0.8125rem]"
        aria-label={t('chat_bookmark_note_label')}
        placeholder={t('chat_bookmark_note_placeholder')}
        maxLength={BOOKMARK_NOTE_MAX_LENGTH}
        value={value}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common_cancel')}
        </Button>
        <Button type="submit" size="sm">
          {t('chat_bookmark_note_save')}
        </Button>
      </div>
    </form>
  );
}
