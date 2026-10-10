import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../components/ui/sonner';
import { api, isAbortError } from '../api';
import type { Conversation, Message, MessagePath } from '../types';
import { getMessageContentKey } from '../utils/messageIdentity';

const MAX_PENDING_ACKS = 500;
const MESSAGE_PAGE_SIZE = 200;
export const MAX_CACHED_CONVERSATIONS = 20;
export const MAX_MESSAGES_PER_ENTRY = 200;

interface CachedConversationEntry {
  messages: Message[];
  hasOlderMessages: boolean;
}

interface InternalCachedConversationEntry extends CachedConversationEntry {
  contentKeys: Set<string>;
}

export class ConversationMessageCache {
  private readonly cache = new Map<string, InternalCachedConversationEntry>();

  private normalizeEntry(entry: CachedConversationEntry): InternalCachedConversationEntry {
    let messages = entry.messages;
    let hasOlderMessages = entry.hasOlderMessages;

    if (messages.length > MAX_MESSAGES_PER_ENTRY) {
      messages = [...messages]
        .sort((a, b) => b.received_at - a.received_at)
        .slice(0, MAX_MESSAGES_PER_ENTRY);
      hasOlderMessages = true;
    }

    return {
      messages,
      hasOlderMessages,
      contentKeys: new Set(messages.map((message) => getMessageContentKey(message))),
    };
  }

  get(id: string): CachedConversationEntry | undefined {
    const entry = this.cache.get(id);
    if (!entry) return undefined;
    this.cache.delete(id);
    this.cache.set(id, entry);
    return {
      messages: entry.messages,
      hasOlderMessages: entry.hasOlderMessages,
    };
  }

  set(id: string, entry: CachedConversationEntry): void {
    const internalEntry = this.normalizeEntry(entry);
    this.cache.delete(id);
    this.cache.set(id, internalEntry);
    if (this.cache.size > MAX_CACHED_CONVERSATIONS) {
      const lruKey = this.cache.keys().next().value as string;
      this.cache.delete(lruKey);
    }
  }

  addMessage(id: string, msg: Message): boolean {
    const entry = this.cache.get(id);
    const contentKey = getMessageContentKey(msg);
    if (!entry) {
      this.cache.set(id, {
        messages: [msg],
        hasOlderMessages: true,
        contentKeys: new Set([contentKey]),
      });
      if (this.cache.size > MAX_CACHED_CONVERSATIONS) {
        const lruKey = this.cache.keys().next().value as string;
        this.cache.delete(lruKey);
      }
      return true;
    }
    if (entry.contentKeys.has(contentKey)) return false;
    if (entry.messages.some((message) => message.id === msg.id)) return false;
    const nextEntry = this.normalizeEntry({
      messages: [...entry.messages, msg],
      hasOlderMessages: entry.hasOlderMessages,
    });
    this.cache.delete(id);
    this.cache.set(id, nextEntry);
    return true;
  }

  updateAck(
    messageId: number,
    ackCount: number,
    paths?: MessagePath[],
    packetId?: number | null
  ): void {
    for (const entry of this.cache.values()) {
      const index = entry.messages.findIndex((message) => message.id === messageId);
      if (index < 0) continue;
      const current = entry.messages[index];
      const updated = [...entry.messages];
      updated[index] = {
        ...current,
        acked: Math.max(current.acked, ackCount),
        ...(paths !== undefined && paths.length >= (current.paths?.length ?? 0) && { paths }),
        ...(packetId !== undefined && { packet_id: packetId }),
      };
      entry.messages = updated;
      return;
    }
  }

  /** A cached message by id, from whichever cached conversation holds it. */
  find(messageId: number): Message | undefined {
    for (const entry of this.cache.values()) {
      const message = entry.messages.find((m) => m.id === messageId);
      if (message) return message;
    }
    return undefined;
  }

  /** Set or clear the Spam Guard flag on cached messages. */
  updateSpam(messageIds: ReadonlySet<number>, spam: boolean): void {
    for (const entry of this.cache.values()) {
      if (!entry.messages.some((message) => messageIds.has(message.id))) continue;
      entry.messages = entry.messages.map((message) =>
        messageIds.has(message.id) ? { ...message, spam } : message
      );
    }
  }

  /** Mark a cached outgoing message as failed (no ACK after all retries). */
  updateFailed(messageId: number, failedAt: number): void {
    for (const entry of this.cache.values()) {
      const index = entry.messages.findIndex((message) => message.id === messageId);
      if (index < 0) continue;
      const updated = [...entry.messages];
      updated[index] = { ...entry.messages[index], failed_at: failedAt };
      entry.messages = updated;
      return;
    }
  }

  /** Drop one message from whichever cached conversation holds it. */
  removeMessage(messageId: number): void {
    for (const entry of this.cache.values()) {
      const message = entry.messages.find((m) => m.id === messageId);
      if (!message) continue;
      entry.messages = entry.messages.filter((m) => m.id !== messageId);
      entry.contentKeys.delete(getMessageContentKey(message));
      return;
    }
  }

  remove(id: string): void {
    this.cache.delete(id);
  }

  rename(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const oldEntry = this.cache.get(oldId);
    if (!oldEntry) return;

    const newEntry = this.cache.get(newId);
    if (!newEntry) {
      this.cache.delete(oldId);
      this.cache.set(newId, oldEntry);
      return;
    }

    const mergedMessages = [...newEntry.messages];
    const seenIds = new Set(mergedMessages.map((message) => message.id));
    for (const message of oldEntry.messages) {
      if (!seenIds.has(message.id)) {
        mergedMessages.push(message);
        seenIds.add(message.id);
      }
    }

    this.cache.delete(oldId);
    this.cache.set(
      newId,
      this.normalizeEntry({
        messages: mergedMessages,
        hasOlderMessages: newEntry.hasOlderMessages || oldEntry.hasOlderMessages,
      })
    );
  }

  clear(): void {
    this.cache.clear();
  }
}

function messagesEqual(left: Message, right: Message): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.conversation_key === right.conversation_key &&
    left.text === right.text &&
    left.sender_timestamp === right.sender_timestamp &&
    left.received_at === right.received_at &&
    // Paths are compared by count: the server only appends to a message's
    // path list, so an equal count means equal content.
    (left.paths?.length ?? 0) === (right.paths?.length ?? 0) &&
    left.txt_type === right.txt_type &&
    left.signature === right.signature &&
    left.sender_key === right.sender_key &&
    left.outgoing === right.outgoing &&
    left.acked === right.acked &&
    (left.send_status ?? 'confirmed') === (right.send_status ?? 'confirmed') &&
    left.sender_name === right.sender_name &&
    (left.channel_name ?? null) === (right.channel_name ?? null) &&
    (left.packet_id ?? null) === (right.packet_id ?? null) &&
    (left.transport_code ?? null) === (right.transport_code ?? null) &&
    (left.region ?? null) === (right.region ?? null) &&
    (left.failed_at ?? null) === (right.failed_at ?? null) &&
    Boolean(left.malformed) === Boolean(right.malformed)
  );
}

/**
 * Merge a freshly fetched page into the messages on screen. Returns null when
 * nothing changed.
 *
 * A message on screen that the fetch does not contain was deleted on the
 * server, provided it lies inside the range the fetch covers. When the page is
 * full (`fetchedHasOlderMessages`), older pages loaded by scrolling are outside
 * that range and stay. `messageIdsAtRequestStart` protects messages that
 * arrived over the WebSocket while the request was in flight.
 */
export function reconcileConversationMessages(
  current: Message[],
  fetched: Message[],
  fetchedHasOlderMessages = false,
  messageIdsAtRequestStart?: ReadonlySet<number>
): Message[] | null {
  const currentById = new Map<number, Message>();
  for (const message of current) {
    currentById.set(message.id, message);
  }

  const comparePosition = (left: Message, right: Message): number =>
    left.received_at === right.received_at
      ? left.id - right.id
      : left.received_at - right.received_at;

  const fetchedIds = new Set(fetched.map((message) => message.id));
  let oldestFetched: Message | null = null;
  let newestFetched: Message | null = null;
  for (const message of fetched) {
    if (!oldestFetched || comparePosition(message, oldestFetched) < 0) oldestFetched = message;
    if (!newestFetched || comparePosition(message, newestFetched) > 0) newestFetched = message;
  }

  const isInsideFetchedRange = (message: Message): boolean => {
    if (!fetchedHasOlderMessages) return true;
    if (!oldestFetched || !newestFetched) return false;
    return (
      comparePosition(message, oldestFetched) >= 0 && comparePosition(message, newestFetched) <= 0
    );
  };
  const mayRemove = (message: Message): boolean =>
    messageIdsAtRequestStart === undefined || messageIdsAtRequestStart.has(message.id);

  let needsUpdate = current.some(
    (message) => !fetchedIds.has(message.id) && mayRemove(message) && isInsideFetchedRange(message)
  );
  if (!needsUpdate) {
    for (const message of fetched) {
      const currentMessage = currentById.get(message.id);
      if (!currentMessage || !messagesEqual(currentMessage, message)) {
        needsUpdate = true;
        break;
      }
    }
  }
  if (!needsUpdate) return null;

  const messagesOutsideFetchedRange = current.filter(
    (message) =>
      !fetchedIds.has(message.id) && (!mayRemove(message) || !isInsideFetchedRange(message))
  );
  return [...fetched, ...messagesOutsideFetchedRange];
}

export const conversationMessageCache = new ConversationMessageCache();

interface PendingAckUpdate {
  ackCount: number;
  paths?: MessagePath[];
  packetId?: number | null;
}

export function mergePendingAck(
  existing: PendingAckUpdate | undefined,
  ackCount: number,
  paths?: MessagePath[],
  packetId?: number | null
): PendingAckUpdate {
  if (!existing) {
    return {
      ackCount,
      ...(paths !== undefined && { paths }),
      ...(packetId !== undefined && { packetId }),
    };
  }

  if (ackCount > existing.ackCount) {
    return {
      ackCount,
      ...(paths !== undefined && { paths }),
      ...(paths === undefined && existing.paths !== undefined && { paths: existing.paths }),
      ...(packetId !== undefined && { packetId }),
      ...(packetId === undefined &&
        existing.packetId !== undefined && { packetId: existing.packetId }),
    };
  }

  if (ackCount < existing.ackCount) {
    return existing;
  }

  const packetIdChanged = packetId !== undefined && packetId !== existing.packetId;

  if (paths === undefined) {
    if (!packetIdChanged) {
      return existing;
    }
    return {
      ...existing,
      packetId,
    };
  }

  const existingPathCount = existing.paths?.length ?? -1;
  if (paths.length >= existingPathCount) {
    return { ackCount, paths, ...(packetId !== undefined && { packetId }) };
  }

  if (!packetIdChanged) {
    return existing;
  }

  return {
    ...existing,
    packetId,
  };
}

interface UseConversationMessagesResult {
  messages: Message[];
  messagesLoading: boolean;
  loadingOlder: boolean;
  hasOlderMessages: boolean;
  hasNewerMessages: boolean;
  loadingNewer: boolean;
  fetchOlderMessages: () => Promise<void>;
  fetchNewerMessages: () => Promise<void>;
  jumpToBottom: () => void;
  reloadCurrentConversation: () => void;
  observeMessage: (msg: Message) => { added: boolean; activeConversation: boolean };
  receiveMessageAck: (
    messageId: number,
    ackCount: number,
    paths?: MessagePath[],
    packetId?: number | null
  ) => void;
  receiveMessageFailed: (messageId: number, failedAt: number) => void;
  receiveMessageSpam: (messageIds: number[], spam: boolean) => void;
  removeMessage: (messageId: number) => void;
  reconcileOnReconnect: () => void;
  renameConversationMessages: (oldId: string, newId: string) => void;
  removeConversationMessages: (conversationId: string) => void;
  clearConversationMessages: () => void;
}

// Only a chat has messages. The contact page counts as one: it is about the
// same contact and its chat is one click away, so that contact's messages are
// kept ready. Every other page (tools, link detail, SNMP) loads none, also when
// its id happens to be a public key.
const MESSAGE_CONVERSATION_TYPES: Conversation['type'][] = ['contact', 'channel', 'contact-info'];

function isMessageConversation(conversation: Conversation | null): conversation is Conversation {
  return !!conversation && MESSAGE_CONVERSATION_TYPES.includes(conversation.type);
}

function isActiveConversationMessage(
  activeConversation: Conversation | null,
  msg: Message
): boolean {
  if (!activeConversation) return false;
  if (msg.type === 'CHAN' && activeConversation.type === 'channel') {
    return msg.conversation_key === activeConversation.id;
  }
  if (msg.type === 'PRIV' && activeConversation.type === 'contact') {
    return msg.conversation_key === activeConversation.id;
  }
  return false;
}

function appendUniqueMessages(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;

  const seenIds = new Set(current.map((msg) => msg.id));
  const seenContent = new Set(current.map((msg) => getMessageContentKey(msg)));
  const additions: Message[] = [];

  for (const msg of incoming) {
    const contentKey = getMessageContentKey(msg);
    if (seenIds.has(msg.id) || seenContent.has(contentKey)) {
      continue;
    }
    seenIds.add(msg.id);
    seenContent.add(contentKey);
    additions.push(msg);
  }

  if (additions.length === 0) {
    return current;
  }

  return [...current, ...additions];
}

export function useConversationMessages(
  activeConversation: Conversation | null,
  targetMessageId?: number | null
): UseConversationMessagesResult {
  // Track seen message content for deduplication
  const seenMessageContent = useRef<Set<string>>(new Set());

  // ACK events can arrive before the corresponding message event/response.
  // Buffer latest ACK state by message_id and apply when the message arrives.
  const pendingAcksRef = useRef<Map<number, PendingAckUpdate>>(new Map());

  const setPendingAck = useCallback(
    (messageId: number, ackCount: number, paths?: MessagePath[], packetId?: number | null) => {
      const existing = pendingAcksRef.current.get(messageId);
      const merged = mergePendingAck(existing, ackCount, paths, packetId);

      // Update insertion order so most recent updates remain in the buffer longest.
      pendingAcksRef.current.delete(messageId);
      pendingAcksRef.current.set(messageId, merged);

      if (pendingAcksRef.current.size > MAX_PENDING_ACKS) {
        const oldestMessageId = pendingAcksRef.current.keys().next().value as number | undefined;
        if (oldestMessageId !== undefined) {
          pendingAcksRef.current.delete(oldestMessageId);
        }
      }
    },
    []
  );

  const applyPendingAck = useCallback((msg: Message): Message => {
    const pending = pendingAcksRef.current.get(msg.id);
    if (!pending) return msg;

    pendingAcksRef.current.delete(msg.id);

    return {
      ...msg,
      acked: Math.max(msg.acked, pending.ackCount),
      ...(pending.paths !== undefined && { paths: pending.paths }),
      ...(pending.packetId !== undefined && { packet_id: pending.packetId }),
    };
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const olderAbortControllerRef = useRef<AbortController | null>(null);
  const newerAbortControllerRef = useRef<AbortController | null>(null);
  const fetchingConversationIdRef = useRef<string | null>(null);
  const activeConversationRef = useRef(activeConversation);
  activeConversationRef.current = activeConversation;
  const latestReconcileRequestIdRef = useRef(0);
  const pendingReconnectReconcileRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const hasNewerMessagesRef = useRef(false);
  const prevConversationIdRef = useRef<string | null>(null);
  const prevIsMessageRef = useRef(false);
  const prevReloadVersionRef = useRef(0);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingOlderRef.current = loadingOlder;
  }, [loadingOlder]);

  useEffect(() => {
    loadingNewerRef.current = loadingNewer;
  }, [loadingNewer]);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  useEffect(() => {
    hasNewerMessagesRef.current = hasNewerMessages;
  }, [hasNewerMessages]);

  const syncSeenContent = useCallback(
    (nextMessages: Message[]) => {
      seenMessageContent.current.clear();
      for (const msg of nextMessages) {
        seenMessageContent.current.add(getMessageContentKey(msg));
      }
    },
    [seenMessageContent]
  );

  const fetchLatestMessages = useCallback(
    async (showLoading = false, signal?: AbortSignal) => {
      if (!isMessageConversation(activeConversation)) {
        setMessages([]);
        setHasOlderMessages(false);
        return;
      }

      const conversationId = activeConversation.id;
      pendingReconnectReconcileRef.current = false;

      if (showLoading) {
        setMessagesLoading(true);
        setMessages([]);
      }

      try {
        const messageIdsAtRequestStart = new Set(messagesRef.current.map((message) => message.id));
        const data = await api.getMessages(
          {
            type: activeConversation.type === 'channel' ? 'CHAN' : 'PRIV',
            conversation_key: activeConversation.id,
            limit: MESSAGE_PAGE_SIZE,
          },
          signal
        );

        if (fetchingConversationIdRef.current !== conversationId) {
          return;
        }

        const messagesWithPendingAck = data.map((msg) => applyPendingAck(msg));
        const merged = reconcileConversationMessages(
          messagesRef.current,
          messagesWithPendingAck,
          messagesWithPendingAck.length >= MESSAGE_PAGE_SIZE,
          messageIdsAtRequestStart
        );
        const nextMessages = merged ?? messagesRef.current;
        if (merged) {
          setMessages(merged);
        }
        syncSeenContent(nextMessages);
        setHasOlderMessages(messagesWithPendingAck.length >= MESSAGE_PAGE_SIZE);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        console.error('Failed to fetch messages:', err);
        toast.error('Failed to load messages', {
          description: err instanceof Error ? err.message : 'Check your connection',
        });
      } finally {
        if (showLoading) {
          setMessagesLoading(false);
        }
      }
    },
    [activeConversation, applyPendingAck, syncSeenContent]
  );

  const reconcileFromBackend = useCallback(
    (conversation: Conversation, signal: AbortSignal, requestId: number) => {
      const conversationId = conversation.id;
      const messageIdsAtRequestStart = new Set(messagesRef.current.map((message) => message.id));
      api
        .getMessages(
          {
            type: conversation.type === 'channel' ? 'CHAN' : 'PRIV',
            conversation_key: conversationId,
            limit: MESSAGE_PAGE_SIZE,
          },
          signal
        )
        .then((data) => {
          if (fetchingConversationIdRef.current !== conversationId) return;
          if (latestReconcileRequestIdRef.current !== requestId) return;

          const dataWithPendingAck = data.map((msg) => applyPendingAck(msg));
          setHasOlderMessages(dataWithPendingAck.length >= MESSAGE_PAGE_SIZE);
          const merged = reconcileConversationMessages(
            messagesRef.current,
            dataWithPendingAck,
            dataWithPendingAck.length >= MESSAGE_PAGE_SIZE,
            messageIdsAtRequestStart
          );
          if (!merged) return;

          setMessages(merged);
          syncSeenContent(merged);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          console.debug('Background reconciliation failed:', err);
        });
    },
    [applyPendingAck, syncSeenContent]
  );

  const fetchOlderMessages = useCallback(async () => {
    if (
      !isMessageConversation(activeConversation) ||
      loadingOlderRef.current ||
      !hasOlderMessagesRef.current
    ) {
      return;
    }

    const conversationId = activeConversation.id;
    const oldestMessage = messagesRef.current.reduce(
      (oldest, msg) => {
        if (!oldest) return msg;
        if (msg.received_at < oldest.received_at) return msg;
        if (msg.received_at === oldest.received_at && msg.id < oldest.id) return msg;
        return oldest;
      },
      null as Message | null
    );
    if (!oldestMessage) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const controller = new AbortController();
    olderAbortControllerRef.current = controller;
    try {
      const data = await api.getMessages(
        {
          type: activeConversation.type === 'channel' ? 'CHAN' : 'PRIV',
          conversation_key: conversationId,
          limit: MESSAGE_PAGE_SIZE,
          before: oldestMessage.received_at,
          before_id: oldestMessage.id,
        },
        controller.signal
      );

      if (fetchingConversationIdRef.current !== conversationId) return;

      const dataWithPendingAck = data.map((msg) => applyPendingAck(msg));

      if (dataWithPendingAck.length > 0) {
        let nextMessages: Message[] | null = null;
        setMessages((prev) => {
          const merged = appendUniqueMessages(prev, dataWithPendingAck);
          if (merged !== prev) {
            nextMessages = merged;
          }
          return merged;
        });
        if (nextMessages) {
          messagesRef.current = nextMessages;
          syncSeenContent(nextMessages);
        }
      }
      setHasOlderMessages(dataWithPendingAck.length >= MESSAGE_PAGE_SIZE);
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      console.error('Failed to fetch older messages:', err);
      toast.error('Failed to load older messages', {
        description: err instanceof Error ? err.message : 'Check your connection',
      });
    } finally {
      if (olderAbortControllerRef.current === controller) {
        olderAbortControllerRef.current = null;
      }
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [activeConversation, applyPendingAck, syncSeenContent]);

  const fetchNewerMessages = useCallback(async () => {
    if (
      !isMessageConversation(activeConversation) ||
      loadingNewerRef.current ||
      !hasNewerMessagesRef.current
    ) {
      return;
    }

    const conversationId = activeConversation.id;
    const newestMessage = messagesRef.current.reduce(
      (newest, msg) => {
        if (!newest) return msg;
        if (msg.received_at > newest.received_at) return msg;
        if (msg.received_at === newest.received_at && msg.id > newest.id) return msg;
        return newest;
      },
      null as Message | null
    );
    if (!newestMessage) return;

    loadingNewerRef.current = true;
    setLoadingNewer(true);
    const controller = new AbortController();
    newerAbortControllerRef.current = controller;
    try {
      const data = await api.getMessages(
        {
          type: activeConversation.type === 'channel' ? 'CHAN' : 'PRIV',
          conversation_key: conversationId,
          limit: MESSAGE_PAGE_SIZE,
          after: newestMessage.received_at,
          after_id: newestMessage.id,
        },
        controller.signal
      );

      if (fetchingConversationIdRef.current !== conversationId) return;

      const dataWithPendingAck = data.map((msg) => applyPendingAck(msg));
      const newMessages = dataWithPendingAck.filter(
        (msg) => !seenMessageContent.current.has(getMessageContentKey(msg))
      );

      if (newMessages.length > 0) {
        setMessages((prev) => [...prev, ...newMessages]);
        for (const msg of newMessages) {
          seenMessageContent.current.add(getMessageContentKey(msg));
        }
      }
      const stillHasNewerMessages = dataWithPendingAck.length >= MESSAGE_PAGE_SIZE;
      setHasNewerMessages(stillHasNewerMessages);
      if (!stillHasNewerMessages && pendingReconnectReconcileRef.current) {
        pendingReconnectReconcileRef.current = false;
        const requestId = latestReconcileRequestIdRef.current + 1;
        latestReconcileRequestIdRef.current = requestId;
        const reconcileController = new AbortController();
        reconcileFromBackend(activeConversation, reconcileController.signal, requestId);
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      console.error('Failed to fetch newer messages:', err);
      toast.error('Failed to load newer messages', {
        description: err instanceof Error ? err.message : 'Check your connection',
      });
    } finally {
      if (newerAbortControllerRef.current === controller) {
        newerAbortControllerRef.current = null;
      }
      loadingNewerRef.current = false;
      setLoadingNewer(false);
    }
  }, [activeConversation, applyPendingAck, reconcileFromBackend]);

  const jumpToBottom = useCallback(() => {
    if (!activeConversation) return;
    setHasNewerMessages(false);
    conversationMessageCache.remove(activeConversation.id);
    void fetchLatestMessages(true);
  }, [activeConversation, fetchLatestMessages]);

  const reloadCurrentConversation = useCallback(() => {
    if (!isMessageConversation(activeConversation)) return;
    setHasNewerMessages(false);
    conversationMessageCache.remove(activeConversation.id);
    setReloadVersion((current) => current + 1);
  }, [activeConversation]);

  const reconcileOnReconnect = useCallback(() => {
    // Read the current conversation from the ref rather than closing over
    // activeConversation, so that a conversation switch during WS reconnect
    // targets the right conversation instead of a stale capture.
    const current = activeConversationRef.current;
    if (!isMessageConversation(current)) return;

    if (hasNewerMessagesRef.current) {
      pendingReconnectReconcileRef.current = true;
      return;
    }

    pendingReconnectReconcileRef.current = false;
    const controller = new AbortController();
    const requestId = latestReconcileRequestIdRef.current + 1;
    latestReconcileRequestIdRef.current = requestId;
    reconcileFromBackend(current, controller.signal, requestId);
  }, [reconcileFromBackend]);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (olderAbortControllerRef.current) {
      olderAbortControllerRef.current.abort();
      olderAbortControllerRef.current = null;
    }
    if (newerAbortControllerRef.current) {
      newerAbortControllerRef.current.abort();
      newerAbortControllerRef.current = null;
    }

    const prevId = prevConversationIdRef.current;
    const newId = activeConversation?.id ?? null;
    // A page that is not a chat can share its id with one (the SNMP page of a
    // node and that contact's chat), so going between the two is a switch too.
    const isMessage = isMessageConversation(activeConversation);
    const conversationChanged = prevId !== newId || prevIsMessageRef.current !== isMessage;
    prevIsMessageRef.current = isMessage;
    const reloadRequested = prevReloadVersionRef.current !== reloadVersion;
    fetchingConversationIdRef.current = newId;
    prevConversationIdRef.current = newId;
    prevReloadVersionRef.current = reloadVersion;
    latestReconcileRequestIdRef.current = 0;
    pendingReconnectReconcileRef.current = false;

    // Preserve around-loaded context on the same conversation when search clears targetMessageId.
    if (!conversationChanged && !targetMessageId && !reloadRequested) {
      return;
    }

    setLoadingOlder(false);
    loadingOlderRef.current = false;
    setLoadingNewer(false);
    if (conversationChanged) {
      setHasNewerMessages(false);
    }

    if (
      conversationChanged &&
      prevId &&
      messagesRef.current.length > 0 &&
      !hasNewerMessagesRef.current
    ) {
      conversationMessageCache.set(prevId, {
        messages: messagesRef.current,
        hasOlderMessages: hasOlderMessagesRef.current,
      });
    }

    if (!isMessageConversation(activeConversation)) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (targetMessageId) {
      setMessagesLoading(true);
      setMessages([]);
      const msgType = activeConversation.type === 'channel' ? 'CHAN' : 'PRIV';
      void api
        .getMessagesAround(
          targetMessageId,
          msgType as 'PRIV' | 'CHAN',
          activeConversation.id,
          controller.signal
        )
        .then((response) => {
          if (fetchingConversationIdRef.current !== activeConversation.id) return;
          const withAcks = response.messages.map((msg) => applyPendingAck(msg));
          setMessages(withAcks);
          syncSeenContent(withAcks);
          setHasOlderMessages(response.has_older);
          setHasNewerMessages(response.has_newer);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          console.error('Failed to fetch messages around target:', err);
          toast.error('Failed to jump to message');
        })
        .finally(() => {
          setMessagesLoading(false);
        });
    } else {
      const cached = conversationMessageCache.get(activeConversation.id);
      if (cached) {
        setMessages(cached.messages);
        seenMessageContent.current = new Set(
          cached.messages.map((message) => getMessageContentKey(message))
        );
        setHasOlderMessages(cached.hasOlderMessages);
        setMessagesLoading(false);
        const requestId = latestReconcileRequestIdRef.current + 1;
        latestReconcileRequestIdRef.current = requestId;
        reconcileFromBackend(activeConversation, controller.signal, requestId);
      } else {
        void fetchLatestMessages(true, controller.signal);
      }
    }

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.id, activeConversation?.type, targetMessageId, reloadVersion]);

  // Add a message to the active conversation if it is new.
  const appendActiveMessageIfNew = useCallback(
    (msg: Message): boolean => {
      const msgWithPendingAck = applyPendingAck(msg);
      const contentKey = getMessageContentKey(msgWithPendingAck);
      if (seenMessageContent.current.has(contentKey)) {
        console.debug('Duplicate message content ignored:', contentKey.slice(0, 50));
        return false;
      }
      seenMessageContent.current.add(contentKey);

      // Limit set size to prevent memory issues - rebuild from current messages
      // so visible messages always remain in the dedup set (insertion-order slicing
      // could evict keys for still-displayed messages, allowing echo duplicates).
      if (seenMessageContent.current.size > 1000) {
        seenMessageContent.current = new Set(
          messagesRef.current.map((m) => getMessageContentKey(m))
        );
        // Re-add the just-inserted key in case it's a new message not yet in state
        seenMessageContent.current.add(contentKey);
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === msgWithPendingAck.id)) {
          return prev;
        }
        return [...prev, msgWithPendingAck];
      });

      return true;
    },
    [applyPendingAck, messagesRef, setMessages]
  );

  // Update a message's ack count and paths
  const updateMessageAck = useCallback(
    (messageId: number, ackCount: number, paths?: MessagePath[], packetId?: number | null) => {
      const hasMessageLoaded = messagesRef.current.some((m) => m.id === messageId);
      if (!hasMessageLoaded) {
        setPendingAck(messageId, ackCount, paths, packetId);
        return;
      }

      // Message is loaded now, so any prior pending ACK for it is stale.
      pendingAcksRef.current.delete(messageId);

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          const current = prev[idx];
          const nextAck = Math.max(current.acked, ackCount);
          const nextPaths =
            paths !== undefined && paths.length >= (current.paths?.length ?? 0)
              ? paths
              : current.paths;

          const updated = [...prev];
          updated[idx] = {
            ...current,
            acked: nextAck,
            ...(paths !== undefined && { paths: nextPaths }),
            ...(packetId !== undefined && { packet_id: packetId }),
          };
          return updated;
        }
        setPendingAck(messageId, ackCount, paths, packetId);
        return prev;
      });
    },
    [messagesRef, setMessages, setPendingAck]
  );

  const receiveMessageAck = useCallback(
    (messageId: number, ackCount: number, paths?: MessagePath[], packetId?: number | null) => {
      updateMessageAck(messageId, ackCount, paths, packetId);
      conversationMessageCache.updateAck(messageId, ackCount, paths, packetId);
    },
    [updateMessageAck]
  );

  const receiveMessageFailed = useCallback(
    (messageId: number, failedAt: number) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        // A message that was acked in the meantime is delivered, not failed.
        if (idx < 0 || prev[idx].acked > 0) return prev;
        const updated = [...prev];
        updated[idx] = { ...prev[idx], failed_at: failedAt };
        return updated;
      });
      conversationMessageCache.updateFailed(messageId, failedAt);
    },
    [setMessages]
  );

  const receiveMessageSpam = useCallback(
    (messageIds: number[], spam: boolean) => {
      const ids = new Set(messageIds);
      setMessages((prev) =>
        prev.some((m) => ids.has(m.id) && !!m.spam !== spam)
          ? prev.map((m) => (ids.has(m.id) ? { ...m, spam } : m))
          : prev
      );
      conversationMessageCache.updateSpam(ids, spam);
    },
    [setMessages]
  );

  const removeMessage = useCallback(
    (messageId: number) => {
      const removed = messagesRef.current.find((m) => m.id === messageId);
      if (removed) {
        seenMessageContent.current.delete(getMessageContentKey(removed));
      }
      setMessages((prev) =>
        prev.some((m) => m.id === messageId) ? prev.filter((m) => m.id !== messageId) : prev
      );
      pendingAcksRef.current.delete(messageId);
      conversationMessageCache.removeMessage(messageId);
    },
    [messagesRef, setMessages]
  );

  const observeMessage = useCallback(
    (msg: Message): { added: boolean; activeConversation: boolean } => {
      const msgWithPendingAck = applyPendingAck(msg);
      const activeConversationMessage = isActiveConversationMessage(
        activeConversation,
        msgWithPendingAck
      );

      if (activeConversationMessage) {
        if (hasNewerMessagesRef.current) {
          return { added: false, activeConversation: true };
        }

        return {
          added: appendActiveMessageIfNew(msgWithPendingAck),
          activeConversation: true,
        };
      }

      return {
        added: conversationMessageCache.addMessage(
          msgWithPendingAck.conversation_key,
          msgWithPendingAck
        ),
        activeConversation: false,
      };
    },
    [activeConversation, appendActiveMessageIfNew, applyPendingAck, hasNewerMessagesRef]
  );

  const renameConversationMessages = useCallback((oldId: string, newId: string) => {
    conversationMessageCache.rename(oldId, newId);
  }, []);

  const removeConversationMessages = useCallback((conversationId: string) => {
    conversationMessageCache.remove(conversationId);
  }, []);

  const clearConversationMessages = useCallback(() => {
    conversationMessageCache.clear();
  }, []);

  return {
    messages,
    messagesLoading,
    loadingOlder,
    hasOlderMessages,
    hasNewerMessages,
    loadingNewer,
    fetchOlderMessages,
    fetchNewerMessages,
    jumpToBottom,
    reloadCurrentConversation,
    observeMessage,
    receiveMessageAck,
    receiveMessageFailed,
    receiveMessageSpam,
    removeMessage,
    reconcileOnReconnect,
    renameConversationMessages,
    removeConversationMessages,
    clearConversationMessages,
  };
}
