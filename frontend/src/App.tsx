import { useEffect, useCallback, useRef, useState, useMemo, type MouseEvent } from 'react';
import { api } from './api';
import { MAX_RAW_PACKETS, seedRawPacketStore } from './stores/rawPacketStore';
import { takePrefetchOrFetch } from './prefetch';
import { useWebSocket } from './useWebSocket';
import {
  useAppShell,
  useUnreadCounts,
  useConversationMessages,
  useRadioControl,
  useAppSettings,
  useConversationRouter,
  useContactsAndChannels,
  useConversationActions,
  useConversationNavigation,
  useRealtimeAppState,
  useBrowserNotifications,
  useNewNodeNotifications,
  useMentionSound,
  useFaviconBadge,
  useUnreadTitle,
  useMeshcomodConfig,
} from './hooks';
import { toast } from './components/ui/sonner';
import { AppShell } from './components/AppShell';
import { ChatPopoutShell } from './popout/ChatPopoutShell';
import {
  getPopoutMode,
  isChatConversation,
  isPopoutView,
  openChatPopout,
  openInMainApp,
  openMainAppAt,
} from './popout/popoutMode';
import { createMainPresenceTracker, type MainPresenceTracker } from './popout/mainPresence';
import { ChannelImportExportModal } from './components/ChannelImportExportModal';
import type { MessageInputHandle } from './components/MessageInput';
import { DistanceUnitProvider } from './contexts/DistanceUnitContext';
import { PathHopWidthProvider } from './contexts/PathHopWidthContext';
import { RichPayloadProvider } from './contexts/RichPayloadContext';
import { LocationPreviewProvider } from './contexts/LocationPreviewContext';
import { usePush } from './contexts/PushSubscriptionContext';
import { messageContainsMention } from './utils/messageParser';
import { buildMentionEvent, type MentionEvent } from './components/MentionTicker';
import { getStateKey } from './utils/conversationState';
import { isConversationSoundMuted, toggleConversationSoundMuted } from './lib/mentionSoundMute';
import { getContactDisplayName } from './utils/pubkey';
import type { SearchNavigateTarget } from './components/SearchView';
import type {
  BulkCreateHashtagChannelsResult,
  Channel,
  ContactGroup,
  Conversation,
  Message,
} from './types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from './types';
import { shouldAutoFocusInput } from './utils/autoFocusInput';
import { computeRegionSeed } from './lib/regionSeed';
import { loadRegistry, recordMention, saveRegistry } from './lib/channelManager';
import { buildNameSet } from './lib/hashtagChannelState';
import { useLocale, useT } from './i18n';
import { getSettingsHash } from './utils/urlHash';
import { resolveDateTimeFormat, setActiveDateTimeFormat } from './utils/dateTimeFormat';
import { DEFAULT_BATTERY_CHEMISTRY, setActiveBatteryChemistry } from './utils/batteryDisplay';

interface ChannelUnreadMarker {
  channelId: string;
  /** Id of the oldest unread message, straight from the server. */
  messageId: number | null;
}

interface NewMessagePrefillRequest {
  tab: 'hashtag';
  hashtagName: string;
  nonce: number;
}

/**
 * Which message the unread divider should sit on.
 *
 * Normally the server's first-unread id. The exception is a channel that has
 * never been read: its true boundary is the first message ever sent there, so
 * offering to jump would haul the reader to the start of history for no gain.
 * Everything loaded is unread in that case, so the divider belongs at the top of
 * the window - which is what the pre-id behaviour did, and it is genuinely the
 * more useful answer.
 */
export function resolveUnreadMarkerId(
  boundaryId: number | null,
  lastReadAt: number | null,
  messages: Message[]
): number | null {
  if (boundaryId === null) return null;
  if (lastReadAt !== null) return boundaryId;
  if (messages.length === 0) return boundaryId;
  if (messages.some((msg) => msg.id === boundaryId)) return boundaryId;

  const oldestLoaded = messages.reduce((oldest, msg) => {
    if (msg.received_at < oldest.received_at) return msg;
    if (msg.received_at === oldest.received_at && msg.id < oldest.id) return msg;
    return oldest;
  }, messages[0]);
  return oldestLoaded.id;
}

export function App() {
  const quoteSearchOperatorValue = useCallback((value: string) => {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }, []);

  const t = useT();
  // Chat popup (`?popout=`): the same app with a chat-only shell. Fixed for the
  // lifetime of the page, since it comes from the URL the window was opened with.
  const [popoutMode] = useState(getPopoutMode);
  // A popup stays silent (sound, notifications) while a main tab is open: both
  // receive the same messages. Without a tracker (the main app) this is true.
  const mainPresenceRef = useRef<MainPresenceTracker | null>(null);
  useEffect(() => {
    if (popoutMode === null) return;
    const tracker = createMainPresenceTracker();
    mainPresenceRef.current = tracker;
    return () => {
      mainPresenceRef.current = null;
      tracker.close();
    };
  }, [popoutMode]);
  const shouldNotifyHere = useCallback(() => !mainPresenceRef.current?.isMainOpen(), []);

  const messageInputRef = useRef<MessageInputHandle>(null);
  const [channelUnreadMarker, setChannelUnreadMarker] = useState<ChannelUnreadMarker | null>(null);
  const [newMessagePrefillRequest, setNewMessagePrefillRequest] =
    useState<NewMessagePrefillRequest | null>(null);
  const [showBulkAddChannelTab, setShowBulkAddChannelTab] = useState(false);
  const [bulkAddResult, setBulkAddResult] = useState<BulkCreateHashtagChannelsResult | null>(null);
  const [repeaterAutoLoginKey, setRepeaterAutoLoginKey] = useState<string | null>(null);
  const [visibilityVersion, setVisibilityVersion] = useState(0);
  const [soundMuteVersion, setSoundMuteVersion] = useState(0);
  const [showChannelImportExport, setShowChannelImportExport] = useState(false);
  const {
    notificationsSupported,
    notificationsPermission,
    isConversationNotificationsEnabled,
    toggleConversationNotifications,
    notifyIncomingMessage,
  } = useBrowserNotifications();
  const {
    newNodeNotificationsSupported,
    newNodeNotificationsPermission,
    newNodeNotificationsEnabled,
    newNodeNotificationTypes,
    setNewNodeNotificationsEnabled,
    setNewNodeNotificationType,
    handleNewNodeEvent,
  } = useNewNodeNotifications();
  const pushSubscription = usePush();
  const {
    showNewMessage,
    showSettings,
    settingsSection,
    sidebarOpen,
    showCracker,
    crackerRunning,
    localLabel,
    distanceUnit,
    renderRichPayloads,
    showPathHopWidth,
    showLocationPreview,
    setSettingsSection,
    setSidebarOpen,
    setCrackerRunning,
    setLocalLabel,
    setDistanceUnit,
    setRenderRichPayloads,
    setShowPathHopWidth,
    setShowLocationPreview,
    handleCloseSettingsView,
    handleToggleSettingsView,
    handleOpenNewMessage: openNewMessageModal,
    handleCloseNewMessage: closeNewMessageModal,
    handleToggleCracker,
  } = useAppShell();

  // Shared refs between useConversationRouter and useContactsAndChannels
  const pendingDeleteFallbackRef = useRef(false);
  const hasSetDefaultConversation = useRef(false);

  // Stable ref bridge: useContactsAndChannels needs setActiveConversation from
  // useConversationRouter, but useConversationRouter needs channels/contacts from
  // useContactsAndChannels. We break the cycle with a ref-based indirection.
  const setActiveConversationRef = useRef<(conv: Conversation | null) => void>(() => {});
  const removeConversationMessagesRef = useRef<(conversationId: string) => void>(() => {});

  // --- Extracted hooks ---

  const {
    health,
    setHealth,
    config,
    prevHealthRef,
    fetchConfig,
    handleSaveConfig,
    handleSetPrivateKey,
    handleReboot,
    handleDisconnect,
    handleReconnect,
    handleAdvertise,
    meshDiscovery,
    meshDiscoveryLoadingTarget,
    handleDiscoverMesh,
    regionDiscovery,
    regionDiscoveryLoading,
    handleDiscoverRegions,
    handleHealthRefresh,
  } = useRadioControl();

  // Meshcomod (DMC-EV) CAD state, shared with the Settings panel via a cached hook.
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const { cadSupported, cadEnabled, toggleCad } = useMeshcomodConfig(isMeshcomod);
  const handleToggleCad = useCallback(async () => {
    const next = cadEnabled === true ? false : true;
    try {
      await toggleCad();
      toast.success(next ? 'CAD enabled' : 'CAD disabled');
    } catch {
      toast.error('Failed to toggle CAD');
    }
  }, [cadEnabled, toggleCad]);

  const {
    appSettings,
    fetchAppSettings,
    handleSaveAppSettings,
    handleSetHiddenHopWidths,
    handleSetHideMalformed,
    hiddenHopWidthsVersion,
    handleToggleBlockedKey,
    handleToggleBlockedName,
    handleToggleTrackedTelemetry,
    handleToggleTrackedTelemetryContact,
  } = useAppSettings();

  // Keep the app-wide date/time format in sync with the setting + UI language.
  // A pure derivation done in render so descendants read the current format on
  // their next render (App re-renders when the setting or locale changes).
  const { locale: uiLocale } = useLocale();
  setActiveDateTimeFormat(resolveDateTimeFormat(appSettings?.date_time_format ?? 'auto', uiLocale));

  // Keep the global default battery chemistry in sync with the setting. Callers
  // that display a specific node's battery (e.g. the telemetry map layer) pass
  // that node's own override instead; everything else falls back to this.
  setActiveBatteryChemistry(appSettings?.battery_chemistry ?? DEFAULT_BATTERY_CHEMISTRY);

  // Mention/DM notification sound. Plays via the websocket message path below.
  const { notifyMentionSound } = useMentionSound({
    enabled: appSettings?.mention_sound_enabled ?? false,
    choice: appSettings?.mention_sound_choice ?? 'beep',
    volume: appSettings?.mention_sound_volume ?? 80,
    customVersion: appSettings?.mention_sound_custom?.updated_at ?? null,
  });

  // Seed known_regions from a repeater's reported region codes. Merges into the
  // existing list (deduped, wildcard dropped) and persists so the region pill and
  // scoped-flood decode pick up the new regions. Returns the count added.
  const handleSeedKnownRegions = useCallback(
    async (codes: string[]): Promise<number> => {
      const { merged, added } = computeRegionSeed(appSettings?.known_regions ?? [], codes);
      if (added.length > 0) {
        await handleSaveAppSettings({ known_regions: merged });
      }
      return added.length;
    },
    [appSettings?.known_regions, handleSaveAppSettings]
  );

  // Keep user's name in ref for mention detection in WebSocket callback
  const myNameRef = useRef<string | null>(null);
  useEffect(() => {
    myNameRef.current = config?.name ?? null;
  }, [config?.name]);

  // Keep block lists in refs for WS callback filtering
  const blockedKeysRef = useRef<string[]>([]);
  const blockedNamesRef = useRef<string[]>([]);
  useEffect(() => {
    blockedKeysRef.current = appSettings?.blocked_keys ?? [];
    blockedNamesRef.current = appSettings?.blocked_names ?? [];
  }, [appSettings?.blocked_keys, appSettings?.blocked_names]);

  // Chat "Hide by hop size" filter (server setting), for the WS callback and
  // the message list. Stable array identity per selection via the joined key.
  const hiddenHopWidthsKey = (appSettings?.hidden_hop_widths ?? []).join(',');
  const hiddenHopWidths = useMemo(
    () => (hiddenHopWidthsKey ? hiddenHopWidthsKey.split(',').map(Number) : []),
    [hiddenHopWidthsKey]
  );
  const hiddenHopWidthsRef = useRef<ReadonlySet<number>>(new Set());
  useEffect(() => {
    hiddenHopWidthsRef.current = new Set(hiddenHopWidths);
  }, [hiddenHopWidths]);

  // Chat "Hide malformed" filter (server setting), same consumers.
  const hideMalformed = appSettings?.hide_malformed ?? false;
  const hideMalformedRef = useRef(false);
  useEffect(() => {
    hideMalformedRef.current = hideMalformed;
  }, [hideMalformed]);

  // Check if a message mentions the user
  const checkMention = useCallback(
    (text: string): boolean => messageContainsMention(text, myNameRef.current),
    []
  );

  // useContactsAndChannels is called first - it uses the ref bridge for setActiveConversation
  const {
    contacts,
    contactsLoaded,
    channels,
    undecryptedCount,
    setContacts,
    setContactsLoaded,
    setChannels,
    fetchAllContacts,
    fetchUndecryptedCount,
    handleCreateContact,
    handleImportContactUri,
    handleCreateChannel,
    handleCreateHashtagChannel,
    handleBulkCreateHashtagChannels,
    handleDeleteChannel,
    handleDeleteContact,
  } = useContactsAndChannels({
    setActiveConversation: (conv) => setActiveConversationRef.current(conv),
    pendingDeleteFallbackRef,
    hasSetDefaultConversation,
    removeConversationMessages: (conversationId) =>
      removeConversationMessagesRef.current(conversationId),
  });

  // Keep channels in a ref for WS callback mute filtering
  const channelsRef = useRef<Channel[]>([]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // ── Mention ticker ─────────────────────────────────────────────────────────
  // Pending @mentions surfaced by the WS callback for channels not being viewed.
  const MENTION_EXPIRE_MS = 10 * 60 * 1_000;
  const [pendingMentions, setPendingMentions] = useState<MentionEvent[]>([]);
  const handleChannelMention = useCallback(
    (msg: Message) => {
      const ch = channelsRef.current.find((c) => c.key === msg.conversation_key);
      const chName = ch ? `#${ch.name}` : msg.conversation_key.slice(0, 8).toUpperCase();
      const event = buildMentionEvent(msg, chName);
      const now = Date.now();
      setPendingMentions((prev) => {
        // Deduplicate by messageId and drop entries older than the expiry window.
        const filtered = prev.filter((m) => m.key !== event.key && now - m.at < MENTION_EXPIRE_MS);
        return [...filtered, event];
      });
    },
    [MENTION_EXPIRE_MS]
  );
  const handleDismissMention = useCallback((key: number) => {
    setPendingMentions((prev) => prev.filter((m) => m.key !== key));
  }, []);

  const handleToggleFavorite = useCallback(
    async (type: 'channel' | 'contact', id: string) => {
      // Optimistically toggle the favorite flag
      if (type === 'contact') {
        setContacts((prev) =>
          prev.map((c) => (c.public_key === id ? { ...c, favorite: !c.favorite } : c))
        );
      } else {
        setChannels((prev) =>
          prev.map((c) => (c.key === id ? { ...c, favorite: !c.favorite } : c))
        );
      }

      try {
        await api.toggleFavorite(type, id);
      } catch {
        // Revert on failure
        if (type === 'contact') {
          setContacts((prev) =>
            prev.map((c) => (c.public_key === id ? { ...c, favorite: !c.favorite } : c))
          );
        } else {
          setChannels((prev) =>
            prev.map((c) => (c.key === id ? { ...c, favorite: !c.favorite } : c))
          );
        }
        toast.error('Failed to update favorite');
      }
    },
    [setContacts, setChannels]
  );

  // Full-list replace for user-defined contact/channel groups (server-persisted
  // in app_settings.contact_groups). Membership edits, create/rename/delete all
  // funnel through here from the sidebar, ContactInfoBody and ChannelInfoPane -
  // each computes the "next" array with the pure helpers in utils/sidebarLayout
  // and hands it to this single PATCH, matching the other sidebar arrays.
  const handleUpdateContactGroups = useCallback(
    (next: ContactGroup[]) => handleSaveAppSettings({ contact_groups: next }),
    [handleSaveAppSettings]
  );

  // In the chat popup, anything that is not a chat (map, registry, repeater
  // dashboards, ...) opens in the main app instead of rendering here.
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const redirectToMainApp = useCallback(
    (conv: Conversation) => {
      if (popoutMode === null || isPopoutView(conv, contactsRef.current)) return false;
      openInMainApp(conv);
      return true;
    },
    [popoutMode]
  );

  // useConversationRouter is called second - it receives channels/contacts as inputs
  const {
    activeConversation,
    setActiveConversation,
    activeConversationRef,
    handleSelectConversation,
  } = useConversationRouter({
    channels,
    contacts,
    contactsLoaded,
    suspendHashSync: showSettings,
    setSidebarOpen,
    pendingDeleteFallbackRef,
    hasSetDefaultConversation,
    redirectConversation: redirectToMainApp,
  });

  // Wire up the ref bridge so useContactsAndChannels handlers reach the real setter
  setActiveConversationRef.current = setActiveConversation;

  const {
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
  } = useConversationNavigation({
    channels,
    contacts,
    handleSelectConversation,
    // The popup has no room for the full-page contact view; use the sheet.
    forceInfoSheet: popoutMode !== null,
  });

  // Custom hooks for conversation-specific functionality
  const {
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
    removeMessage,
    reconcileOnReconnect,
    renameConversationMessages,
    removeConversationMessages,
    clearConversationMessages,
  } = useConversationMessages(activeConversation, targetMessageId);
  removeConversationMessagesRef.current = removeConversationMessages;

  // Auto-focus the message input on conversation change (desktop only by default)
  useEffect(() => {
    if (!activeConversation) return;
    if (activeConversation.type !== 'channel' && activeConversation.type !== 'contact') return;
    // Repeaters show a login form, not a message input
    if (activeConversation.type === 'contact') {
      const contact = contacts.find((c) => c.public_key === activeConversation.id);
      if (contact?.type === CONTACT_TYPE_REPEATER) return;
    }
    if (!shouldAutoFocusInput()) return;
    // Defer to let the input mount/render first
    const raf = requestAnimationFrame(() => messageInputRef.current?.focus?.());
    return () => cancelAnimationFrame(raf);
  }, [activeConversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Room servers replay stored history as a burst of DMs, all arriving with similar received_at
  // but spanning a wide range of sender_timestamps. Sort by sender_timestamp for room contacts
  // so the display reflects the original send order rather than our radio's receipt order.
  const activeContactIsRoom =
    activeConversation?.type === 'contact' &&
    contacts.find((c) => c.public_key === activeConversation.id)?.type === CONTACT_TYPE_ROOM;
  const sortedMessages = useMemo(() => {
    if (!activeContactIsRoom || messages.length === 0) return messages;
    return [...messages].sort((a, b) => {
      const aTs = a.sender_timestamp ?? a.received_at;
      const bTs = b.sender_timestamp ?? b.received_at;
      return aTs !== bTs ? aTs - bTs : a.id - b.id;
    });
  }, [activeContactIsRoom, messages]);

  const {
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
    refreshUnreads,
  } = useUnreadCounts(channels, contacts, activeConversation);
  useFaviconBadge(unreadCounts, mentions, channels, appSettings?.brand_icon || undefined);
  useUnreadTitle(unreadCounts, contacts, channels, appSettings?.brand_name || undefined);

  // The server excludes hop-hidden and malformed-hidden messages from unread
  // counts, so re-fetch them once it has stored a new filter selection.
  useEffect(() => {
    if (hiddenHopWidthsVersion > 0) void refreshUnreads();
  }, [hiddenHopWidthsVersion, refreshUnreads]);

  const handleToggleMute = useCallback(
    async (key: string) => {
      setChannels((prev) => prev.map((c) => (c.key === key ? { ...c, muted: !c.muted } : c)));
      try {
        await api.toggleChannelMute(key);
        await refreshUnreads();
      } catch {
        setChannels((prev) => prev.map((c) => (c.key === key ? { ...c, muted: !c.muted } : c)));
        toast.error('Failed to update mute');
      }
    },
    [setChannels, refreshUnreads]
  );

  useEffect(() => {
    if (activeConversation?.type !== 'channel') {
      setChannelUnreadMarker(null);
      return;
    }

    const activeChannelId = activeConversation.id;
    const activeChannelUnreadCount = unreadCounts[getStateKey('channel', activeChannelId)] ?? 0;

    const boundaryId = firstUnreadIds[getStateKey('channel', activeChannelId)] ?? null;

    setChannelUnreadMarker((prev) => {
      if (prev?.channelId === activeChannelId) {
        // Same channel: hold the marker steady so it does not move under the
        // reader, except to fill in a boundary we did not have yet. A marker
        // created before /unreads resolved would otherwise stay blank for as long
        // as the user stays put.
        if (prev.messageId === null && boundaryId !== null) {
          return { channelId: activeChannelId, messageId: boundaryId };
        }
        return prev;
      }
      if (activeChannelUnreadCount <= 0) {
        return null;
      }
      return { channelId: activeChannelId, messageId: boundaryId };
    });
  }, [activeConversation, unreadCounts, firstUnreadIds]);

  const gatedNotifyIncomingMessage = useCallback(
    (...args: Parameters<typeof notifyIncomingMessage>) => {
      if (shouldNotifyHere()) notifyIncomingMessage(...args);
    },
    [notifyIncomingMessage, shouldNotifyHere]
  );
  const gatedNotifyNewNode = useCallback(
    (...args: Parameters<typeof handleNewNodeEvent>) => {
      if (shouldNotifyHere()) handleNewNodeEvent(...args);
    },
    [handleNewNodeEvent, shouldNotifyHere]
  );
  const gatedNotifyMentionSound = useCallback(
    (...args: Parameters<typeof notifyMentionSound>) => {
      if (shouldNotifyHere()) notifyMentionSound(...args);
    },
    [notifyMentionSound, shouldNotifyHere]
  );

  const wsHandlers = useRealtimeAppState({
    prevHealthRef,
    setHealth,
    fetchConfig,
    reconcileOnReconnect,
    refreshUnreads,
    setChannels,
    fetchAllContacts,
    setContacts,
    blockedKeysRef,
    blockedNamesRef,
    hiddenHopWidthsRef,
    hideMalformedRef,
    channelsRef,
    activeConversationRef,
    observeMessage,
    recordMessageEvent,
    renameConversationState,
    removeConversationState,
    checkMention,
    pendingDeleteFallbackRef,
    setActiveConversation,
    renameConversationMessages,
    removeConversationMessages,
    receiveMessageAck,
    receiveMessageFailed,
    removeMessage,
    notifyIncomingMessage: gatedNotifyIncomingMessage,
    notifyNewNode: gatedNotifyNewNode,
    onChannelMention: handleChannelMention,
    notifyMentionSound: gatedNotifyMentionSound,
  });
  const handleVisibilityPolicyChanged = useCallback(() => {
    clearConversationMessages();
    reloadCurrentConversation();
    void refreshUnreads();
    setVisibilityVersion((current) => current + 1);
  }, [clearConversationMessages, refreshUnreads, reloadCurrentConversation]);

  const handleBlockKey = useCallback(
    async (key: string) => {
      await handleToggleBlockedKey(key);
      handleVisibilityPolicyChanged();
    },
    [handleToggleBlockedKey, handleVisibilityPolicyChanged]
  );

  const handleBlockName = useCallback(
    async (name: string) => {
      await handleToggleBlockedName(name);
      handleVisibilityPolicyChanged();
    },
    [handleToggleBlockedName, handleVisibilityPolicyChanged]
  );
  const {
    handleSendMessage,
    handleResendChannelMessage,
    handleRetryDirectMessage,
    handleReactToMessage,
    handleReplyToMessage,
    handleDeleteMessage,
    handleMarkUnreadFromMessage,
    handleSetChannelFloodScopeOverride,
    handleSetChannelPathHashModeOverride,
    handleSenderClick,
    handleInsertLocation,
    handleTrace,
    handlePathDiscovery,
  } = useConversationActions({
    activeConversation,
    activeConversationRef,
    setContacts,
    setChannels,
    observeMessage,
    removeMessage,
    messageInputRef,
    markConversationUnreadFromMessage,
    radioBatteryMv: health?.radio_stats?.battery_mv,
  });
  const handleCreateCrackedChannel = useCallback(
    async (name: string, key: string) => {
      const created = await api.createChannel(name, key);
      const updatedChannels = await api.getChannels();
      setChannels(updatedChannels);
      await api.decryptHistoricalPackets({
        key_type: 'channel',
        channel_key: created.key,
      });
      void fetchUndecryptedCount().catch((error) => {
        console.error('Failed to refresh undecrypted count after cracked channel create:', error);
      });
    },
    [fetchUndecryptedCount, setChannels]
  );

  const handleRepeaterAutoLogin = useCallback(
    (publicKey: string, displayName: string) => {
      handleSelectConversationWithTargetReset({
        type: 'contact',
        id: publicKey,
        name: displayName,
      });
      setRepeaterAutoLoginKey(publicKey);
    },
    [handleSelectConversationWithTargetReset]
  );

  const handleOpenNewMessage = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      setNewMessagePrefillRequest(null);
      setShowBulkAddChannelTab(event?.altKey === true);
      openNewMessageModal();
    },
    [openNewMessageModal]
  );

  const handleCloseNewMessage = useCallback(() => {
    setNewMessagePrefillRequest(null);
    setShowBulkAddChannelTab(false);
    closeNewMessageModal();
  }, [closeNewMessageModal]);

  const handleCloseBulkAddResults = useCallback(() => {
    setBulkAddResult(null);
  }, []);

  const handleCoordinateClick = useCallback(
    (lat: number, lon: number, label: string) => {
      setActiveConversation({
        type: 'map',
        id: 'map',
        name: 'Node Map',
        mapFocusLatLon: [lat, lon],
        ...(label && { mapFocusLabel: label }),
      });
    },
    [setActiveConversation]
  );

  const handleChannelReferenceClick = useCallback(
    (channelName: string) => {
      const existingChannel = channels.find((channel) => channel.name === channelName);
      if (existingChannel) {
        handleNavigateToChannel(existingChannel.key);
        return;
      }

      setNewMessagePrefillRequest((previous) => ({
        tab: 'hashtag',
        hashtagName: channelName.slice(1),
        nonce: (previous?.nonce ?? 0) + 1,
      }));
      setShowBulkAddChannelTab(false);
      openNewMessageModal();
    },
    [channels, handleNavigateToChannel, openNewMessageModal]
  );

  // Channel Registry names (lowercased, '#'-normalised) for classifying #hashtag
  // references in chat. Re-derived when a mention is captured (nonce bump).
  const [registryNonce, setRegistryNonce] = useState(0);
  const registryNames = useMemo(
    // registryNonce is a deliberate cache-buster; loadRegistry() reads localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => buildNameSet(loadRegistry().map((e) => e.channel)),
    [registryNonce]
  );
  const handleHashtagAdded = useCallback((channelName: string) => {
    const { result, added } = recordMention(channelName, loadRegistry());
    if (added) {
      saveRegistry(result);
      setRegistryNonce((n) => n + 1);
    }
  }, []);

  const handleBulkAddChannels = useCallback(
    async (channelNames: string[], tryHistorical: boolean) => {
      const result = await handleBulkCreateHashtagChannels(channelNames, tryHistorical);
      setBulkAddResult(result);
    },
    [handleBulkCreateHashtagChannels]
  );

  const statusProps = {
    health,
    config,
    brandName: appSettings?.brand_name || undefined,
    brandHidden: appSettings?.brand_hidden ?? false,
    brandIcon: appSettings?.brand_icon || undefined,
  };
  const sidebarProps = {
    contacts,
    channels,
    activeConversation,
    onSelectConversation: handleSelectConversationWithTargetReset,
    onNewMessage: handleOpenNewMessage,
    lastMessageTimes,
    unreadCounts,
    mentions,
    showCracker,
    crackerRunning,
    onToggleCracker: handleToggleCracker,
    onMarkAllRead: () => {
      void markAllRead();
    },
    onMarkSectionRead: markConversationsRead,
    onOpenChannelImportExport: () => setShowChannelImportExport(true),
    isConversationNotificationsEnabled,
    blockedKeys: appSettings?.blocked_keys ?? [],
    blockedNames: appSettings?.blocked_names ?? [],
    sidebarSectionOrder: appSettings?.sidebar_section_order ?? [],
    sidebarToolOrder: appSettings?.sidebar_tool_order ?? [],
    sidebarFavoritesOrder: appSettings?.sidebar_favorites_order ?? [],
    sidebarFavoriteSortOrders: appSettings?.sidebar_favorite_sort_orders,
    sidebarHidden: appSettings?.sidebar_hidden,
    contactGroups: appSettings?.contact_groups ?? [],
    ownPublicKey: config?.public_key ?? null,
    ownedKeys: health?.radio_identity?.owned_keys,
    onSaveSidebarOrder: handleSaveAppSettings,
  };
  const bulkAddChannelResultModalProps = {
    result: bulkAddResult,
  };
  const conversationPaneProps = {
    activeConversation,
    onNavigateToMessage: handleNavigateToMessage,
    contacts,
    channels,
    config,
    health,
    cadCapable: isMeshcomod,
    cadSupported,
    cadEnabled,
    onToggleCad: handleToggleCad,
    messages: sortedMessages,
    preSorted: activeContactIsRoom,
    messagesLoading,
    loadingOlder,
    hasOlderMessages,
    unreadMarkerMessageId:
      activeConversation?.type === 'channel' &&
      channelUnreadMarker?.channelId === activeConversation.id
        ? resolveUnreadMarkerId(
            channelUnreadMarker.messageId,
            unreadLastReadAts[getStateKey('channel', activeConversation.id)] ?? null,
            messages
          )
        : undefined,
    onNavigateToUnread: (messageId: number) => setTargetMessageId(messageId),
    onJumpToMessage: (messageId: number) => setTargetMessageId(messageId),
    onReactToMessage: handleReactToMessage,
    onRetryDirectMessage: handleRetryDirectMessage,
    onReplyToMessage: handleReplyToMessage,
    onDeleteMessage: handleDeleteMessage,
    onMarkUnreadFromMessage: handleMarkUnreadFromMessage,
    targetMessageId,
    hasNewerMessages,
    loadingNewer,
    messageInputRef,
    onTrace: handleTrace,
    onRunTracePath: api.requestRadioTrace,
    onPathDiscovery: handlePathDiscovery,
    onToggleFavorite: handleToggleFavorite,
    onToggleMute: handleToggleMute,
    onDeleteContact: handleDeleteContact,
    onDeleteChannel: handleDeleteChannel,
    onAddRegistryChannels: (channelNames: string[]) => handleBulkAddChannels(channelNames, false),
    onSetChannelFloodScopeOverride: handleSetChannelFloodScopeOverride,
    onSetChannelPathHashModeOverride: handleSetChannelPathHashModeOverride,
    onSelectConversation: handleSelectConversationWithTargetReset,
    onOpenContactInfo: handleOpenContactInfo,
    // Inline `<pubkey:type:Name>` share: add with the shared name/type, no
    // historical decrypt (a local radio command; nothing goes on air).
    onAddSharedContact: (publicKey: string, name: string, type: number) =>
      handleCreateContact(name, publicKey, false, type),
    onOpenChannelInfo: handleOpenChannelInfo,
    onSenderClick: handleSenderClick,
    onChannelReferenceClick: handleChannelReferenceClick,
    registryNames,
    packetFeedSort: appSettings?.packet_feed_sort ?? 'oldest',
    packetHistorySort: appSettings?.packet_history_sort ?? 'oldest',
    packetGroupByContent: appSettings?.packet_group_by_content ?? false,
    meshHealthPageSize: appSettings?.mesh_health_page_size ?? 50,
    mapHomeMode: appSettings?.map_home_mode ?? 'auto',
    mapHomeLat: appSettings?.map_home_lat ?? null,
    mapHomeLon: appSettings?.map_home_lon ?? null,
    mapHomeZoom: appSettings?.map_home_zoom ?? null,
    meshDiscovery,
    meshDiscoveryLoadingTarget,
    onDiscoverMesh: handleDiscoverMesh,
    onAdvertise: handleAdvertise,
    regionDiscovery,
    regionDiscoveryLoading,
    onDiscoverRegions: handleDiscoverRegions,
    onSaveAppSettings: handleSaveAppSettings,
    handyInfo: appSettings?.handy_info ?? null,
    autoAddMentionedChannels: appSettings?.auto_add_mentioned_channels ?? false,
    parsePubkeys: appSettings?.chat_parse_pubkeys ?? false,
    parseCoordinates: appSettings?.chat_parse_coordinates ?? false,
    linkifyUrls: appSettings?.chat_linkify_urls ?? true,
    showUrlPreviews: appSettings?.chat_url_previews ?? false,
    hiddenHopWidths,
    onHiddenHopWidthsChange: handleSetHiddenHopWidths,
    hideMalformed,
    onHideMalformedChange: handleSetHideMalformed,
    analyzerSites: appSettings?.analyzer_sites ?? [],
    onHashtagAdded: handleHashtagAdded,
    onInsertLocation: handleInsertLocation,
    onCoordinateClick: handleCoordinateClick,
    onLoadOlder: fetchOlderMessages,
    onResendChannelMessage: handleResendChannelMessage,
    onTargetReached: () => setTargetMessageId(null),
    onLoadNewer: fetchNewerMessages,
    onJumpToBottom: jumpToBottom,
    onSendMessage: handleSendMessage,
    onDismissUnreadMarker: () => setChannelUnreadMarker(null),
    notificationsSupported,
    notificationsPermission,
    notificationsEnabled:
      activeConversation?.type === 'contact' || activeConversation?.type === 'channel'
        ? isConversationNotificationsEnabled(activeConversation.type, activeConversation.id)
        : false,
    onToggleNotifications: () => {
      if (activeConversation?.type === 'contact' || activeConversation?.type === 'channel') {
        void toggleConversationNotifications(
          activeConversation.type,
          activeConversation.id,
          activeConversation.name
        );
      }
    },
    soundMuted:
      (activeConversation?.type === 'contact' || activeConversation?.type === 'channel') &&
      // soundMuteVersion forces recompute after a toggle (localStorage read).
      soundMuteVersion >= 0 &&
      isConversationSoundMuted(activeConversation.type, activeConversation.id),
    onToggleSoundMute: () => {
      if (activeConversation?.type === 'contact' || activeConversation?.type === 'channel') {
        toggleConversationSoundMuted(activeConversation.type, activeConversation.id);
        setSoundMuteVersion((v) => v + 1);
      }
    },
    pushSupported: pushSubscription.isSupported,
    pushSubscribed: pushSubscription.isSubscribed,
    pushEnabledForConversation:
      activeConversation?.type === 'contact' || activeConversation?.type === 'channel'
        ? pushSubscription.isConversationPushEnabled(
            getStateKey(activeConversation.type, activeConversation.id)
          )
        : false,
    onTogglePush: async () => {
      if (
        !activeConversation ||
        (activeConversation.type !== 'contact' && activeConversation.type !== 'channel')
      )
        return;
      const key = getStateKey(activeConversation.type, activeConversation.id);
      const pushEnabled = pushSubscription.isConversationPushEnabled(key);

      if (!pushEnabled && !pushSubscription.isSubscribed) {
        const subscriptionId = await pushSubscription.subscribe();
        if (!subscriptionId) {
          return;
        }
      }

      await pushSubscription.toggleConversation(key);
    },
    onOpenPushSettings: () => {
      if (popoutMode !== null) {
        openMainAppAt(getSettingsHash('local'));
        return;
      }
      setSettingsSection('local');
      if (!showSettings) handleToggleSettingsView();
    },
    trackedTelemetryRepeaters: appSettings?.tracked_telemetry_repeaters ?? [],
    onToggleTrackedTelemetry: handleToggleTrackedTelemetry,
    onSeedKnownRegions: handleSeedKnownRegions,
    repeaterAutoLoginKey,
    onClearRepeaterAutoLogin: () => setRepeaterAutoLoginKey(null),
    blockedKeys: appSettings?.blocked_keys,
    blockedNames: appSettings?.blocked_names,
    contactInfoViewProps: {
      onNavigateToChannel: handleNavigateToChannel,
      onNavigateToMessage: handleNavigateToMessage,
      onSearchMessagesByKey: (publicKey: string) => {
        handleOpenSearchWithQuery(`user:${publicKey}`);
      },
      onToggleBlockedKey: handleBlockKey,
      onToggleBlockedName: handleBlockName,
      trackedTelemetryContacts: appSettings?.tracked_telemetry_contacts ?? [],
      onToggleTrackedTelemetryContact: handleToggleTrackedTelemetryContact,
      contactGroups: appSettings?.contact_groups ?? [],
      onUpdateContactGroups: handleUpdateContactGroups,
      onOpenConversation: (publicKey: string) => {
        const target = contacts.find((c) => c.public_key === publicKey);
        handleSelectConversationWithTargetReset({
          type: 'contact',
          id: publicKey,
          name: getContactDisplayName(target?.name ?? null, publicKey, target?.last_advert ?? null),
        });
      },
    },
  };
  const searchProps = {
    contacts,
    channels,
    visibilityVersion,
    onNavigateToMessage: handleNavigateToMessage,
    prefillRequest: searchPrefillRequest,
  };
  const settingsProps = {
    config,
    health,
    appSettings,
    onSave: handleSaveConfig,
    onSaveAppSettings: handleSaveAppSettings,
    onSetPrivateKey: handleSetPrivateKey,
    onReboot: handleReboot,
    onDisconnect: handleDisconnect,
    onReconnect: handleReconnect,
    onAdvertise: handleAdvertise,
    onHealthRefresh: handleHealthRefresh,
    onRefreshAppSettings: fetchAppSettings,
    blockedKeys: appSettings?.blocked_keys,
    blockedNames: appSettings?.blocked_names,
    onToggleBlockedKey: handleBlockKey,
    onToggleBlockedName: handleBlockName,
    contacts,
    channels,
    onBulkDeleteContacts: (deletedKeys: string[]) => {
      const keySet = new Set(deletedKeys.map((k) => k.toLowerCase()));
      setContacts((prev) => prev.filter((c) => !keySet.has(c.public_key.toLowerCase())));
    },
    onBulkDeleteChannels: (deletedKeys: string[]) => {
      const keySet = new Set(deletedKeys.map((k) => k.toLowerCase()));
      setChannels((prev) => prev.filter((c) => !keySet.has(c.key.toLowerCase())));
    },
    trackedTelemetryRepeaters: appSettings?.tracked_telemetry_repeaters ?? [],
    onToggleTrackedTelemetry: handleToggleTrackedTelemetry,
    trackedTelemetryContacts: appSettings?.tracked_telemetry_contacts ?? [],
    onToggleTrackedTelemetryContact: handleToggleTrackedTelemetryContact,
    newNodeNotificationsSupported,
    newNodeNotificationsPermission,
    newNodeNotificationsEnabled,
    newNodeNotificationTypes,
    onSetNewNodeNotificationsEnabled: setNewNodeNotificationsEnabled,
    onSetNewNodeNotificationType: setNewNodeNotificationType,
  };
  const crackerProps = {
    channels,
    onChannelCreate: handleCreateCrackedChannel,
  };
  const newMessageModalProps = {
    undecryptedCount,
    showBulkAddChannelTab,
    prefillRequest: newMessagePrefillRequest,
    onCreateContact: handleCreateContact,
    onCreateChannel: handleCreateChannel,
    onCreateHashtagChannel: handleCreateHashtagChannel,
    onBulkAddHashtagChannels: handleBulkAddChannels,
    onImportContactUri: handleImportContactUri,
  };
  const contactInfoPaneProps = {
    contactKey: infoPaneContactKey,
    fromChannel: infoPaneFromChannel,
    onClose: handleCloseContactInfo,
    contacts,
    config,
    onToggleFavorite: handleToggleFavorite,
    onNavigateToChannel: handleNavigateToChannel,
    onNavigateToMessage: (target: SearchNavigateTarget) => {
      handleCloseContactInfo();
      handleNavigateToMessage(target);
    },
    onSearchMessagesByKey: (publicKey: string) => {
      handleOpenSearchWithQuery(`user:${publicKey}`);
    },
    onSearchMessagesByName: (name: string) => {
      handleOpenSearchWithQuery(`user:${quoteSearchOperatorValue(name)}`);
    },
    onToggleBlockedKey: handleBlockKey,
    onToggleBlockedName: handleBlockName,
    blockedKeys: appSettings?.blocked_keys ?? [],
    blockedNames: appSettings?.blocked_names ?? [],
    trackedTelemetryContacts: appSettings?.tracked_telemetry_contacts ?? [],
    onToggleTrackedTelemetryContact: handleToggleTrackedTelemetryContact,
    analyzerSites: appSettings?.analyzer_sites ?? [],
    contactGroups: appSettings?.contact_groups ?? [],
    onUpdateContactGroups: handleUpdateContactGroups,
    onOpenContactInfo: handleOpenContactInfo,
    onOpenConversation: (publicKey: string) => {
      const target = contacts.find((c) => c.public_key === publicKey);
      handleSelectConversationWithTargetReset({
        type: 'contact',
        id: publicKey,
        name: getContactDisplayName(target?.name ?? null, publicKey, target?.last_advert ?? null),
      });
      handleCloseContactInfo();
    },
  };
  const channelInfoPaneProps = {
    channelKey: infoPaneChannelKey,
    onClose: handleCloseChannelInfo,
    channels,
    onToggleFavorite: handleToggleFavorite,
    analyzerSites: appSettings?.analyzer_sites ?? [],
    contactGroups: appSettings?.contact_groups ?? [],
    onUpdateContactGroups: handleUpdateContactGroups,
    onEditInRegistry: (channelKey: string) => {
      handleCloseChannelInfo();
      handleSelectConversationWithTargetReset({
        type: 'channel-registry',
        id: 'channel-registry',
        name: 'Channel Registry',
        registryEditKey: channelKey,
      });
    },
  };

  // Connect to WebSocket. The popup asks for the chat profile, which leaves
  // out the raw packet stream it never renders.
  useWebSocket(wsHandlers, popoutMode !== null ? 'chat' : undefined);

  const handleOpenChatWindow = useCallback(() => {
    const conv = isChatConversation(activeConversation, contacts) ? activeConversation : null;
    if (!openChatPopout('chat', conv)) {
      toast.error(t('popout_blocked'));
    }
  }, [activeConversation, contacts, t]);

  // Initial fetch for config, settings, and data
  useEffect(() => {
    fetchConfig();
    fetchAppSettings();
    fetchUndecryptedCount();

    // Seed the raw packet feed from the DB so recent history is present on load
    // (and after a full reload), not just packets observed live over the WS.
    // The chat popup has no packet views, so it skips this.
    if (popoutMode === null) {
      api
        .getRecentPackets({ limit: MAX_RAW_PACKETS })
        .then((data) => seedRawPacketStore({ packets: Array.isArray(data) ? data : [] }))
        .catch(console.error);
    }

    // Fetch contacts and channels via REST (parallel, faster than WS serial push)
    takePrefetchOrFetch('channels', api.getChannels).then(setChannels).catch(console.error);
    fetchAllContacts()
      .then((data) => {
        setContacts(data);
        setContactsLoaded(true);
      })
      .catch((err) => {
        console.error(err);
        setContactsLoaded(true);
      });
  }, [
    fetchConfig,
    fetchAppSettings,
    fetchUndecryptedCount,
    fetchAllContacts,
    setChannels,
    setContacts,
    setContactsLoaded,
    popoutMode,
  ]);
  return (
    <DistanceUnitProvider distanceUnit={distanceUnit} setDistanceUnit={setDistanceUnit}>
      <RichPayloadProvider
        renderRichPayloads={renderRichPayloads}
        setRenderRichPayloads={setRenderRichPayloads}
      >
        <PathHopWidthProvider
          showPathHopWidth={showPathHopWidth}
          setShowPathHopWidth={setShowPathHopWidth}
        >
          <LocationPreviewProvider
            showLocationPreview={showLocationPreview}
            setShowLocationPreview={setShowLocationPreview}
          >
            {popoutMode !== null ? (
              <ChatPopoutShell
                mode={popoutMode}
                showNewMessage={showNewMessage}
                showBulkAddResults={bulkAddResult !== null}
                onCloseNewMessage={handleCloseNewMessage}
                onCloseBulkAddResults={handleCloseBulkAddResults}
                statusProps={statusProps}
                sidebarProps={sidebarProps}
                conversationPaneProps={conversationPaneProps}
                searchProps={searchProps}
                newMessageModalProps={newMessageModalProps}
                bulkAddChannelResultModalProps={bulkAddChannelResultModalProps}
                contactInfoPaneProps={contactInfoPaneProps}
                channelInfoPaneProps={channelInfoPaneProps}
              />
            ) : (
              <AppShell
                onOpenChatWindow={handleOpenChatWindow}
                localLabel={localLabel}
                showNewMessage={showNewMessage}
                showBulkAddResults={bulkAddResult !== null}
                showSettings={showSettings}
                settingsSection={settingsSection}
                sidebarOpen={sidebarOpen}
                showCracker={showCracker}
                onSettingsSectionChange={setSettingsSection}
                onSidebarOpenChange={setSidebarOpen}
                onCrackerRunningChange={setCrackerRunning}
                onToggleSettingsView={handleToggleSettingsView}
                onCloseSettingsView={handleCloseSettingsView}
                onCloseNewMessage={handleCloseNewMessage}
                onCloseBulkAddResults={handleCloseBulkAddResults}
                onLocalLabelChange={setLocalLabel}
                statusProps={statusProps}
                sidebarProps={sidebarProps}
                conversationPaneProps={conversationPaneProps}
                searchProps={searchProps}
                settingsProps={settingsProps}
                crackerProps={crackerProps}
                newMessageModalProps={newMessageModalProps}
                bulkAddChannelResultModalProps={bulkAddChannelResultModalProps}
                contactInfoPaneProps={contactInfoPaneProps}
                channelInfoPaneProps={channelInfoPaneProps}
                showMentionTicker={appSettings?.show_mention_ticker ?? true}
                mentionTickerEvents={pendingMentions}
                onNavigateMentionToMessage={(channelKey, messageId) => {
                  const ch = channelsRef.current.find((c) => c.key === channelKey);
                  handleNavigateToMessage({
                    id: messageId,
                    type: 'CHAN',
                    conversation_key: channelKey,
                    conversation_name: ch ? `#${ch.name}` : channelKey,
                  });
                }}
                onDismissMention={handleDismissMention}
                onRepeaterAutoLogin={handleRepeaterAutoLogin}
              />
            )}
            <ChannelImportExportModal
              open={showChannelImportExport}
              onClose={() => setShowChannelImportExport(false)}
              channels={channels}
              crackerFoundChannels={[]}
              onChannelsImported={() => {
                api.getChannels().then(setChannels).catch(console.error);
              }}
            />
          </LocationPreviewProvider>
        </PathHopWidthProvider>
      </RichPayloadProvider>
    </DistanceUnitProvider>
  );
}
