import { api } from '../api';
import type { Message } from '../types';
import { emitBookmarkEvent } from './bookmarkEvents';

/**
 * Bookmark a message, or remove its bookmark. Local only: nothing is sent over
 * the radio. The change is applied in this tab at once; the server's WS event
 * repeats it for every open tab.
 */
export async function toggleMessageBookmark(message: Message): Promise<void> {
  if (message.bookmarked) {
    await api.removeBookmark(message.id);
    emitBookmarkEvent({
      message_id: message.id,
      type: message.type,
      conversation_key: message.conversation_key,
      bookmarked: false,
      note: null,
    });
    return;
  }
  const entry = await api.setBookmark(message.id, null);
  emitBookmarkEvent({
    message_id: message.id,
    type: message.type,
    conversation_key: message.conversation_key,
    bookmarked: true,
    note: entry.note,
  });
}

/** Save (or clear, with null) the note on a bookmarked message. */
export async function saveMessageBookmarkNote(
  message: Message,
  note: string | null
): Promise<void> {
  const entry = await api.setBookmark(message.id, note);
  emitBookmarkEvent({
    message_id: message.id,
    type: message.type,
    conversation_key: message.conversation_key,
    bookmarked: true,
    note: entry.note,
  });
}
