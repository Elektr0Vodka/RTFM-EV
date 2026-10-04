import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  AlignLeft,
  CheckCheck,
  ExternalLink,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
} from 'lucide-react';

import { BulkAddChannelResultModal } from '../components/BulkAddChannelResultModal';
import { ChannelInfoPane } from '../components/ChannelInfoPane';
import { ContactInfoPane } from '../components/ContactInfoPane';
import { ConversationPane } from '../components/ConversationPane';
import { NewMessageModal } from '../components/NewMessageModal';
import type { SearchViewProps } from '../components/SearchView';
import { Toaster, toast } from '../components/ui/sonner';
import { MessageLayoutProvider, type MessageLayout } from '../contexts/MessageLayoutContext';
import { useT } from '../i18n';
import type { Contact, Conversation, HealthStatus, RadioConfig } from '../types';
import type { ConversationTimes } from '../utils/conversationState';
import { cn } from '@/lib/utils';
import {
  buildPopoutSections,
  recentSenders,
  type PopoutListEntry,
  type PopoutListSections,
  type RecentSender,
} from './popoutLists';
import {
  isChatConversation,
  isPopoutView,
  openChatPopout,
  openInMainApp,
  type PopoutMode,
} from './popoutMode';
import {
  applyPopoutSkin,
  getSavedPopoutLayout,
  getSavedPopoutSkin,
  POPOUT_SKINS,
  savePopoutLayout,
  savePopoutSkin,
  watchPopoutAppearance,
  type PopoutSkin,
} from './popoutSkin';

const SearchView = lazy(() =>
  import('../components/SearchView').then((m) => ({ default: m.SearchView }))
);

type ConversationPaneProps = ComponentProps<typeof ConversationPane>;

interface ChatPopoutShellProps {
  mode: PopoutMode;
  showNewMessage: boolean;
  showBulkAddResults: boolean;
  onCloseNewMessage: () => void;
  onCloseBulkAddResults: () => void;
  statusProps: { health: HealthStatus | null; config: RadioConfig | null };
  // The same bundles App assembles for AppShell; the popup uses a subset.
  sidebarProps: {
    contacts: Contact[];
    channels: ConversationPaneProps['channels'];
    activeConversation: Conversation | null;
    onSelectConversation: (conversation: Conversation) => void;
    onNewMessage: (event?: MouseEvent<HTMLButtonElement>) => void;
    lastMessageTimes: ConversationTimes;
    unreadCounts: Record<string, number>;
    mentions: Record<string, boolean>;
    onMarkAllRead: () => void;
    blockedKeys?: string[];
    blockedNames?: string[];
  };
  conversationPaneProps: ConversationPaneProps;
  searchProps: SearchViewProps;
  newMessageModalProps: Omit<ComponentProps<typeof NewMessageModal>, 'open' | 'onClose'>;
  bulkAddChannelResultModalProps: Omit<
    ComponentProps<typeof BulkAddChannelResultModal>,
    'open' | 'onClose'
  >;
  contactInfoPaneProps: ComponentProps<typeof ContactInfoPane>;
  channelInfoPaneProps: ComponentProps<typeof ChannelInfoPane>;
}

const SKIN_LABEL_KEYS: Record<PopoutSkin, string> = {
  mirc: 'popout_skin_mirc',
  'mirc-dark': 'popout_skin_mirc_dark',
  theme: 'popout_skin_theme',
};

function ToolButton({
  icon,
  label,
  title,
  onClick,
  pressed,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="popout-tool inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ConversationList({
  sections,
  activeConversation,
  onSelect,
  query,
  onQueryChange,
}: {
  sections: PopoutListSections;
  activeConversation: Conversation | null;
  onSelect: (conversation: Conversation) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const t = useT();
  const groups: Array<[string, PopoutListEntry[]]> = [
    [t('popout_section_channels'), sections.channels],
    [t('popout_section_direct'), sections.direct],
    [t('popout_section_rooms'), sections.rooms],
  ];
  const empty = groups.every(([, entries]) => entries.length === 0);

  return (
    <nav
      className="popout-tree popout-inset flex w-44 flex-shrink-0 flex-col bg-background"
      aria-label={t('popout_conversations')}
    >
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('popout_filter_placeholder')}
        aria-label={t('popout_filter_placeholder')}
        className="popout-filter m-1 border border-border bg-background px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {groups.map(
          ([label, entries]) =>
            entries.length > 0 && (
              <div key={label}>
                <div className="px-2 pt-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                {entries.map((entry) => {
                  const active =
                    activeConversation?.type === entry.conversation.type &&
                    activeConversation.id === entry.conversation.id;
                  return (
                    <button
                      key={`${entry.conversation.type}-${entry.conversation.id}`}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'popout-tree-row flex w-full items-center gap-1 px-2 py-0.5 text-left text-[0.8125rem] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent',
                        entry.muted && !active && 'opacity-60'
                      )}
                      onClick={() => onSelect(entry.conversation)}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.conversation.name}</span>
                      {entry.unread > 0 && (
                        <span
                          className={cn(
                            'flex-shrink-0 font-semibold',
                            !active && (entry.mention ? 'text-destructive' : 'text-primary')
                          )}
                          aria-label={t('popout_unread_count', { count: entry.unread })}
                        >
                          {`(${entry.unread})`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )
        )}
        {empty && (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t('popout_no_matches')}</div>
        )}
      </div>
    </nav>
  );
}

function SenderList({
  senders,
  onOpen,
}: {
  senders: RecentSender[];
  onOpen: (sender: RecentSender) => void;
}) {
  const t = useT();
  return (
    <aside
      className="popout-inset hidden w-32 flex-shrink-0 flex-col bg-background sm:flex"
      aria-label={t('popout_senders')}
    >
      <div className="px-2 pt-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
        {t('popout_senders_heading')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {senders.map((sender) => (
          <button
            key={sender.name}
            type="button"
            className="popout-tree-row block w-full truncate px-2 py-0.5 text-left text-[0.8125rem] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            title={t('a11y_view_info_for', { name: sender.name })}
            onClick={() => onOpen(sender)}
          >
            {sender.name}
          </button>
        ))}
      </div>
    </aside>
  );
}

/**
 * The chat-only window: a conversation list, the regular ConversationPane and
 * the recent senders, with none of the main app's sidebar, status bar, map or
 * packet views mounted. `single` mode is one detached conversation.
 */
export function ChatPopoutShell({
  mode,
  showNewMessage,
  showBulkAddResults,
  onCloseNewMessage,
  onCloseBulkAddResults,
  statusProps,
  sidebarProps,
  conversationPaneProps,
  searchProps,
  newMessageModalProps,
  bulkAddChannelResultModalProps,
  contactInfoPaneProps,
  channelInfoPaneProps,
}: ChatPopoutShellProps) {
  const t = useT();
  const [skin, setSkin] = useState<PopoutSkin>(getSavedPopoutSkin);
  const [layout, setLayout] = useState<MessageLayout>(getSavedPopoutLayout);
  const [query, setQuery] = useState('');
  const skinRef = useRef(skin);
  skinRef.current = skin;

  useEffect(() => {
    applyPopoutSkin(skin);
  }, [skin]);
  useEffect(
    () =>
      watchPopoutAppearance({
        getSkin: () => skinRef.current,
        onSkin: setSkin,
        onLayout: setLayout,
      }),
    []
  );

  const { contacts, channels, activeConversation, onSelectConversation } = sidebarProps;
  const isSearch = activeConversation?.type === 'search';
  const chatConversation = isChatConversation(activeConversation, contacts)
    ? activeConversation
    : null;
  const unsupportedView =
    activeConversation !== null && !isPopoutView(activeConversation, contacts);

  const searchMounted = useRef(false);
  if (isSearch) searchMounted.current = true;
  // Where the Search button returns to when it is clicked a second time.
  const lastChatRef = useRef<Conversation | null>(null);
  if (chatConversation) lastChatRef.current = chatConversation;

  const sections = useMemo(
    () =>
      buildPopoutSections({
        channels,
        contacts,
        lastMessageTimes: sidebarProps.lastMessageTimes,
        unreadCounts: sidebarProps.unreadCounts,
        mentions: sidebarProps.mentions,
        blockedKeys: sidebarProps.blockedKeys,
        blockedNames: sidebarProps.blockedNames,
        activeConversation,
        query,
      }),
    [
      channels,
      contacts,
      sidebarProps.lastMessageTimes,
      sidebarProps.unreadCounts,
      sidebarProps.mentions,
      sidebarProps.blockedKeys,
      sidebarProps.blockedNames,
      activeConversation,
      query,
    ]
  );

  const { messages } = conversationPaneProps;
  const senders = useMemo(
    () => (mode === 'chat' && chatConversation ? recentSenders(messages, contacts) : []),
    [mode, chatConversation, messages, contacts]
  );

  const handleDetach = () => {
    if (chatConversation && !openChatPopout('single', chatConversation)) {
      toast.error(t('popout_blocked'));
    }
  };

  return (
    <MessageLayoutProvider value={layout}>
      <div
        className="popout-shell flex h-full flex-col bg-card text-foreground"
        data-popout-mode={mode}
      >
        <div
          className="popout-toolbar flex flex-wrap items-center gap-1 border-b border-border px-1 py-1"
          role="toolbar"
          aria-label={t('popout_toolbar')}
        >
          <ToolButton
            icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('popout_new')}
            title={t('popout_new_title')}
            onClick={sidebarProps.onNewMessage}
          />
          <ToolButton
            icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('popout_search')}
            pressed={isSearch}
            onClick={() =>
              onSelectConversation(
                isSearch && lastChatRef.current
                  ? lastChatRef.current
                  : { type: 'search', id: 'search', name: 'Message Search' }
              )
            }
          />
          {mode === 'chat' && (
            <ToolButton
              icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('popout_mark_all_read')}
              onClick={sidebarProps.onMarkAllRead}
            />
          )}
          <span className="flex-1" />
          <div className="flex items-center" role="group" aria-label={t('popout_layout_label')}>
            <ToolButton
              icon={<AlignLeft className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('popout_layout_lines')}
              pressed={layout === 'lines'}
              onClick={() => {
                savePopoutLayout('lines');
                setLayout('lines');
              }}
            />
            <ToolButton
              icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('popout_layout_bubbles')}
              pressed={layout === 'bubbles'}
              onClick={() => {
                savePopoutLayout('bubbles');
                setLayout('bubbles');
              }}
            />
          </div>
          <select
            className="popout-tool rounded border border-border bg-background px-1 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('popout_skin_label')}
            title={t('popout_skin_label')}
            value={skin}
            onChange={(event) => {
              const next = event.target.value as PopoutSkin;
              savePopoutSkin(next);
              setSkin(next);
            }}
          >
            {POPOUT_SKINS.map((option) => (
              <option key={option} value={option}>
                {t(SKIN_LABEL_KEYS[option])}
              </option>
            ))}
          </select>
          {mode === 'chat' && (
            <ToolButton
              icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('popout_detach')}
              title={t('popout_detach_title')}
              disabled={!chatConversation}
              onClick={handleDetach}
            />
          )}
          <ToolButton
            icon={<LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('popout_main_app')}
            title={t('popout_main_app_title')}
            onClick={() => openInMainApp(chatConversation)}
          />
        </div>

        <div className="flex min-h-0 flex-1 gap-1 p-1">
          {mode === 'chat' && (
            <ConversationList
              sections={sections}
              activeConversation={activeConversation}
              onSelect={onSelectConversation}
              query={query}
              onQueryChange={setQuery}
            />
          )}
          <main
            id="main-content"
            className="popout-pane popout-inset flex min-w-0 flex-1 flex-col bg-background"
          >
            {unsupportedView ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
                <span>{t('popout_not_chat_view')}</span>
                <ToolButton
                  icon={<LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />}
                  label={t('popout_open_in_main')}
                  onClick={() => openInMainApp(activeConversation)}
                />
              </div>
            ) : (
              <div className={cn('flex min-h-0 flex-1 flex-col', isSearch && 'hidden')}>
                <ConversationPane {...conversationPaneProps} />
              </div>
            )}
            {searchMounted.current && (
              <div className={cn('flex min-h-0 flex-1 flex-col', !isSearch && 'hidden')}>
                <Suspense
                  fallback={
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                      {t('common_loading_search')}
                    </div>
                  }
                >
                  <SearchView {...searchProps} />
                </Suspense>
              </div>
            )}
          </main>
          {senders.length > 0 && (
            <SenderList
              senders={senders}
              onOpen={(sender) => conversationPaneProps.onOpenContactInfo(sender.key, true)}
            />
          )}
        </div>

        <div
          className="popout-status flex items-center justify-between gap-3 border-t border-border px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
          role="status"
        >
          <span className="truncate">
            {statusProps.health?.radio_connected
              ? t('popout_status_connected')
              : t('popout_status_disconnected')}
            {statusProps.config?.name ? ` · ${statusProps.config.name}` : ''}
          </span>
          <span className="flex-shrink-0">{t('popout_status_stream')}</span>
        </div>

        <NewMessageModal
          {...newMessageModalProps}
          open={showNewMessage}
          onClose={onCloseNewMessage}
        />
        <BulkAddChannelResultModal
          {...bulkAddChannelResultModalProps}
          open={showBulkAddResults}
          onClose={onCloseBulkAddResults}
        />
        <ContactInfoPane {...contactInfoPaneProps} />
        <ChannelInfoPane {...channelInfoPaneProps} />
        <Toaster position="top-right" />
      </div>
    </MessageLayoutProvider>
  );
}
