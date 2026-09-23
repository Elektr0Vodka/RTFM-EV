import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import {
  getLastMessageTimes,
  setLastMessageTime,
  renameConversationTimeKey,
  getStateKey,
  type ConversationTimes,
} from '../utils/conversationState';
import type { Channel, Contact, Conversation, Message, UnreadCounts } from '../types';
import { takePrefetchOrFetch } from '../prefetch';

type UnreadTrackedConversation = Conversation & { type: 'channel' | 'contact' };

function isUnreadTrackedConversation(
  conversation: Conversation | null
): conversation is UnreadTrackedConversation {
  return conversation?.type === 'channel' || conversation?.type === 'contact';
}

interface UseUnreadCountsResult {
  unreadCounts: Record<string, number>;
  /** Tracks which conversations have unread messages that mention the user */
  mentions: Record<string, boolean>;
  lastMessageTimes: ConversationTimes;
  unreadLastReadAts: Record<string, number | null>;
  /** stateKey -> id of the oldest unread message, for placing the unread divider. */
  firstUnreadIds: Record<string, number | null>;
  recordMessageEvent: (args: {
    msg: Message;
    activeConversation: boolean;
    isNewMessage: boolean;
    hasMention?: boolean;
  }) => void;
  renameConversationState: (oldStateKey: string, newStateKey: string) => void;
  removeConversationState: (stateKey: string) => void;
  markAllRead: () => void;
  markConversationsRead: (items: { type: 'channel' | 'contact'; id: string }[]) => void;
  markConversationUnreadFromMessage: (args: {
    type: 'channel' | 'contact';
    id: string;
    messageId: number;
  }) => Promise<void>;
  refreshUnreads: () => Promise<void>;
}

export function useUnreadCounts(
  channels: Channel[],
  contacts: Contact[],
  activeConversation: Conversation | null
): UseUnreadCountsResult {
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentions, setMentions] = useState<Record<string, boolean>>({});
  const [lastMessageTimes, setLastMessageTimes] = useState<ConversationTimes>(getLastMessageTimes);
  const [unreadLastReadAts, setUnreadLastReadAts] = useState<Record<string, number | null>>({});
  const [firstUnreadIds, setFirstUnreadIds] = useState<Record<string, number | null>>({});

  // Track active conversation via ref so applyUnreads can filter without
  // destabilizing the callback chain (avoids re-creating fetchUnreads on
  // every conversation switch).
  const activeConvRef = useRef(activeConversation);
  activeConvRef.current = activeConversation;

  // stateKey of a conversation that was just "marked unread from here" while
  // it is still the open/active conversation. The app normally re-marks the
  // active conversation as read every time it re-fetches unreads (WS
  // reconnect, mute toggle, etc.) - see fetchUnreads below - which would
  // otherwise immediately undo the manual unread mark. While a key is
  // suppressed here, that auto re-mark-read is skipped for it. Suppression is
  // lifted the next time the user actually navigates away and back to that
  // conversation (see the activeConversation effect below), which is the
  // point where "viewing it again" should legitimately clear the unread mark.
  const suppressAutoReadKeyRef = useRef<string | null>(null);
  // stateKey of the conversation the previous run of the activeConversation
  // effect saw, used to tell a genuine navigation apart from an incidental
  // re-render with a new activeConversation object for the same conversation.
  const prevActiveKeyRef = useRef<string | null>(null);

  // Apply unreads data to state, filtering out the active conversation
  // (the user is already viewing it, so its count should stay at 0).
  const applyUnreads = useCallback((data: UnreadCounts) => {
    const ac = activeConvRef.current;
    const activeKey = isUnreadTrackedConversation(ac) ? getStateKey(ac.type, ac.id) : null;

    if (activeKey) {
      const counts = { ...data.counts };
      const mentionsData = { ...data.mentions };
      delete counts[activeKey];
      delete mentionsData[activeKey];
      setUnreadCounts(counts);
      setMentions(mentionsData);
    } else {
      setUnreadCounts(data.counts);
      setMentions(data.mentions);
    }

    setUnreadLastReadAts(data.last_read_ats);
    setFirstUnreadIds(data.first_unread_ids ?? {});

    if (Object.keys(data.last_message_times).length > 0) {
      for (const [key, ts] of Object.entries(data.last_message_times)) {
        setLastMessageTime(key, ts);
      }
      setLastMessageTimes(getLastMessageTimes());
    }
  }, []);

  // Fetch unreads from the server-side endpoint.
  // Also re-marks the active conversation as read so the server's last_read_at
  // stays current (otherwise subsequent fetches would re-report the same unreads).
  // Skipped when the active conversation was just "marked unread from here" -
  // otherwise this would immediately undo that manual mark.
  const fetchUnreads = useCallback(async () => {
    try {
      applyUnreads(await api.getUnreads());
    } catch (err) {
      console.error('Failed to fetch unreads:', err);
    }
    const ac = activeConvRef.current;
    if (!isUnreadTrackedConversation(ac)) return;
    const key = getStateKey(ac.type, ac.id);
    if (suppressAutoReadKeyRef.current === key) return;
    if (ac.type === 'channel') {
      api.markChannelRead(ac.id).catch(() => {});
    } else {
      api.markContactRead(ac.id).catch(() => {});
    }
  }, [applyUnreads]);

  // On mount, consume the prefetched promise (started in index.html before
  // React loaded) or fall back to a fresh fetch.
  // Re-fetch when channel/contact count changes mid-session (new sync, cracker
  // channel created, etc.). Skip only the very first run of this effect; after
  // that, any count change should trigger a refresh, even if the other
  // collection is still empty.
  const channelsLen = channels.length;
  const contactsLen = contacts.length;
  const hasObservedCountsRef = useRef(false);
  useEffect(() => {
    takePrefetchOrFetch('unreads', api.getUnreads)
      .then(applyUnreads)
      .catch((err) => {
        console.error('Failed to fetch unreads:', err);
      });
  }, [applyUnreads]);
  useEffect(() => {
    if (!hasObservedCountsRef.current) {
      hasObservedCountsRef.current = true;
      return;
    }
    fetchUnreads();
  }, [channelsLen, contactsLen, fetchUnreads]);

  // Mark conversation as read when user views it
  // Calls server API to persist read state across devices.
  //
  // Guarded so this only runs on a genuine navigation into the conversation
  // (prevActiveKeyRef changes), not on every re-render that produces a new
  // activeConversation object for the *same* conversation (e.g. a contact
  // list refresh). Without that guard, a conversation the user just "marked
  // unread from here" while still viewing it would be re-marked read on the
  // very next unrelated re-render. Leaving the conversation and coming back
  // is a real navigation, so it still clears the manual unread mark, same as
  // opening any other unread conversation.
  useEffect(() => {
    const key = isUnreadTrackedConversation(activeConversation)
      ? getStateKey(activeConversation.type, activeConversation.id)
      : null;
    const isNavigation = prevActiveKeyRef.current !== key;
    prevActiveKeyRef.current = key;

    if (isUnreadTrackedConversation(activeConversation) && key) {
      if (isNavigation && suppressAutoReadKeyRef.current === key) {
        suppressAutoReadKeyRef.current = null;
      } else if (!isNavigation && suppressAutoReadKeyRef.current === key) {
        // Re-render of the same conversation while its unread mark is
        // suppressed: skip re-marking it read.
        return;
      }

      // Update local state immediately for responsive UI
      setUnreadCounts((prev) => {
        if (prev[key]) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return prev;
      });

      // Also clear mentions for this conversation
      setMentions((prev) => {
        if (prev[key]) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return prev;
      });

      // Persist to server (fire-and-forget, errors logged but not blocking)
      if (activeConversation.type === 'channel') {
        api.markChannelRead(activeConversation.id).catch((err) => {
          console.error('Failed to mark channel as read on server:', err);
        });
      } else if (activeConversation.type === 'contact') {
        api.markContactRead(activeConversation.id).catch((err) => {
          console.error('Failed to mark contact as read on server:', err);
        });
      }
    }
  }, [activeConversation]);

  const incrementUnread = useCallback(
    (stateKey: string, messageId: number, hasMention?: boolean) => {
      setUnreadCounts((prev) => ({
        ...prev,
        [stateKey]: (prev[stateKey] || 0) + 1,
      }));
      // Counts move live over the socket, but first_unread_ids only arrives with a
      // full /unreads fetch. Without seeding it here, a conversation that goes from
      // read to unread while the app is open has a count but no boundary, and the
      // divider silently never renders. Only the transition matters: once a
      // boundary exists, later messages are not the *first* unread.
      setFirstUnreadIds((prev) =>
        prev[stateKey] != null ? prev : { ...prev, [stateKey]: messageId }
      );
      if (hasMention) {
        setMentions((prev) => ({
          ...prev,
          [stateKey]: true,
        }));
      }
    },
    []
  );

  const recordMessageEvent = useCallback(
    ({
      msg,
      activeConversation: isActiveConversation,
      isNewMessage,
      hasMention,
    }: {
      msg: Message;
      activeConversation: boolean;
      isNewMessage: boolean;
      hasMention?: boolean;
    }) => {
      let stateKey: string | null = null;
      if (msg.type === 'CHAN' && msg.conversation_key) {
        stateKey = getStateKey('channel', msg.conversation_key);
      } else if (msg.type === 'PRIV' && msg.conversation_key) {
        stateKey = getStateKey('contact', msg.conversation_key);
      }

      if (!stateKey) {
        return;
      }

      const timestamp = msg.received_at || Math.floor(Date.now() / 1000);
      const updated = setLastMessageTime(stateKey, timestamp);
      setLastMessageTimes(updated);

      if (!isActiveConversation && !msg.outgoing && isNewMessage) {
        incrementUnread(stateKey, msg.id, hasMention);
      }
    },
    [incrementUnread]
  );

  const renameConversationState = useCallback((oldStateKey: string, newStateKey: string) => {
    if (oldStateKey === newStateKey) return;

    setUnreadCounts((prev) => {
      if (!(oldStateKey in prev)) return prev;
      const next = { ...prev };
      next[newStateKey] = (next[newStateKey] || 0) + next[oldStateKey];
      delete next[oldStateKey];
      return next;
    });

    setMentions((prev) => {
      if (!(oldStateKey in prev)) return prev;
      const next = { ...prev };
      next[newStateKey] = next[newStateKey] || next[oldStateKey];
      delete next[oldStateKey];
      return next;
    });

    setFirstUnreadIds((prev) => {
      if (!(oldStateKey in prev)) return prev;
      const next = { ...prev };
      next[newStateKey] = next[newStateKey] ?? next[oldStateKey];
      delete next[oldStateKey];
      return next;
    });

    setLastMessageTimes(renameConversationTimeKey(oldStateKey, newStateKey));
  }, []);

  const removeConversationState = useCallback((stateKey: string) => {
    setUnreadCounts((prev) => {
      if (!(stateKey in prev)) return prev;
      const next = { ...prev };
      delete next[stateKey];
      return next;
    });
    setMentions((prev) => {
      if (!(stateKey in prev)) return prev;
      const next = { ...prev };
      delete next[stateKey];
      return next;
    });
    setFirstUnreadIds((prev) => {
      if (!(stateKey in prev)) return prev;
      const next = { ...prev };
      delete next[stateKey];
      return next;
    });
    setUnreadLastReadAts((prev) => {
      if (!(stateKey in prev)) return prev;
      const next = { ...prev };
      delete next[stateKey];
      return next;
    });
  }, []);

  // Mark all conversations as read
  // Calls single bulk API endpoint to persist read state
  const markAllRead = useCallback(() => {
    // Update local state immediately
    setUnreadCounts({});
    setMentions({});
    setUnreadLastReadAts({});
    setFirstUnreadIds({});

    // Persist to server with single bulk request
    api.markAllRead().catch((err) => {
      console.error('Failed to mark all as read on server:', err);
    });
  }, []);

  // Mark a specific set of conversations read (used for per-section clear).
  const markConversationsRead = useCallback(
    (items: { type: 'channel' | 'contact'; id: string }[]) => {
      if (items.length === 0) return;
      const keys = items.map((i) => getStateKey(i.type, i.id));
      const clear = <T>(prev: Record<string, T>): Record<string, T> => {
        let changed = false;
        const next = { ...prev };
        for (const key of keys) {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      };
      setUnreadCounts((prev) => clear(prev));
      setMentions((prev) => clear(prev));
      setFirstUnreadIds((prev) => clear(prev));
      for (const { type, id } of items) {
        if (type === 'channel') {
          api.markChannelRead(id).catch(() => {});
        } else {
          api.markContactRead(id).catch(() => {});
        }
      }
    },
    []
  );

  // Mark a conversation unread from a specific message onward ("mark unread
  // from here"). The server moves last_read_at to just before that message,
  // so it and every incoming message after it count as unread again.
  //
  // If this is the currently open conversation, suppresses the auto
  // re-mark-read that a later /unreads refresh would otherwise perform for
  // it (see fetchUnreads and the activeConversation effect above) - without
  // this, the unread mark would be wiped out the moment anything else
  // triggers a refresh (WS reconnect, mute toggle, etc.) while the user is
  // still looking at the conversation. Decision: least-surprising fix is to
  // hold the suppression only until the user actually leaves and returns to
  // the conversation, at which point it is treated as read again, same as
  // any other unread conversation.
  const markConversationUnreadFromMessage = useCallback(
    async ({
      type,
      id,
      messageId,
    }: {
      type: 'channel' | 'contact';
      id: string;
      messageId: number;
    }) => {
      const key = getStateKey(type, id);

      if (type === 'channel') {
        await api.markChannelUnread(id, messageId);
      } else {
        await api.markContactUnread(id, messageId);
      }

      const ac = activeConvRef.current;
      if (isUnreadTrackedConversation(ac) && getStateKey(ac.type, ac.id) === key) {
        suppressAutoReadKeyRef.current = key;
      }

      // Resync counts/first_unread_ids/last_read_ats from the server rather
      // than guessing the new unread count locally.
      await fetchUnreads();
    },
    [fetchUnreads]
  );

  return {
    unreadCounts,
    mentions,
    lastMessageTimes,
    unreadLastReadAts,
    firstUnreadIds,
    recordMessageEvent,
    renameConversationState,
    removeConversationState,
    markAllRead,
    markConversationsRead,
    markConversationUnreadFromMessage,
    refreshUnreads: fetchUnreads,
  };
}
