import { lazy, Suspense, useMemo, useState, type Ref } from 'react';

import { ChatHeader } from './ChatHeader';
import { ChannelUnreadSummaryBanner } from './ChannelUnreadSummaryBanner';
import { MessageInput, type MessageInputHandle } from './MessageInput';
import { MessageList } from './MessageList';
import { RawPacketFeedView } from './RawPacketFeedView';
import { RoomServerPanel } from './RoomServerPanel';
import { TracePane } from './TracePane';
import type {
  Channel,
  Contact,
  Conversation,
  HealthStatus,
  Message,
  PathDiscoveryResponse,
  RadioAdvertMode,
  RadioConfig,
  RadioDiscoveryResponse,
  RadioDiscoveryTarget,
  RadioRegionDiscoveryResponse,
  RadioTraceHopRequest,
  RadioTraceResponse,
} from '../types';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../types';
import { CompanionCliConsole } from './CompanionCliConsole';
import { MeshcomodContactNotice } from './MeshcomodContactNotice';
import { SensorDashboardPanel } from './repeater/SensorDashboardPanel';
import {
  getContactDisplayName,
  isPrefixOnlyContact,
  isUnknownFullKeyContact,
} from '../utils/pubkey';
import { useT } from '../i18n';
import { isMeshcomodCommandContact, isRiskyMeshcomodCommand } from '../utils/meshcomodContact';
import { useIsMobile } from '../map/controls/breakpoints';
import type { SearchNavigateTarget } from './SearchView';

const RepeaterDashboard = lazy(() =>
  import('./RepeaterDashboard').then((m) => ({ default: m.RepeaterDashboard }))
);
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));
const VisualizerView = lazy(() =>
  import('./VisualizerView').then((m) => ({ default: m.VisualizerView }))
);
const ChannelRegistryView = lazy(() => import('./ChannelRegistryView'));
const MyNodeView = lazy(() => import('./MyNodeView'));
const MeshHealthView = lazy(() =>
  import('./MeshHealthView').then((m) => ({ default: m.MeshHealthView }))
);
const MeshTrendsView = lazy(() =>
  import('./MeshTrendsView').then((m) => ({ default: m.MeshTrendsView }))
);
const SpamGuardView = lazy(() =>
  import('./SpamGuardView').then((m) => ({ default: m.SpamGuardView }))
);
const LanScanView = lazy(() => import('./LanScanView').then((m) => ({ default: m.LanScanView })));
const PerformanceView = lazy(() =>
  import('./PerformanceView').then((m) => ({ default: m.PerformanceView }))
);
const MeshDiscoveryView = lazy(() =>
  import('./MeshDiscoveryView').then((m) => ({ default: m.MeshDiscoveryView }))
);
const SnmpView = lazy(() => import('./SnmpView').then((m) => ({ default: m.SnmpView })));
const SnmpNodeView = lazy(() =>
  import('./SnmpNodeView').then((m) => ({ default: m.SnmpNodeView }))
);
const FleetView = lazy(() => import('./FleetView').then((m) => ({ default: m.FleetView })));
const FleetAssetView = lazy(() =>
  import('./FleetAssetView').then((m) => ({ default: m.FleetAssetView }))
);
const FleetOnboardView = lazy(() =>
  import('./FleetOnboardView').then((m) => ({ default: m.FleetOnboardView }))
);
const FleetTemplatesView = lazy(() =>
  import('./FleetTemplatesView').then((m) => ({ default: m.FleetTemplatesView }))
);
const AnalyzePacketView = lazy(() =>
  import('./AnalyzePacketView').then((m) => ({ default: m.AnalyzePacketView }))
);
const PacketHistoryView = lazy(() =>
  import('./PacketHistoryView').then((m) => ({ default: m.PacketHistoryView }))
);
const ManualView = lazy(() => import('./ManualView').then((m) => ({ default: m.ManualView })));
const KnowledgeBaseView = lazy(() =>
  import('./KnowledgeBaseView').then((m) => ({ default: m.KnowledgeBaseView }))
);
const LinkDetailView = lazy(() =>
  import('./LinkDetailView').then((m) => ({ default: m.LinkDetailView }))
);
const ContactInfoView = lazy(() =>
  import('./ContactInfoView').then((m) => ({ default: m.ContactInfoView }))
);

interface ConversationPaneProps {
  activeConversation: Conversation | null;
  sidebarOpen?: boolean;
  contacts: Contact[];
  channels: Channel[];
  config: RadioConfig | null;
  health: HealthStatus | null;
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationsPermission: NotificationPermission | 'unsupported';
  messages: Message[];
  preSorted?: boolean;
  messagesLoading: boolean;
  loadingOlder: boolean;
  hasOlderMessages: boolean;
  unreadMarkerMessageId?: number | null;
  /** Read boundary to summarize unreads from, or null when no summary applies. */
  unreadSummaryAfter?: number | null;
  onNavigateToUnread?: (messageId: number) => void;
  onJumpToMessage?: (messageId: number) => void;
  onReactToMessage?: (messageId: number, emoji: string) => void;
  onReplyToMessage?: (message: Message) => void;
  onDeleteMessage?: (message: Message) => void;
  /** Retry a failed outgoing DM (sends a new copy that replaces it). */
  onRetryDirectMessage?: (messageId: number) => void | Promise<void>;
  onMarkUnreadFromMessage?: (message: Message) => void;
  targetMessageId: number | null;
  hasNewerMessages: boolean;
  loadingNewer: boolean;
  messageInputRef: Ref<MessageInputHandle>;
  onTrace: () => Promise<void>;
  onRunTracePath: (
    hopHashBytes: 1 | 2 | 4,
    hops: RadioTraceHopRequest[]
  ) => Promise<RadioTraceResponse>;
  onPathDiscovery: (publicKey: string) => Promise<PathDiscoveryResponse>;
  onToggleFavorite: (type: 'channel' | 'contact', id: string) => Promise<void>;
  onToggleMute: (key: string) => Promise<void>;
  onDeleteContact: (publicKey: string) => Promise<void>;
  onDeleteChannel: (key: string) => Promise<void>;
  onAddRegistryChannels?: (channelNames: string[]) => Promise<void>;
  onSetChannelFloodScopeOverride: (channelKey: string, floodScopeOverride: string) => Promise<void>;
  onSetContactFloodScopeOverride: (publicKey: string, floodScopeOverride: string) => Promise<void>;
  onSetChannelPathHashModeOverride?: (
    channelKey: string,
    pathHashModeOverride: number | null
  ) => Promise<void>;
  cadCapable?: boolean;
  cadSupported?: boolean;
  cadEnabled?: boolean | null;
  onToggleCad?: () => void;
  onSelectConversation: (conversation: Conversation) => void;
  onOpenContactInfo: (publicKey: string, fromChannel?: boolean) => void;
  /** Add a contact shared inline as `<pubkey:type:Name>` in a message. */
  onAddSharedContact?: (publicKey: string, name: string, type: number) => void | Promise<void>;
  onOpenChannelInfo: (channelKey: string) => void;
  onSenderClick: (sender: string) => void;
  onChannelReferenceClick?: (channelName: string) => void;
  registryNames?: Set<string>;
  autoAddMentionedChannels?: boolean;
  parsePubkeys?: boolean;
  parseCoordinates?: boolean;
  linkifyUrls?: boolean;
  showUrlPreviews?: boolean;
  hiddenHopWidths?: readonly number[];
  onHiddenHopWidthsChange?: (widths: number[]) => void;
  hideMalformed?: boolean;
  onHideMalformedChange?: (hide: boolean) => void;
  /** Spam Guard master switch: the page and the chat spam actions exist only while on. */
  spamGuardEnabled?: boolean;
  hideSpam?: boolean;
  onHideSpamChange?: (hide: boolean) => void;
  hideBots?: boolean;
  onHideBotsChange?: (hide: boolean) => void;
  onSpamFeedback?: (message: Message, spam: boolean) => void;
  analyzerSites?: import('../types').AnalyzerSite[];
  onHashtagAdded?: (channelName: string) => void;
  onInsertLocation?: (
    lat: number,
    lon: number,
    label: string,
    options?: import('../utils/teamPayloads').TeamLocationFormat
  ) => void;
  onCoordinateClick?: (lat: number, lon: number, label: string) => void;
  /** Open a chat message by id (map shared-locations popup). */
  onNavigateToMessage?: (target: SearchNavigateTarget) => void;
  onLoadOlder: () => Promise<void>;
  onResendChannelMessage: (messageId: number, newTimestamp?: boolean) => Promise<void>;
  onTargetReached: () => void;
  onLoadNewer: () => Promise<void>;
  onJumpToBottom: () => void;
  onDismissUnreadMarker: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onToggleNotifications: () => void;
  soundMuted?: boolean;
  onToggleSoundMute?: () => void;
  pushSupported?: boolean;
  pushSubscribed?: boolean;
  pushEnabledForConversation?: boolean;
  onTogglePush?: () => void;
  onOpenPushSettings?: () => void;
  trackedTelemetryRepeaters: string[];
  onToggleTrackedTelemetry: (publicKey: string) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
  repeaterAutoLoginKey: string | null;
  onClearRepeaterAutoLogin: () => void;
  blockedKeys?: string[];
  blockedNames?: string[];
  packetFeedSort?: 'oldest' | 'newest';
  packetHistorySort?: 'oldest' | 'newest';
  packetGroupByContent?: boolean;
  meshHealthPageSize?: number;
  mapHomeMode?: import('../map/homeView').MapHomeMode;
  mapHomeLat?: number | null;
  mapHomeLon?: number | null;
  mapHomeZoom?: number | null;
  meshDiscovery?: RadioDiscoveryResponse | null;
  meshDiscoveryLoadingTarget?: RadioDiscoveryTarget | null;
  onDiscoverMesh?: (target: RadioDiscoveryTarget) => Promise<void>;
  onAdvertise?: (mode: RadioAdvertMode) => Promise<void>;
  regionDiscovery?: RadioRegionDiscoveryResponse | null;
  regionDiscoveryLoading?: boolean;
  onDiscoverRegions?: (publicKeys?: string[]) => Promise<void>;
  onSaveAppSettings?: (update: import('../types').AppSettingsUpdate) => Promise<void> | void;
  /** Handy Info overlay; the Knowledge base view lists its flagged links. */
  handyInfo?: import('../types').HandyInfoSettings | null;
  /** Handlers the desktop full-page contact-info view needs beyond the ones
   *  ConversationPane already receives (contacts/config/favorite/blocked/analyzer). */
  contactInfoViewProps?: {
    onNavigateToChannel?: (channelKey: string) => void;
    onNavigateToMessage?: (target: SearchNavigateTarget) => void;
    onSearchMessagesByKey?: (publicKey: string) => void;
    onToggleBlockedKey?: (key: string) => void;
    onToggleBlockedName?: (name: string) => void;
    trackedTelemetryContacts?: string[];
    onToggleTrackedTelemetryContact?: (publicKey: string) => Promise<void>;
    contactGroups?: import('../types').ContactGroup[];
    onUpdateContactGroups?: (next: import('../types').ContactGroup[]) => void | Promise<void>;
    onOpenConversation?: (publicKey: string) => void;
    onOpenFleetAsset?: (assetId: number) => void;
  };
}

function LoadingPane({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">{label}</div>
  );
}

function ContactResolutionBanner({ variant }: { variant: 'unknown-full-key' | 'prefix-only' }) {
  const t = useT();
  if (variant === 'prefix-only') {
    return (
      <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {t('chat_prefix_only_banner')}
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
      {t('chat_unknown_full_key_banner')}
    </div>
  );
}

export function ConversationPane({
  activeConversation,
  sidebarOpen,
  contacts,
  channels,
  config,
  health,
  notificationsSupported,
  notificationsEnabled,
  notificationsPermission,
  messages,
  preSorted,
  messagesLoading,
  loadingOlder,
  hasOlderMessages,
  unreadMarkerMessageId,
  unreadSummaryAfter = null,
  onNavigateToUnread,
  onJumpToMessage,
  onReactToMessage,
  onReplyToMessage,
  onDeleteMessage,
  onRetryDirectMessage,
  onMarkUnreadFromMessage,
  targetMessageId,
  hasNewerMessages,
  loadingNewer,
  messageInputRef,
  onTrace,
  onRunTracePath,
  onPathDiscovery,
  onToggleFavorite,
  onToggleMute,
  onDeleteContact,
  onDeleteChannel,
  onAddRegistryChannels,
  onSetChannelFloodScopeOverride,
  onSetContactFloodScopeOverride,
  onSetChannelPathHashModeOverride,
  cadCapable,
  cadSupported,
  cadEnabled,
  onToggleCad,
  onSelectConversation,
  onOpenContactInfo,
  onAddSharedContact,
  onOpenChannelInfo,
  onSenderClick,
  onChannelReferenceClick,
  registryNames,
  autoAddMentionedChannels,
  parsePubkeys,
  parseCoordinates,
  linkifyUrls,
  showUrlPreviews,
  hiddenHopWidths,
  onHiddenHopWidthsChange,
  hideMalformed,
  onHideMalformedChange,
  spamGuardEnabled,
  hideSpam,
  onHideSpamChange,
  hideBots,
  onHideBotsChange,
  onSpamFeedback,
  analyzerSites,
  onHashtagAdded,
  onInsertLocation,
  onCoordinateClick,
  onNavigateToMessage,
  onLoadOlder,
  onResendChannelMessage,
  onTargetReached,
  onLoadNewer,
  onJumpToBottom,
  onDismissUnreadMarker,
  onSendMessage,
  onToggleNotifications,
  soundMuted,
  onToggleSoundMute,
  pushSupported,
  pushSubscribed,
  pushEnabledForConversation,
  onTogglePush,
  onOpenPushSettings,
  trackedTelemetryRepeaters,
  onToggleTrackedTelemetry,
  onSeedKnownRegions,
  repeaterAutoLoginKey,
  onClearRepeaterAutoLogin,
  blockedKeys,
  blockedNames,
  packetFeedSort,
  packetHistorySort,
  packetGroupByContent,
  meshHealthPageSize,
  mapHomeMode,
  mapHomeLat,
  mapHomeLon,
  mapHomeZoom,
  meshDiscovery = null,
  meshDiscoveryLoadingTarget = null,
  onDiscoverMesh,
  onAdvertise,
  regionDiscovery = null,
  regionDiscoveryLoading = false,
  onDiscoverRegions,
  onSaveAppSettings,
  handyInfo,
  contactInfoViewProps,
}: ConversationPaneProps) {
  const t = useT();
  // Commands to meshcomod's command contact that restart the radio or can cut
  // this app off from it are confirmed first; a "no" keeps the text in the box.
  const confirmMeshcomodCommand = (text: string) =>
    !isRiskyMeshcomodCommand(text) ||
    window.confirm(t('meshcomod_contact_confirm', { command: text }));
  const isMobile = useIsMobile();
  const [roomAuthenticated, setRoomAuthenticated] = useState(false);
  // Chat contact whose DM shows the companion command line instead of the
  // message list; switching conversation closes it.
  const [cliConsoleOpenFor, setCliConsoleOpenFor] = useState<string | null>(null);
  const activeContactIsRepeater = useMemo(() => {
    if (!activeConversation || activeConversation.type !== 'contact') return false;
    const contact = contacts.find((candidate) => candidate.public_key === activeConversation.id);
    return contact?.type === CONTACT_TYPE_REPEATER;
  }, [activeConversation, contacts]);
  const activeContact = useMemo(() => {
    if (!activeConversation || activeConversation.type !== 'contact') return null;
    return contacts.find((candidate) => candidate.public_key === activeConversation.id) ?? null;
  }, [activeConversation, contacts]);
  const activeContactIsRoom = activeContact?.type === CONTACT_TYPE_ROOM;
  // Sensors keep their chat (alerts arrive as plain DMs) with the sensor
  // dashboard as a collapsible panel above it.
  const activeContactIsSensor = activeContact?.type === CONTACT_TYPE_SENSOR;
  // Reset the room login gate when the conversation changes, during render and
  // not from an effect: an effect here runs after the remounted RoomServerPanel
  // has reported its cached login, and would hide the chat of a logged-in room.
  const [roomGateConversationId, setRoomGateConversationId] = useState(activeConversation?.id);
  if (roomGateConversationId !== activeConversation?.id) {
    setRoomGateConversationId(activeConversation?.id);
    setRoomAuthenticated(false);
  }
  const isPrefixOnlyActiveContact = activeContact
    ? isPrefixOnlyContact(activeContact.public_key)
    : false;
  // meshcomod's command contact never adverts, so it has no profile to wait for.
  const isMeshcomodChat =
    activeContact !== null && isMeshcomodCommandContact(activeContact.public_key);
  const isUnknownFullKeyActiveContact =
    activeContact !== null &&
    !isPrefixOnlyActiveContact &&
    !isMeshcomodChat &&
    isUnknownFullKeyContact(activeContact.public_key, activeContact.last_advert);

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {t('chat_select_conversation')}
      </div>
    );
  }

  if (activeConversation.type === 'map') {
    return (
      <>
        <h2 className="flex justify-between items-center px-4 py-2.5 border-b border-border font-semibold text-base">
          {t('nav_node_map')}
        </h2>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<LoadingPane label={t('common_loading_map')} />}>
            <MapView
              contacts={contacts}
              sidebarOpen={sidebarOpen}
              focusedKey={activeConversation.mapFocusKey}
              focusedLatLon={activeConversation.mapFocusLatLon}
              focusedLabel={activeConversation.mapFocusLabel}
              mapHomeMode={mapHomeMode}
              mapHomeLat={mapHomeLat}
              mapHomeLon={mapHomeLon}
              mapHomeZoom={mapHomeZoom}
              config={config}
              blockedKeys={blockedKeys}
              blockedNames={blockedNames}
              onSelectContact={(contact) =>
                onSelectConversation({
                  type: 'contact',
                  id: contact.public_key,
                  name: getContactDisplayName(
                    contact.name,
                    contact.public_key,
                    contact.last_advert
                  ),
                })
              }
              onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)}
              onOpenLink={(a, b) =>
                onSelectConversation({ type: 'link', id: `${a}~${b}`, name: 'Link' })
              }
              onNavigateToMessage={onNavigateToMessage}
            />
          </Suspense>
        </div>
      </>
    );
  }

  if (activeConversation.type === 'visualizer') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_visualizer')} />}>
        <VisualizerView contacts={contacts} channels={channels} config={config} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'raw') {
    return (
      <RawPacketFeedView
        channels={channels}
        contacts={contacts}
        analyzerSites={analyzerSites}
        packetFeedSort={packetFeedSort}
        packetGroupByContent={packetGroupByContent}
        onSaveAppSettings={onSaveAppSettings}
      />
    );
  }

  if (activeConversation.type === 'mesh-trends') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_mesh_trends')} />}>
        <MeshTrendsView contacts={contacts} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'performance') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_performance')} />}>
        <PerformanceView />
      </Suspense>
    );
  }

  if (activeConversation.type === 'spam-guard') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_spam_guard')} />}>
        <SpamGuardView contacts={contacts} channels={channels} health={health} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'mesh-discovery') {
    if (!onDiscoverMesh) return null;
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_mesh_discovery')} />}>
        <MeshDiscoveryView
          health={health}
          meshDiscovery={meshDiscovery}
          meshDiscoveryLoadingTarget={meshDiscoveryLoadingTarget}
          onDiscoverMesh={onDiscoverMesh}
          onAdvertise={onAdvertise}
          regionDiscovery={regionDiscovery}
          regionDiscoveryLoading={regionDiscoveryLoading}
          onDiscoverRegions={onDiscoverRegions}
          onSeedKnownRegions={onSeedKnownRegions}
        />
      </Suspense>
    );
  }

  if (activeConversation.type === 'snmp') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_snmp')} />}>
        {activeConversation.id === 'snmp' ? (
          <SnmpView
            onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)}
            onOpenNode={(publicKey) =>
              onSelectConversation({ type: 'snmp', id: publicKey, name: t('nav_snmp') })
            }
          />
        ) : (
          <SnmpNodeView
            // A fresh page per node: no state of the previous node lingers.
            key={activeConversation.id}
            publicKey={activeConversation.id}
            onBack={() => onSelectConversation({ type: 'snmp', id: 'snmp', name: t('nav_snmp') })}
            onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)}
          />
        )}
      </Suspense>
    );
  }

  if (activeConversation.type === 'lan-scan') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_lan_scan')} />}>
        <LanScanView onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'fleet') {
    const openFleetPage = (id: string) =>
      onSelectConversation({ type: 'fleet', id, name: t('nav_fleet') });
    const openFleetAsset = (assetId: number | 'new') => openFleetPage(String(assetId));
    const openFleetTemplates = () => openFleetPage('templates');
    const openFleetOnboard = () => openFleetPage('onboard');
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_fleet')} />}>
        {activeConversation.id === 'fleet' ? (
          <FleetView
            contacts={contacts}
            ownerKeys={[config?.public_key ?? '', ...(health?.radio_identity?.owned_keys ?? [])]}
            onOpenAsset={openFleetAsset}
            onOpenTemplates={openFleetTemplates}
            onOpenOnboard={openFleetOnboard}
            onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)}
          />
        ) : activeConversation.id === 'templates' ? (
          <FleetTemplatesView onBack={() => openFleetPage('fleet')} />
        ) : activeConversation.id === 'onboard' ? (
          <FleetOnboardView onBack={() => openFleetPage('fleet')} onOpenAsset={openFleetAsset} />
        ) : (
          <FleetAssetView
            // A fresh page per asset: no state of the previous one lingers.
            key={activeConversation.id}
            assetId={activeConversation.id === 'new' ? 'new' : Number(activeConversation.id)}
            onBack={() => openFleetPage('fleet')}
            onOpenAsset={openFleetAsset}
            onOpenTemplates={openFleetTemplates}
            onOpenContactInfo={(publicKey) => onOpenContactInfo(publicKey)}
          />
        )}
      </Suspense>
    );
  }

  if (activeConversation.type === 'analyze') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_analyze_packet')} />}>
        <AnalyzePacketView channels={channels} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'link') {
    const [a, b] = activeConversation.id.split('~');
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_link_detail')} />}>
        <LinkDetailView
          a={a}
          b={b}
          channels={channels}
          onBack={() => window.history.back()}
          onOpenContactInfo={onOpenContactInfo}
        />
      </Suspense>
    );
  }

  if (activeConversation.type === 'packet-history') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_packet_history')} />}>
        <PacketHistoryView
          contacts={contacts}
          channels={channels}
          packetHistorySort={packetHistorySort}
          packetGroupByContent={packetGroupByContent}
          onSaveAppSettings={onSaveAppSettings}
        />
      </Suspense>
    );
  }

  if (activeConversation.type === 'manual') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_user_guide')} />}>
        <ManualView />
      </Suspense>
    );
  }

  if (activeConversation.type === 'knowledge-base') {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading')} />}>
        <KnowledgeBaseView handyInfo={handyInfo} onSaveAppSettings={onSaveAppSettings} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'search') {
    return null;
  }

  if (activeConversation.type === 'trace') {
    return <TracePane contacts={contacts} config={config} onRunTracePath={onRunTracePath} />;
  }

  if (activeConversation.type === 'channel-registry') {
    return (
      <Suspense fallback={<LoadingPane label="Loading channel registry..." />}>
        <ChannelRegistryView
          channels={channels}
          onAddToChannels={onAddRegistryChannels}
          editChannelKey={activeConversation.registryEditKey}
        />
      </Suspense>
    );
  }

  if (activeConversation.type === 'node') {
    return (
      <Suspense fallback={<LoadingPane label="Loading node analytics..." />}>
        <MyNodeView contacts={contacts} onCoordinateClick={onCoordinateClick} />
      </Suspense>
    );
  }

  if (activeConversation.type === 'mesh-health') {
    return (
      <Suspense fallback={<LoadingPane label="Loading mesh health..." />}>
        <MeshHealthView
          config={config}
          contacts={contacts}
          onNavigateToMap={(focusKey?: string) =>
            onSelectConversation({
              type: 'map',
              id: 'map',
              name: 'Node Map',
              ...(focusKey ? { mapFocusKey: focusKey } : {}),
            })
          }
          onOpenNode={(publicKey: string, name: string | null) =>
            onSelectConversation({
              type: 'contact',
              id: publicKey,
              name: name ?? publicKey,
            })
          }
          pageSize={meshHealthPageSize}
          onSaveAppSettings={onSaveAppSettings}
        />
      </Suspense>
    );
  }

  // Desktop full-page contact info: the dedicated `contact-info` route, and the
  // desktop convergence where a repeater `#contact/...` link lands on the
  // combined info + embedded login/dashboard page (mobile keeps the standalone
  // dashboard/panel below). Rooms are group chats, so they stay on the chat
  // path (login panel + message list + composer + favourite star) and are only
  // shown in the full-page view via the explicit `contact-info` route.
  const showContactInfoView =
    activeConversation.type === 'contact-info' ||
    (!isMobile && activeConversation.type === 'contact' && activeContactIsRepeater);

  if (showContactInfoView) {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading')} />}>
        <ContactInfoView
          publicKey={activeConversation.id}
          contacts={contacts}
          config={config}
          onBack={() => window.history.back()}
          onToggleFavorite={onToggleFavorite}
          analyzerSites={analyzerSites}
          onOpenContactInfo={onOpenContactInfo}
          blockedKeys={blockedKeys}
          blockedNames={blockedNames}
          radioLat={config?.lat ?? null}
          radioLon={config?.lon ?? null}
          radioName={config?.name ?? null}
          notificationsSupported={notificationsSupported}
          notificationsEnabled={notificationsEnabled}
          notificationsPermission={notificationsPermission}
          onToggleNotifications={onToggleNotifications}
          onTrace={onTrace}
          onPathDiscovery={onPathDiscovery}
          onDeleteContact={onDeleteContact}
          cliSupported={!!health?.radio_device_info?.cli_supported}
          trackedTelemetryRepeaters={trackedTelemetryRepeaters}
          onToggleTrackedTelemetry={onToggleTrackedTelemetry}
          onSeedKnownRegions={onSeedKnownRegions}
          repeaterAutoLoginKey={repeaterAutoLoginKey}
          onClearRepeaterAutoLogin={onClearRepeaterAutoLogin}
          {...contactInfoViewProps}
        />
      </Suspense>
    );
  }

  // `contact-info` is always handled by showContactInfoView above; this guard
  // narrows the union so the chat fall-through below only sees chat types.
  if (activeConversation.type === 'contact-info') {
    return null;
  }

  if (activeContactIsRepeater) {
    return (
      <Suspense fallback={<LoadingPane label={t('common_loading_dashboard')} />}>
        <RepeaterDashboard
          key={activeConversation.id}
          conversation={activeConversation}
          contacts={contacts}
          notificationsSupported={notificationsSupported}
          notificationsEnabled={notificationsEnabled}
          notificationsPermission={notificationsPermission}
          radioLat={config?.lat ?? null}
          radioLon={config?.lon ?? null}
          radioName={config?.name ?? null}
          onTrace={onTrace}
          onPathDiscovery={onPathDiscovery}
          onToggleNotifications={onToggleNotifications}
          onToggleFavorite={onToggleFavorite}
          onDeleteContact={onDeleteContact}
          onOpenContactInfo={onOpenContactInfo}
          trackedTelemetryRepeaters={trackedTelemetryRepeaters}
          onToggleTrackedTelemetry={onToggleTrackedTelemetry}
          onSeedKnownRegions={onSeedKnownRegions}
          autoLoginAndLoadAll={repeaterAutoLoginKey === activeConversation.id}
          onAutoLoginConsumed={onClearRepeaterAutoLogin}
        />
      </Suspense>
    );
  }

  // meshcomod's command contact takes its commands as plain messages.
  const cliConsoleAvailable = activeContact?.type === CONTACT_TYPE_CLIENT && !isMeshcomodChat;
  const cliConsoleOpen =
    cliConsoleAvailable &&
    activeConversation.type === 'contact' &&
    cliConsoleOpenFor === activeConversation.id;
  const showRoomChat = (!activeContactIsRoom || roomAuthenticated) && !cliConsoleOpen;

  const openChannelInRegistry = (channelKey: string) =>
    onSelectConversation({
      type: 'channel-registry',
      id: 'channel-registry',
      name: 'Channel Registry',
      registryEditKey: channelKey,
    });

  return (
    <>
      <ChatHeader
        conversation={activeConversation}
        contacts={contacts}
        channels={channels}
        config={config}
        analyzerSites={analyzerSites}
        notificationsSupported={notificationsSupported}
        notificationsEnabled={notificationsEnabled}
        notificationsPermission={notificationsPermission}
        pushSupported={pushSupported}
        pushSubscribed={pushSubscribed}
        pushEnabledForConversation={pushEnabledForConversation}
        onTogglePush={onTogglePush}
        onOpenPushSettings={onOpenPushSettings}
        onTrace={onTrace}
        onPathDiscovery={onPathDiscovery}
        onToggleNotifications={onToggleNotifications}
        soundMuted={soundMuted}
        onToggleSoundMute={onToggleSoundMute}
        onToggleFavorite={onToggleFavorite}
        onToggleMute={onToggleMute}
        onSetChannelFloodScopeOverride={onSetChannelFloodScopeOverride}
        onSetContactFloodScopeOverride={onSetContactFloodScopeOverride}
        onSetChannelPathHashModeOverride={onSetChannelPathHashModeOverride}
        cadCapable={cadCapable}
        cadSupported={cadSupported}
        cadEnabled={cadEnabled}
        onToggleCad={onToggleCad}
        onDeleteChannel={onDeleteChannel}
        onDeleteContact={onDeleteContact}
        onOpenContactInfo={onOpenContactInfo}
        onOpenChannelInfo={onOpenChannelInfo}
        onInsertLocation={onInsertLocation}
        onEditInRegistry={openChannelInRegistry}
        cliConsoleAvailable={cliConsoleAvailable}
        cliConsoleOpen={cliConsoleOpen}
        onToggleCliConsole={() =>
          setCliConsoleOpenFor((current) =>
            current === activeConversation.id ? null : activeConversation.id
          )
        }
      />
      {activeConversation.type === 'contact' && isPrefixOnlyActiveContact && (
        <ContactResolutionBanner variant="prefix-only" />
      )}
      {activeConversation.type === 'contact' && isUnknownFullKeyActiveContact && (
        <ContactResolutionBanner variant="unknown-full-key" />
      )}
      {activeConversation.type === 'contact' && isMeshcomodChat && (
        <MeshcomodContactNotice
          onPick={(command) => {
            if (messageInputRef && typeof messageInputRef === 'object') {
              messageInputRef.current?.setText?.(command);
            }
          }}
        />
      )}
      {activeContactIsRoom && activeContact && (
        <RoomServerPanel
          // Must not collide with the MessageList sibling below, which is keyed
          // by activeConversation.id (== the room's public_key for a contact
          // conversation). Two siblings sharing a key breaks React reconciliation
          // and orphans a stale panel in the DOM on every re-render. Keep the
          // public_key so the panel still remounts per room (see 39c75a9).
          key={`room-server-panel-${activeContact.public_key}`}
          contact={activeContact}
          onAuthenticatedChange={setRoomAuthenticated}
          autoLogin
        />
      )}
      {activeContactIsSensor && activeContact && (
        <SensorDashboardPanel
          key={`sensor-panel-${activeContact.public_key}`}
          conversation={activeConversation}
          contacts={contacts}
        />
      )}
      {activeConversation.type === 'channel' && unreadSummaryAfter !== null && (
        <ChannelUnreadSummaryBanner
          // Must not collide with the MessageList sibling below, which is keyed by
          // activeConversation.id: a shared key remounts the banner on every
          // render (one summary request each time) and orphans a stale copy.
          key={`unread-summary-${activeConversation.id}`}
          channelKey={activeConversation.id}
          after={unreadSummaryAfter}
        />
      )}
      {cliConsoleOpen && activeContact && (
        <div className="flex-1 overflow-y-auto p-4">
          <CompanionCliConsole
            key={`cli-${activeContact.public_key}`}
            target={{ kind: 'contact', publicKey: activeContact.public_key }}
            cliSupported={!!health?.radio_device_info?.cli_supported}
          />
        </div>
      )}
      {showRoomChat && <div data-toast-anchor="conversation" aria-hidden="true" />}
      {showRoomChat && (
        <MessageList
          key={activeConversation.id}
          messages={messages}
          preSorted={preSorted}
          contacts={contacts}
          channels={channels}
          loading={messagesLoading}
          loadingOlder={loadingOlder}
          hasOlderMessages={hasOlderMessages}
          unreadMarkerMessageId={
            activeConversation.type === 'channel' ? unreadMarkerMessageId : undefined
          }
          onNavigateToUnread={
            activeConversation.type === 'channel' ? onNavigateToUnread : undefined
          }
          onJumpToMessage={onJumpToMessage}
          onReactToMessage={onReactToMessage}
          onReplyToMessage={onReplyToMessage}
          onDeleteMessage={onDeleteMessage}
          onRetryDirectMessage={
            activeConversation.type === 'contact' ? onRetryDirectMessage : undefined
          }
          onMarkUnreadFromMessage={onMarkUnreadFromMessage}
          onDismissUnreadMarker={
            activeConversation.type === 'channel' ? onDismissUnreadMarker : undefined
          }
          onSenderClick={activeConversation.type === 'channel' ? onSenderClick : undefined}
          onChannelReferenceClick={onChannelReferenceClick}
          registryNames={registryNames}
          autoAddMentionedChannels={autoAddMentionedChannels}
          parsePubkeys={parsePubkeys}
          parseCoordinates={parseCoordinates}
          linkifyUrls={linkifyUrls}
          showUrlPreviews={showUrlPreviews}
          hiddenHopWidths={hiddenHopWidths}
          onHiddenHopWidthsChange={onHiddenHopWidthsChange}
          hideMalformed={hideMalformed}
          onHideMalformedChange={onHideMalformedChange}
          spamGuardEnabled={spamGuardEnabled}
          hideSpam={hideSpam}
          onHideSpamChange={onHideSpamChange}
          hideBots={hideBots}
          onHideBotsChange={onHideBotsChange}
          onSpamFeedback={onSpamFeedback}
          analyzerSites={analyzerSites}
          onHashtagAdded={onHashtagAdded}
          onCoordinateClick={onCoordinateClick}
          onLoadOlder={onLoadOlder}
          onResendChannelMessage={
            activeConversation.type === 'channel' ? onResendChannelMessage : undefined
          }
          radioName={config?.name}
          config={config}
          onOpenContactInfo={onOpenContactInfo}
          onAddSharedContact={onAddSharedContact}
          targetMessageId={targetMessageId}
          onTargetReached={onTargetReached}
          hasNewerMessages={hasNewerMessages}
          loadingNewer={loadingNewer}
          onLoadNewer={onLoadNewer}
          onJumpToBottom={onJumpToBottom}
        />
      )}
      {showRoomChat && !(activeConversation.type === 'contact' && isPrefixOnlyActiveContact) ? (
        <MessageInput
          key={`${activeConversation.type}:${activeConversation.id}`}
          ref={messageInputRef}
          onSend={onSendMessage}
          confirmSend={isMeshcomodChat ? confirmMeshcomodCommand : undefined}
          disabled={!health?.radio_connected}
          conversationType={activeConversation.type}
          senderName={config?.name}
          placeholder={
            !health?.radio_connected
              ? t('chat_radio_not_connected_placeholder')
              : t('chat_message_placeholder', { name: activeConversation.name })
          }
        />
      ) : null}
    </>
  );
}
