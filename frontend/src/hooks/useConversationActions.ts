import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { api } from '../api';
import { toast } from '../components/ui/sonner';
import type { MessageInputHandle } from '../components/MessageInput';
import type { Channel, Contact, Conversation, Message, PathDiscoveryResponse } from '../types';
import { useT } from '../i18n';
import { mergeContactIntoList } from '../utils/contactMerge';
import { buildMarkerPayload } from '../utils/meshcoreOpenPayloads';
import { parseSenderFromText } from '../utils/messageParser';
import { buildReplyText } from '../utils/replyText';

interface UseConversationActionsArgs {
  activeConversation: Conversation | null;
  activeConversationRef: MutableRefObject<Conversation | null>;
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  observeMessage: (msg: Message) => { added: boolean; activeConversation: boolean };
  /** Drop a message locally: a local delete, or a failed DM replaced by its retry. */
  removeMessage: (messageId: number) => void;
  messageInputRef: RefObject<MessageInputHandle | null>;
  markConversationUnreadFromMessage: (args: {
    type: 'channel' | 'contact';
    id: string;
    messageId: number;
  }) => Promise<void>;
}

interface UseConversationActionsResult {
  handleSendMessage: (text: string) => Promise<void>;
  handleResendChannelMessage: (messageId: number, newTimestamp?: boolean) => Promise<void>;
  handleRetryDirectMessage: (messageId: number) => Promise<void>;
  handleSetChannelFloodScopeOverride: (
    channelKey: string,
    floodScopeOverride: string
  ) => Promise<void>;
  handleSetChannelPathHashModeOverride: (
    channelKey: string,
    pathHashModeOverride: number | null
  ) => Promise<void>;
  handleSenderClick: (sender: string) => void;
  handleReactToMessage: (messageId: number, emoji: string) => Promise<void>;
  handleReplyToMessage: (message: Message) => void;
  handleDeleteMessage: (message: Message) => Promise<void>;
  handleMarkUnreadFromMessage: (message: Message) => Promise<void>;
  handleInsertLocation: (lat: number, lon: number, label: string) => void;
  handleTrace: () => Promise<void>;
  handlePathDiscovery: (publicKey: string) => Promise<PathDiscoveryResponse>;
}

export function useConversationActions({
  activeConversation,
  activeConversationRef,
  setContacts,
  setChannels,
  observeMessage,
  removeMessage,
  messageInputRef,
  markConversationUnreadFromMessage,
}: UseConversationActionsArgs): UseConversationActionsResult {
  const t = useT();
  const mergeChannelIntoList = useCallback(
    (updated: Channel) => {
      setChannels((prev) => {
        const existingIndex = prev.findIndex((channel) => channel.key === updated.key);
        if (existingIndex === -1) {
          return [...prev, updated].sort((a, b) => a.name.localeCompare(b.name));
        }
        const next = [...prev];
        next[existingIndex] = updated;
        return next;
      });
    },
    [setChannels]
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeConversation) return;

      const conversationId = activeConversation.id;
      const sent =
        activeConversation.type === 'channel'
          ? await api.sendChannelMessage(activeConversation.id, text)
          : await api.sendDirectMessage(activeConversation.id, text);

      if (activeConversationRef.current?.id === conversationId) {
        observeMessage(sent);
      }
    },
    [activeConversation, activeConversationRef, observeMessage]
  );

  const handleResendChannelMessage = useCallback(
    async (messageId: number, newTimestamp?: boolean) => {
      try {
        const resent = await api.resendChannelMessage(messageId, newTimestamp);
        const resentMessage = resent.message;
        if (
          newTimestamp &&
          resentMessage &&
          activeConversationRef.current?.type === 'channel' &&
          activeConversationRef.current.id === resentMessage.conversation_key
        ) {
          observeMessage(resentMessage);
        }
        toast.success(newTimestamp ? 'Message resent with new timestamp' : 'Message resent');
      } catch (err) {
        toast.error('Failed to resend', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [activeConversationRef, observeMessage]
  );

  // Retry a failed DM: the server sends a new copy and deletes the failed row,
  // so the new bubble replaces the failed one.
  const handleRetryDirectMessage = useCallback(
    async (messageId: number) => {
      try {
        const resent = await api.resendDirectMessage(messageId);
        removeMessage?.(resent.replaced_message_id);
        if (activeConversationRef.current?.id === resent.message.conversation_key) {
          observeMessage(resent.message);
        }
        toast.success(t('chat_retry_sent'));
      } catch (err) {
        toast.error(t('chat_retry_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [activeConversationRef, observeMessage, removeMessage, t]
  );

  const handleSetChannelFloodScopeOverride = useCallback(
    async (channelKey: string, floodScopeOverride: string) => {
      try {
        const updated = await api.setChannelFloodScopeOverride(channelKey, floodScopeOverride);
        mergeChannelIntoList(updated);
        toast.success(
          updated.flood_scope_override ? 'Regional override saved' : 'Regional override cleared'
        );
      } catch (err) {
        toast.error('Failed to update regional override', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [mergeChannelIntoList]
  );

  const handleSetChannelPathHashModeOverride = useCallback(
    async (channelKey: string, pathHashModeOverride: number | null) => {
      try {
        const updated = await api.setChannelPathHashModeOverride(channelKey, pathHashModeOverride);
        mergeChannelIntoList(updated);
        toast.success(
          updated.path_hash_mode_override != null
            ? 'Path hop width override saved'
            : 'Path hop width override cleared'
        );
      } catch (err) {
        toast.error('Failed to update path hop width override', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [mergeChannelIntoList]
  );

  const handleSenderClick = useCallback(
    (sender: string) => {
      messageInputRef.current?.appendText(`@[${sender}] `);
    },
    [messageInputRef]
  );

  const handleReactToMessage = useCallback(
    async (messageId: number, emoji: string) => {
      try {
        const sent = await api.reactToMessage(messageId, emoji);
        if (activeConversationRef.current?.id === sent.conversation_key) {
          observeMessage(sent);
        }
      } catch (err) {
        toast.error(t('chat_reaction_send_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [activeConversationRef, observeMessage, t]
  );

  const handleReplyToMessage = useCallback(
    (message: Message) => {
      // Channels mention the original sender; DMs mention the contact, as other clients do.
      const parsed = parseSenderFromText(message.text);
      const isChannel = message.type === 'CHAN';
      const mentionName = isChannel ? parsed.sender : activeConversationRef.current?.name;
      if (!mentionName) return;
      const body = isChannel ? parsed.content : message.text;
      messageInputRef.current?.appendText(buildReplyText(mentionName, body));
    },
    [activeConversationRef, messageInputRef]
  );

  const handleDeleteMessage = useCallback(
    async (message: Message) => {
      if (!window.confirm(t('chat_delete_message_confirm'))) return;
      try {
        await api.deleteMessage(message.id);
        // The backend also broadcasts message_deleted over WS (for other open
        // tabs); remove it here too so this tab updates without waiting on it.
        removeMessage(message.id);
      } catch (err) {
        toast.error(t('chat_delete_message_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [removeMessage, t]
  );

  const handleMarkUnreadFromMessage = useCallback(
    async (message: Message) => {
      const type = message.type === 'CHAN' ? 'channel' : 'contact';
      try {
        await markConversationUnreadFromMessage({
          type,
          id: message.conversation_key,
          messageId: message.id,
        });
        toast.success(t('chat_mark_unread_success'));
      } catch (err) {
        toast.error(t('chat_mark_unread_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [markConversationUnreadFromMessage, t]
  );

  const handleInsertLocation = useCallback(
    (lat: number, lon: number, label: string) => {
      messageInputRef.current?.appendText(`${buildMarkerPayload(lat, lon, label)} `);
    },
    [messageInputRef]
  );

  const handleTrace = useCallback(async () => {
    if (!activeConversation || activeConversation.type !== 'contact') return;
    toast('Trace started...');
    try {
      const result = await api.requestTrace(activeConversation.id);
      const parts: string[] = [];
      if (result.remote_snr !== null) parts.push(`Remote SNR: ${result.remote_snr.toFixed(1)} dB`);
      if (result.local_snr !== null) parts.push(`Local SNR: ${result.local_snr.toFixed(1)} dB`);
      const detail = parts.join(', ');
      toast.success(detail ? `Trace complete! ${detail}` : 'Trace complete!');
    } catch (err) {
      toast.error('Trace failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [activeConversation]);

  const handlePathDiscovery = useCallback(
    async (publicKey: string) => {
      const result = await api.requestPathDiscovery(publicKey);
      setContacts((prev) => mergeContactIntoList(prev, result.contact));
      return result;
    },
    [setContacts]
  );

  return {
    handleSendMessage,
    handleResendChannelMessage,
    handleRetryDirectMessage,
    handleSetChannelFloodScopeOverride,
    handleSetChannelPathHashModeOverride,
    handleSenderClick,
    handleReactToMessage,
    handleReplyToMessage,
    handleDeleteMessage,
    handleMarkUnreadFromMessage,
    handleInsertLocation,
    handleTrace,
    handlePathDiscovery,
  };
}
