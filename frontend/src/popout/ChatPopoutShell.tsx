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
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  MessageSquare,
  MessageSquareDot,
  Plus,
  Search,
  Star,
} from 'lucide-react';

import { BulkAddChannelResultModal } from '../components/BulkAddChannelResultModal';
import { ChannelInfoPane } from '../components/ChannelInfoPane';
import { ContactInfoPane } from '../components/ContactInfoPane';
import { ConversationPane } from '../components/ConversationPane';
import { NewMessageModal } from '../components/NewMessageModal';
import type { SearchViewProps } from '../components/SearchView';
import { Toaster, toast } from '../components/ui/sonner';
import { useDistanceUnit } from '../contexts/DistanceUnitContext';
import { MessageLayoutProvider, type MessageLayout } from '../contexts/MessageLayoutContext';
import { useT } from '../i18n';
import type { Contact, Conversation, HealthStatus, RadioConfig } from '../types';
import type { ConversationTimes } from '../utils/conversationState';
import { formatDistance, isValidLocation } from '../utils/pathUtils';
import { cn } from '@/lib/utils';
import {
  getSavedPopoutListPrefs,
  isDistanceSort,
  POPOUT_SECTION_SORTS,
  POPOUT_SENDER_SORTS,
  savePopoutListPrefs,
  watchPopoutListPrefs,
  type PopoutListPrefs,
  type PopoutSection,
  type PopoutSenderSort,
  type PopoutSortOrder,
} from './popoutListPrefs';
import {
  buildPopoutSections,
  recentSenders,
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
      className="popout-tool inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
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

const SECTION_LABEL_KEYS: Record<PopoutSection, string> = {
  channels: 'popout_section_channels',
  direct: 'popout_section_direct',
  rooms: 'popout_section_rooms',
};

const SORT_LABEL_KEYS: Record<PopoutSortOrder, string> = {
  recent: 'popout_sort_recent',
  oldest: 'popout_sort_oldest',
  alpha: 'popout_sort_alpha',
  'alpha-desc': 'popout_sort_alpha_desc',
  unread: 'popout_sort_unread',
  nearest: 'popout_sort_nearest',
  farthest: 'popout_sort_farthest',
};

const SENDER_SORT_LABEL_KEYS: Record<PopoutSenderSort, string> = {
  alpha: 'popout_sort_alpha',
  'alpha-desc': 'popout_sort_alpha_desc',
  recent: 'popout_sort_last_spoke',
  messages: 'popout_sort_messages',
  nearest: 'popout_sort_nearest',
  farthest: 'popout_sort_farthest',
};

const LIST_HEADING_CLASS = 'text-[0.6875rem] uppercase tracking-wide text-muted-foreground';
const LIST_ICON_BUTTON_CLASS =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring';

/** The order picker of a list. Distance orders are greyed out without a radio location. */
function SortSelect<T extends PopoutSortOrder | PopoutSenderSort>({
  label,
  value,
  options,
  labelKeys,
  hasOrigin,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labelKeys: Record<T, string>;
  hasOrigin: boolean;
  onChange: (order: T) => void;
  className?: string;
}) {
  const t = useT();
  const distanceOff = !hasOrigin && options.some(isDistanceSort);
  return (
    <select
      className={cn(
        'popout-tool h-5 min-w-0 border border-border bg-background px-0.5 text-[0.6875rem] text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      aria-label={label}
      title={distanceOff ? t('popout_sort_no_location') : label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option} value={option} disabled={!hasOrigin && isDistanceSort(option)}>
          {t(labelKeys[option])}
        </option>
      ))}
    </select>
  );
}

function ListToggle({
  icon,
  label,
  pressed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="popout-tool flex flex-1 items-center justify-center rounded py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-primary"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function ConversationList({
  sections,
  activeConversation,
  onSelect,
  query,
  onQueryChange,
  prefs,
  onPrefsChange,
  hasOrigin,
}: {
  sections: PopoutListSections;
  activeConversation: Conversation | null;
  onSelect: (conversation: Conversation) => void;
  query: string;
  onQueryChange: (query: string) => void;
  prefs: PopoutListPrefs;
  onPrefsChange: (patch: Partial<PopoutListPrefs>) => void;
  hasOrigin: boolean;
}) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const groups = (Object.keys(SECTION_LABEL_KEYS) as PopoutSection[]).filter(
    (section) => sections[section].length > 0
  );
  // A filter looks through folded sections too, like the main sidebar's search.
  const filtering = query.trim() !== '';

  return (
    <nav
      className="popout-tree popout-inset flex w-48 shrink-0 flex-col bg-background"
      aria-label={t('popout_conversations')}
    >
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('popout_filter_placeholder')}
        aria-label={t('popout_filter_placeholder')}
        className="popout-filter m-1 border border-border bg-background px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="mx-1 mb-1 flex gap-1" role="group" aria-label={t('popout_list_filters')}>
        <ListToggle
          icon={<Star className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('popout_favorites_only')}
          pressed={prefs.favoritesOnly}
          onClick={() => onPrefsChange({ favoritesOnly: !prefs.favoritesOnly })}
        />
        <ListToggle
          icon={<MessageSquareDot className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('popout_unread_only')}
          pressed={prefs.unreadOnly}
          onClick={() => onPrefsChange({ unreadOnly: !prefs.unreadOnly })}
        />
        <ListToggle
          icon={<BellOff className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('popout_hide_muted')}
          pressed={prefs.hideMuted}
          onClick={() => onPrefsChange({ hideMuted: !prefs.hideMuted })}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {groups.map((section) => {
          const entries = sections[section];
          const label = t(SECTION_LABEL_KEYS[section]);
          const open = filtering || !prefs.collapsed[section];
          const hiddenUnread = open ? 0 : entries.reduce((sum, entry) => sum + entry.unread, 0);
          const showDistance = isDistanceSort(prefs.sort[section]);
          return (
            <div key={section}>
              <div className="flex items-center gap-1 px-1 pt-1.5">
                <button
                  type="button"
                  aria-expanded={open}
                  disabled={filtering}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-0.5 text-left',
                    LIST_HEADING_CLASS,
                    LIST_ICON_BUTTON_CLASS
                  )}
                  onClick={() =>
                    onPrefsChange({
                      collapsed: { ...prefs.collapsed, [section]: !prefs.collapsed[section] },
                    })
                  }
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{label}</span>
                  {hiddenUnread > 0 && (
                    <span
                      className={cn(
                        'shrink-0 font-semibold',
                        entries.some((entry) => entry.mention && entry.unread > 0)
                          ? 'text-destructive'
                          : 'text-primary'
                      )}
                      aria-label={t('popout_unread_count', { count: hiddenUnread })}
                    >
                      {`(${hiddenUnread})`}
                    </span>
                  )}
                </button>
                <SortSelect
                  className="max-w-[4.5rem] shrink-0"
                  label={t('popout_sort_section', { section: label })}
                  value={prefs.sort[section]}
                  options={POPOUT_SECTION_SORTS[section]}
                  labelKeys={SORT_LABEL_KEYS}
                  hasOrigin={hasOrigin}
                  onChange={(order) => onPrefsChange({ sort: { ...prefs.sort, [section]: order } })}
                />
              </div>
              {open && (
                <div role="group" aria-label={label}>
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
                          'popout-tree-row flex w-full items-center gap-1 px-2 py-0.5 text-left text-[0.8125rem] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground hover:bg-accent',
                          entry.muted && !active && 'opacity-60'
                        )}
                        onClick={() => onSelect(entry.conversation)}
                      >
                        <span className="min-w-0 flex-1 truncate">{entry.conversation.name}</span>
                        {showDistance && entry.distanceKm !== null && (
                          <span className="shrink-0 text-[0.6875rem] opacity-70">
                            {formatDistance(entry.distanceKm, distanceUnit)}
                          </span>
                        )}
                        {entry.unread > 0 && (
                          <span
                            className={cn(
                              'shrink-0 font-semibold',
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
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t('popout_no_matches')}</div>
        )}
      </div>
    </nav>
  );
}

function SenderList({
  senders,
  sort,
  collapsed,
  hasOrigin,
  onSortChange,
  onCollapsedChange,
  onOpen,
}: {
  senders: RecentSender[];
  sort: PopoutSenderSort;
  collapsed: boolean;
  hasOrigin: boolean;
  onSortChange: (sort: PopoutSenderSort) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpen: (sender: RecentSender) => void;
}) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  return (
    <aside
      className={cn(
        'popout-inset hidden shrink-0 flex-col bg-background sm:flex',
        collapsed ? 'w-6' : 'w-32'
      )}
      aria-label={t('popout_senders')}
    >
      {collapsed ? (
        <button
          type="button"
          className={cn('flex flex-1 items-start justify-center pt-1.5', LIST_ICON_BUTTON_CLASS)}
          aria-label={t('popout_senders_show')}
          title={t('popout_senders_show')}
          onClick={() => onCollapsedChange(false)}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <>
          <div className="flex items-center gap-1 pl-2 pr-1 pt-1.5">
            <span className={cn('min-w-0 flex-1 truncate', LIST_HEADING_CLASS)}>
              {t('popout_senders_heading')}
            </span>
            <button
              type="button"
              className={cn('shrink-0', LIST_ICON_BUTTON_CLASS)}
              aria-label={t('popout_senders_hide')}
              title={t('popout_senders_hide')}
              onClick={() => onCollapsedChange(true)}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <SortSelect
            className="m-1"
            label={t('popout_senders_sort')}
            value={sort}
            options={POPOUT_SENDER_SORTS}
            labelKeys={SENDER_SORT_LABEL_KEYS}
            hasOrigin={hasOrigin}
            onChange={onSortChange}
          />
          <div className="min-h-0 flex-1 overflow-y-auto pb-1">
            {senders.map((sender) => (
              <button
                key={sender.name}
                type="button"
                className="popout-tree-row flex w-full items-center gap-1 px-2 py-0.5 text-left text-[0.8125rem] text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                title={t('a11y_view_info_for', { name: sender.name })}
                onClick={() => onOpen(sender)}
              >
                <span className="min-w-0 flex-1 truncate">{sender.name}</span>
                {sender.distanceKm !== undefined && (
                  <span className="shrink-0 text-[0.6875rem] opacity-70">
                    {formatDistance(sender.distanceKm, distanceUnit)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
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
  const [listPrefs, setListPrefs] = useState(getSavedPopoutListPrefs);
  const updateListPrefs = (patch: Partial<PopoutListPrefs>) => {
    const next = { ...listPrefs, ...patch };
    savePopoutListPrefs(next);
    setListPrefs(next);
  };
  useEffect(() => watchPopoutListPrefs(setListPrefs), []);
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

  // Where distance orders measure from: the radio's own position, when it has one.
  const originLat = statusProps.config?.lat ?? null;
  const originLon = statusProps.config?.lon ?? null;
  const origin = useMemo(
    () =>
      originLat !== null && originLon !== null && isValidLocation(originLat, originLon)
        ? { lat: originLat, lon: originLon }
        : null,
    [originLat, originLon]
  );

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
        sort: listPrefs.sort,
        favoritesOnly: listPrefs.favoritesOnly,
        unreadOnly: listPrefs.unreadOnly,
        hideMuted: listPrefs.hideMuted,
        origin,
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
      listPrefs.sort,
      listPrefs.favoritesOnly,
      listPrefs.unreadOnly,
      listPrefs.hideMuted,
      origin,
    ]
  );

  const { messages } = conversationPaneProps;
  const senders = useMemo(
    () =>
      mode === 'chat' && chatConversation
        ? recentSenders(messages, contacts, { sort: listPrefs.senderSort, origin })
        : [],
    [mode, chatConversation, messages, contacts, listPrefs.senderSort, origin]
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
            className="popout-tool rounded border border-border bg-background px-1 py-1 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
              prefs={listPrefs}
              onPrefsChange={updateListPrefs}
              hasOrigin={origin !== null}
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
              sort={listPrefs.senderSort}
              collapsed={listPrefs.sendersCollapsed}
              hasOrigin={origin !== null}
              onSortChange={(senderSort) => updateListPrefs({ senderSort })}
              onCollapsedChange={(sendersCollapsed) => updateListPrefs({ sendersCollapsed })}
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
          <span className="shrink-0">{t('popout_status_stream')}</span>
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
