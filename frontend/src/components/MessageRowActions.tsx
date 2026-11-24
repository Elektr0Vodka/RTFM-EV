import { useState } from 'react';
import {
  Bookmark,
  BookmarkMinus,
  Bot,
  Mail,
  NotebookPen,
  Reply,
  RotateCcw,
  ShieldAlert,
  Share2,
  ShieldCheck,
  SmilePlus,
  Trash2,
  UserCheck,
} from 'lucide-react';

import { useT } from '../i18n';

// Same quick set other MeshCore clients lead with; one tap sends the reaction.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

/** Longest bookmark note the server accepts (BOOKMARK_NOTE_MAX_LENGTH). */
export const BOOKMARK_NOTE_MAX_LENGTH = 500;

/**
 * Hover actions for a chat message: react, reply, retry a failed DM, mark unread,
 * bookmark (with a note), tell Spam Guard it is (not) spam, or delete.
 */
export function MessageRowActions({
  onReact,
  onReply,
  onRetry,
  onMarkUnread,
  bookmarked = false,
  bookmarkNote = null,
  onToggleBookmark,
  onSaveBookmarkNote,
  onMarkSpam,
  onNotSpam,
  onAddToBotList,
  onNotABot,
  onShare,
  onDelete,
}: {
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  /** Only passed for a failed outgoing DM. Sends a new copy, so it transmits. */
  onRetry?: () => void | Promise<void>;
  onMarkUnread?: () => void;
  /** Whether the message is bookmarked; picks the bookmark button's action. */
  bookmarked?: boolean;
  bookmarkNote?: string | null;
  /** Bookmark the message, or remove its bookmark. Local only. */
  onToggleBookmark?: () => void;
  /** Save the bookmark note (null clears it). Only offered while bookmarked. */
  onSaveBookmarkNote?: (note: string | null) => void;
  /** Spam Guard feedback: blocks this text and flags the message. */
  onMarkSpam?: () => void;
  /** Spam Guard feedback: trusts the sender and clears the flag. */
  onNotSpam?: () => void;
  /** Bot lists: put this sender on one of the user's own lists. */
  onAddToBotList?: () => void;
  /** Bot lists: never treat this sender name as a bot. */
  onNotABot?: () => void;
  /** Share an image of how the message travelled (only for messages with paths). */
  onShare?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  if (
    !onReact &&
    !onReply &&
    !onRetry &&
    !onMarkUnread &&
    !onToggleBookmark &&
    !onMarkSpam &&
    !onNotSpam &&
    !onAddToBotList &&
    !onNotABot &&
    !onShare &&
    !onDelete
  )
    return null;

  const buttonClass =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="relative flex items-center gap-0.5 self-center px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      {onReact && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_react_action')}
          title={t('chat_react_action')}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_retry_action')}
          title={t('chat_retry_action')}
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onReply && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_reply_action')}
          title={t('chat_reply_action')}
          onClick={onReply}
        >
          <Reply className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onMarkUnread && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_mark_unread_action')}
          title={t('chat_mark_unread_action')}
          onClick={onMarkUnread}
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onToggleBookmark && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t(bookmarked ? 'chat_remove_bookmark_action' : 'chat_bookmark_action')}
          title={t(bookmarked ? 'chat_remove_bookmark_action' : 'chat_bookmark_action')}
          onClick={onToggleBookmark}
        >
          {bookmarked ? (
            <BookmarkMinus className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
      {bookmarked && onSaveBookmarkNote && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_bookmark_note_action')}
          title={t('chat_bookmark_note_action')}
          aria-expanded={noteOpen}
          onClick={() => {
            setNoteDraft(bookmarkNote ?? '');
            setNoteOpen((open) => !open);
          }}
        >
          <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onMarkSpam && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_mark_spam_action')}
          title={t('chat_mark_spam_action')}
          onClick={onMarkSpam}
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onNotSpam && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_not_spam_action')}
          title={t('chat_not_spam_action')}
          onClick={onNotSpam}
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onAddToBotList && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_add_to_bot_list_action')}
          title={t('chat_add_to_bot_list_action')}
          onClick={onAddToBotList}
        >
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onNotABot && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_not_a_bot_action')}
          title={t('chat_not_a_bot_action')}
          onClick={onNotABot}
        >
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onShare && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('share_message_title')}
          title={t('share_message_title')}
          onClick={onShare}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className={`${buttonClass} hover:bg-destructive/10 hover:text-destructive`}
          aria-label={t('chat_delete_message_action')}
          title={t('chat_delete_message_action')}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {noteOpen && bookmarked && onSaveBookmarkNote && (
        <form
          className="absolute bottom-full right-0 z-20 mb-1 flex w-64 flex-col gap-1.5 rounded-md border border-border bg-popover p-2 shadow-md"
          onSubmit={(event) => {
            event.preventDefault();
            setNoteOpen(false);
            onSaveBookmarkNote(noteDraft.trim() || null);
          }}
        >
          <textarea
            className="min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1 text-[0.8125rem]"
            aria-label={t('chat_bookmark_note_label')}
            placeholder={t('chat_bookmark_note_placeholder')}
            maxLength={BOOKMARK_NOTE_MAX_LENGTH}
            value={noteDraft}
            autoFocus
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNoteOpen(false);
            }}
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs hover:bg-accent"
              onClick={() => setNoteOpen(false)}
            >
              {t('common_cancel')}
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              {t('chat_bookmark_note_save')}
            </button>
          </div>
        </form>
      )}
      {pickerOpen && onReact && (
        <div className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-md">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-full px-1 text-lg leading-none hover:bg-accent"
              aria-label={t('chat_react_with', { emoji })}
              onClick={() => {
                setPickerOpen(false);
                onReact(emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
