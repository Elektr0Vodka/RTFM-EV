import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type { SearchNavigateTarget } from '../components/SearchView';
import type { Channel, Contact, Conversation } from '../types';
import { useIsMobile } from '../map/controls/breakpoints';
import { getContactDisplayName } from '../utils/pubkey';

interface UseConversationNavigationArgs {
  channels: Channel[];
  contacts: Contact[];
  handleSelectConversation: (conv: Conversation) => void;
}

interface UseConversationNavigationResult {
  targetMessageId: number | null;
  setTargetMessageId: Dispatch<SetStateAction<number | null>>;
  infoPaneContactKey: string | null;
  infoPaneFromChannel: boolean;
  infoPaneChannelKey: string | null;
  searchPrefillRequest: { query: string; nonce: number } | null;
  handleOpenContactInfo: (publicKey: string, fromChannel?: boolean) => void;
  handleCloseContactInfo: () => void;
  handleOpenChannelInfo: (channelKey: string) => void;
  handleCloseChannelInfo: () => void;
  handleSelectConversationWithTargetReset: (
    conv: Conversation,
    options?: { preserveTarget?: boolean }
  ) => void;
  handleNavigateToChannel: (channelKey: string) => void;
  handleNavigateToMessage: (target: SearchNavigateTarget) => void;
  handleOpenSearchWithQuery: (query: string) => void;
}

export function useConversationNavigation({
  channels,
  contacts,
  handleSelectConversation,
}: UseConversationNavigationArgs): UseConversationNavigationResult {
  const isMobile = useIsMobile();
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null);
  const [infoPaneContactKey, setInfoPaneContactKey] = useState<string | null>(null);
  const [infoPaneFromChannel, setInfoPaneFromChannel] = useState(false);
  const [infoPaneChannelKey, setInfoPaneChannelKey] = useState<string | null>(null);
  const [searchPrefillRequest, setSearchPrefillRequest] = useState<{
    query: string;
    nonce: number;
  } | null>(null);

  const handleOpenContactInfo = useCallback(
    (publicKey: string, fromChannel?: boolean) => {
      // Desktop: open the routed full-page contact-info view. Mobile: keep the
      // side-panel overlay unchanged.
      if (!isMobile) {
        const contact = contacts.find((c) => c.public_key === publicKey) ?? null;
        handleSelectConversation({
          type: 'contact-info',
          id: publicKey,
          name: getContactDisplayName(
            contact?.name ?? null,
            publicKey,
            contact?.last_advert ?? null
          ),
        });
        setInfoPaneContactKey(null);
        return;
      }
      setInfoPaneContactKey(publicKey);
      setInfoPaneFromChannel(fromChannel ?? false);
    },
    [isMobile, contacts, handleSelectConversation]
  );

  const handleCloseContactInfo = useCallback(() => {
    setInfoPaneContactKey(null);
  }, []);

  const handleOpenChannelInfo = useCallback((channelKey: string) => {
    setInfoPaneChannelKey(channelKey);
  }, []);

  const handleCloseChannelInfo = useCallback(() => {
    setInfoPaneChannelKey(null);
  }, []);

  const handleSelectConversationWithTargetReset = useCallback(
    (conv: Conversation, options?: { preserveTarget?: boolean }) => {
      if (conv.type !== 'search' && !options?.preserveTarget) {
        setTargetMessageId(null);
      }
      handleSelectConversation(conv);
    },
    [handleSelectConversation]
  );

  const handleNavigateToChannel = useCallback(
    (channelKey: string) => {
      const channel = channels.find((item) => item.key === channelKey);
      if (!channel) {
        return;
      }

      handleSelectConversationWithTargetReset({
        type: 'channel',
        id: channel.key,
        name: channel.name,
      });
      setInfoPaneContactKey(null);
    },
    [channels, handleSelectConversationWithTargetReset]
  );

  const handleNavigateToMessage = useCallback(
    (target: SearchNavigateTarget) => {
      const convType = target.type === 'CHAN' ? 'channel' : 'contact';
      setTargetMessageId(target.id);
      handleSelectConversationWithTargetReset(
        {
          type: convType,
          id: target.conversation_key,
          name: target.conversation_name,
        },
        { preserveTarget: true }
      );
    },
    [handleSelectConversationWithTargetReset]
  );

  const handleOpenSearchWithQuery = useCallback(
    (query: string) => {
      setTargetMessageId(null);
      setInfoPaneContactKey(null);
      handleSelectConversationWithTargetReset({
        type: 'search',
        id: 'search',
        name: 'Message Search',
      });
      setSearchPrefillRequest((prev) => ({
        query,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [handleSelectConversationWithTargetReset]
  );

  return {
    targetMessageId,
    setTargetMessageId,
    infoPaneContactKey,
    infoPaneFromChannel,
    infoPaneChannelKey,
    searchPrefillRequest,
    handleOpenContactInfo,
    handleCloseContactInfo,
    handleOpenChannelInfo,
    handleCloseChannelInfo,
    handleSelectConversationWithTargetReset,
    handleNavigateToChannel,
    handleNavigateToMessage,
    handleOpenSearchWithQuery,
  };
}
