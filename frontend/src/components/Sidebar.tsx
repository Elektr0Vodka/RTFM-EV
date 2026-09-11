import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  ArrowDownUp,
  Cable,
  ChartNetwork,
  Activity,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Gauge,
  Library,
  LockOpen,
  Logs,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Search as SearchIcon,
  Settings2,
  SquarePen,
  X,
} from 'lucide-react';
import {
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_REPEATER,
  type Contact,
  type Channel,
  type Conversation,
} from '../types';
import {
  buildSidebarSectionSortOrders,
  FAVORITES_SORT_CYCLE,
  getStateKey,
  loadLegacyLocalStorageSortOrder,
  loadLocalStorageSidebarSectionSortOrders,
  saveLocalStorageSidebarSectionSortOrders,
  type ConversationTimes,
  type SidebarSectionSortOrders,
  type SidebarSortableSection,
  type SortOrder,
} from '../utils/conversationState';
import { isPublicChannelKey } from '../utils/publicChannel';
import { getContactDisplayName } from '../utils/pubkey';
import { handleKeyboardActivate } from '../utils/a11y';
import {
  loadSectionOrder,
  saveSectionOrder,
  loadToolOrder,
  saveToolOrder,
  loadRailCollapsed,
  saveRailCollapsed,
  resetSidebarLayout,
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  type SidebarSectionKey,
  type SidebarToolKey,
} from '../utils/sidebarLayout';
import { DragList } from './sidebar/DragList';
import { useT, type TFn } from '../i18n';
import { useSeenItems } from '../hooks/useSeenItems';
import { ContactAvatar } from './ContactAvatar';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

type FavoriteItem = { type: 'channel'; channel: Channel } | { type: 'contact'; contact: Contact };

// Grouping order for the Favorites "by type" sorts. Mirrors the standalone sidebar
// section order: Channels, Contacts (clients/sensors/unknown), Rooms, Repeaters.
function favoriteTypeRank(item: FavoriteItem): number {
  if (item.type === 'channel') return 0;
  switch (item.contact.type) {
    case CONTACT_TYPE_ROOM:
      return 2;
    case CONTACT_TYPE_REPEATER:
      return 3;
    default:
      return 1;
  }
}

// The next order when the section's sort toggle is clicked. Favorites cycles
// through all four orders; every other (single-type) section flips recent<->alpha.
function nextSortOrder(section: SidebarSortableSection, current: SortOrder): SortOrder {
  if (section === 'favorites') {
    const idx = FAVORITES_SORT_CYCLE.indexOf(current);
    return FAVORITES_SORT_CYCLE[(idx + 1) % FAVORITES_SORT_CYCLE.length];
  }
  return current === 'alpha' ? 'recent' : 'alpha';
}

// Compact glyph/text shown on the toggle for the current order.
function sortOrderLabel(order: SortOrder, t: TFn): string {
  switch (order) {
    case 'alpha':
      return 'A-Z';
    case 'type-recent':
      return `${t('chat_sort_type_label')} ⏱`;
    case 'type-alpha':
      return `${t('chat_sort_type_label')} A-Z`;
    case 'recent':
    default:
      return '⏱';
  }
}

// Human phrase for aria/title, describing what the order sorts by.
function sortOrderDescription(order: SortOrder, t: TFn): string {
  switch (order) {
    case 'alpha':
      return t('chat_sort_alphabetically');
    case 'type-recent':
      return t('chat_sort_by_type_then_recent');
    case 'type-alpha':
      return t('chat_sort_by_type_then_alphabetically');
    case 'recent':
    default:
      return t('chat_sort_by_recent');
  }
}

type ConversationRow = {
  key: string;
  type: 'channel' | 'contact';
  id: string;
  name: string;
  unreadCount: number;
  isMention: boolean;
  notificationsEnabled: boolean;
  muted?: boolean;
  contact?: Contact;
};

type CollapseState = {
  tools: boolean;
  favorites: boolean;
  channels: boolean;
  contacts: boolean;
  rooms: boolean;
  repeaters: boolean;
  favChannels: boolean;
  favContacts: boolean;
  favRooms: boolean;
  favRepeaters: boolean;
};

const SIDEBAR_COLLAPSE_STATE_KEY = 'remoteterm-sidebar-collapse-state';

const DEFAULT_COLLAPSE_STATE: CollapseState = {
  tools: false,
  favorites: false,
  channels: false,
  contacts: false,
  rooms: false,
  repeaters: false,
  favChannels: false,
  favContacts: false,
  favRooms: false,
  favRepeaters: false,
};

function loadCollapsedState(): CollapseState {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSE_STATE_KEY);
    if (!raw) return DEFAULT_COLLAPSE_STATE;
    const parsed = JSON.parse(raw) as Partial<CollapseState>;
    return {
      tools: parsed.tools ?? DEFAULT_COLLAPSE_STATE.tools,
      favorites: parsed.favorites ?? DEFAULT_COLLAPSE_STATE.favorites,
      channels: parsed.channels ?? DEFAULT_COLLAPSE_STATE.channels,
      contacts: parsed.contacts ?? DEFAULT_COLLAPSE_STATE.contacts,
      rooms: parsed.rooms ?? DEFAULT_COLLAPSE_STATE.rooms,
      repeaters: parsed.repeaters ?? DEFAULT_COLLAPSE_STATE.repeaters,
      favChannels: parsed.favChannels ?? DEFAULT_COLLAPSE_STATE.favChannels,
      favContacts: parsed.favContacts ?? DEFAULT_COLLAPSE_STATE.favContacts,
      favRooms: parsed.favRooms ?? DEFAULT_COLLAPSE_STATE.favRooms,
      favRepeaters: parsed.favRepeaters ?? DEFAULT_COLLAPSE_STATE.favRepeaters,
    };
  } catch {
    return DEFAULT_COLLAPSE_STATE;
  }
}

interface SidebarProps {
  contacts: Contact[];
  channels: Channel[];
  activeConversation: Conversation | null;
  onSelectConversation: (conversation: Conversation) => void;
  onNewMessage: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  lastMessageTimes: ConversationTimes;
  unreadCounts: Record<string, number>;
  /** Tracks which conversations have unread messages that mention the user */
  mentions: Record<string, boolean>;
  showCracker: boolean;
  crackerRunning: boolean;
  onToggleCracker: () => void;
  onMarkAllRead: () => void;
  onMarkSectionRead?: (items: { type: 'channel' | 'contact'; id: string }[]) => void;
  onOpenChannelImportExport?: () => void;
  isConversationNotificationsEnabled?: (type: 'channel' | 'contact', id: string) => boolean;
  blockedKeys?: string[];
  blockedNames?: string[];
  /** When true (mobile drawer mount), pin the rail open and hide the rail toggle. */
  forceExpanded?: boolean;
}

function loadInitialSectionSortOrders(): SidebarSectionSortOrders {
  const storedOrders = loadLocalStorageSidebarSectionSortOrders();
  if (storedOrders) return storedOrders;

  const legacyOrder = loadLegacyLocalStorageSortOrder();
  const orders = buildSidebarSectionSortOrders(legacyOrder ?? undefined);
  saveLocalStorageSidebarSectionSortOrders(orders);
  return orders;
}

export function Sidebar({
  contacts,
  channels,
  activeConversation,
  onSelectConversation,
  onNewMessage,
  lastMessageTimes,
  unreadCounts,
  mentions,
  showCracker,
  crackerRunning,
  onToggleCracker,
  onMarkAllRead,
  onMarkSectionRead,
  onOpenChannelImportExport,
  isConversationNotificationsEnabled,
  blockedKeys = [],
  blockedNames = [],
  forceExpanded = false,
}: SidebarProps) {
  const t = useT();
  const isContactBlocked = useCallback(
    (c: Contact) =>
      blockedKeys.includes(c.public_key.toLowerCase()) ||
      (c.name != null && blockedNames.includes(c.name)),
    [blockedKeys, blockedNames]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const initialSectionSortOrders = useMemo(loadInitialSectionSortOrders, []);
  const [sectionSortOrders, setSectionSortOrders] = useState(initialSectionSortOrders);
  const initialCollapsedState = useMemo(loadCollapsedState, []);
  const [toolsCollapsed, setToolsCollapsed] = useState(initialCollapsedState.tools);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(initialCollapsedState.favorites);
  const [channelsCollapsed, setChannelsCollapsed] = useState(initialCollapsedState.channels);
  const [contactsCollapsed, setContactsCollapsed] = useState(initialCollapsedState.contacts);
  const [roomsCollapsed, setRoomsCollapsed] = useState(initialCollapsedState.rooms);
  const [repeatersCollapsed, setRepeatersCollapsed] = useState(initialCollapsedState.repeaters);
  const [favChannelsCollapsed, setFavChannelsCollapsed] = useState(
    initialCollapsedState.favChannels
  );
  const [favContactsCollapsed, setFavContactsCollapsed] = useState(
    initialCollapsedState.favContacts
  );
  const [favRoomsCollapsed, setFavRoomsCollapsed] = useState(initialCollapsedState.favRooms);
  const [favRepeatersCollapsed, setFavRepeatersCollapsed] = useState(
    initialCollapsedState.favRepeaters
  );
  const collapseSnapshotRef = useRef<CollapseState | null>(null);

  // Layout customisation preferences (client-local, see utils/sidebarLayout).
  const [toolOrder, setToolOrder] = useState<SidebarToolKey[]>(loadToolOrder);
  const [sectionOrder, setSectionOrder] = useState<SidebarSectionKey[]>(loadSectionOrder);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(loadRailCollapsed);
  const [showSettings, setShowSettings] = useState(false);
  const isRail = railCollapsed && !forceExpanded;

  const toggleRail = () => {
    setRailCollapsed((prev) => {
      const next = !prev;
      saveRailCollapsed(next);
      return next;
    });
  };

  const handleReorderSections = (next: SidebarSectionKey[]) => {
    setSectionOrder(next);
    saveSectionOrder(next);
  };
  const handleReorderTools = (next: SidebarToolKey[]) => {
    setToolOrder(next);
    saveToolOrder(next);
  };
  const handleResetLayout = () => {
    resetSidebarLayout();
    setSectionOrder([...ALL_SECTION_KEYS]);
    setToolOrder([...ALL_TOOL_KEYS]);
    setRailCollapsed(false);
  };

  // Track which sidebar items have been seen so newly discovered ones can be
  // surfaced. Identity is the canonical conversation key. Uses the full prop
  // arrays so the baseline covers every item regardless of section.
  const allIdentities = useMemo(
    () => [
      ...channels.map((channel) => getStateKey('channel', channel.key)),
      ...contacts.map((contact) => getStateKey('contact', contact.public_key)),
    ],
    [channels, contacts]
  );
  const { isNew, countNew, markSeen } = useSeenItems(allIdentities, activeConversation);

  const handleSortToggle = (section: SidebarSortableSection) => {
    setSectionSortOrders((prev) => {
      const nextOrder = nextSortOrder(section, prev[section]);
      const updated = { ...prev, [section]: nextOrder };
      saveLocalStorageSidebarSectionSortOrders(updated);
      return updated;
    });
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSearchQuery('');
    onSelectConversation(conversation);
  };

  const isActive = (
    type:
      | 'contact'
      | 'channel'
      | 'raw'
      | 'map'
      | 'visualizer'
      | 'search'
      | 'trace'
      | 'channel-registry'
      | 'node'
      | 'mesh-health',
    id: string
  ) => activeConversation?.type === type && activeConversation?.id === id;

  // Get unread count for a conversation
  const getUnreadCount = (type: 'channel' | 'contact', id: string): number => {
    const key = getStateKey(type, id);
    return unreadCounts[key] || 0;
  };

  // Check if a conversation has a mention
  const hasMention = (type: 'channel' | 'contact', id: string): boolean => {
    const key = getStateKey(type, id);
    return mentions[key] || false;
  };

  const getLastMessageTime = useCallback(
    (type: 'channel' | 'contact', id: string) => {
      const key = getStateKey(type, id);
      return lastMessageTimes[key] || 0;
    },
    [lastMessageTimes]
  );

  const getContactHeardTime = useCallback((contact: Contact): number => {
    // Prefer last_seen (server receive wall clock — the value the UI shows as
    // "Last heard") so the recency sort matches the displayed date. Fall back to
    // last_advert only for repeaters known purely from radio sync, which have no
    // independent last_seen. Using Math.max here let a radio-reported (sender
    // clock, skew-prone) last_advert pin a repeater to the top even when its
    // displayed last_seen was older. See ContactStatusInfo "Last heard".
    return contact.last_seen || contact.last_advert || 0;
  }, []);

  const getContactRecentTime = useCallback(
    (contact: Contact): number => {
      if (contact.type === CONTACT_TYPE_REPEATER) {
        return getContactHeardTime(contact);
      }
      return getLastMessageTime('contact', contact.public_key) || getContactHeardTime(contact);
    },
    [getContactHeardTime, getLastMessageTime]
  );

  // Deduplicate channels by key only.
  // Channel names are not unique; distinct keys must remain visible.
  const uniqueChannels = useMemo(
    () =>
      channels.reduce<Channel[]>((acc, channel) => {
        if (!acc.some((c) => c.key === channel.key)) {
          acc.push(channel);
        }
        return acc;
      }, []),
    [channels]
  );

  // Deduplicate contacts by public key, preferring ones with names
  // Also filter out any contacts with empty public keys
  const uniqueContacts = useMemo(
    () =>
      contacts
        .filter((c) => c.public_key && c.public_key.length > 0)
        .sort((a, b) => {
          // Sort contacts with names first
          if (a.name && !b.name) return -1;
          if (!a.name && b.name) return 1;
          return (a.name || '').localeCompare(b.name || '');
        })
        .reduce<Contact[]>((acc, contact) => {
          if (!acc.some((c) => c.public_key === contact.public_key)) {
            acc.push(contact);
          }
          return acc;
        }, []),
    [contacts]
  );

  // Sort channels based on sort order, with Public always first
  const sortedChannels = useMemo(
    () =>
      [...uniqueChannels].sort((a, b) => {
        // Public channel always sorts to the top
        if (isPublicChannelKey(a.key)) return -1;
        if (isPublicChannelKey(b.key)) return 1;

        // Muted channels always sort to the bottom
        if (a.muted && !b.muted) return 1;
        if (!a.muted && b.muted) return -1;

        if (sectionSortOrders.channels === 'recent') {
          const timeA = getLastMessageTime('channel', a.key);
          const timeB = getLastMessageTime('channel', b.key);
          if (timeA && timeB) return timeB - timeA;
          if (timeA && !timeB) return -1;
          if (!timeA && timeB) return 1;
        }
        return a.name.localeCompare(b.name);
      }),
    [uniqueChannels, sectionSortOrders.channels, getLastMessageTime]
  );

  const sortContactsByOrder = useCallback(
    (items: Contact[], order: SortOrder) =>
      [...items].sort((a, b) => {
        // Unread DM contacts always float to the top
        const unreadA = unreadCounts[getStateKey('contact', a.public_key)] || 0;
        const unreadB = unreadCounts[getStateKey('contact', b.public_key)] || 0;
        if (unreadA > 0 && unreadB === 0) return -1;
        if (unreadA === 0 && unreadB > 0) return 1;

        if (order === 'recent') {
          const timeA = getContactRecentTime(a);
          const timeB = getContactRecentTime(b);
          if (timeA && timeB) return timeB - timeA;
          if (timeA && !timeB) return -1;
          if (!timeA && timeB) return 1;
        }
        return (a.name || a.public_key).localeCompare(b.name || b.public_key);
      }),
    [getContactRecentTime, unreadCounts]
  );

  const sortRepeatersByOrder = useCallback(
    (items: Contact[], order: SortOrder) =>
      [...items].sort((a, b) => {
        if (order === 'recent') {
          const timeA = getContactHeardTime(a);
          const timeB = getContactHeardTime(b);
          if (timeA && timeB) return timeB - timeA;
          if (timeA && !timeB) return -1;
          if (!timeA && timeB) return 1;
        }
        return (a.name || a.public_key).localeCompare(b.name || b.public_key);
      }),
    [getContactHeardTime]
  );

  const getFavoriteItemName = useCallback(
    (item: FavoriteItem) =>
      item.type === 'channel'
        ? item.channel.name
        : getContactDisplayName(
            item.contact.name,
            item.contact.public_key,
            item.contact.last_advert
          ),
    []
  );

  const sortFavoriteItemsByOrder = useCallback(
    (items: FavoriteItem[], order: SortOrder) => {
      const typeGrouped = order === 'type-recent' || order === 'type-alpha';
      const byRecent = order === 'recent' || order === 'type-recent';
      return [...items].sort((a, b) => {
        if (typeGrouped) {
          const rankDiff = favoriteTypeRank(a) - favoriteTypeRank(b);
          if (rankDiff !== 0) return rankDiff;
        }

        if (byRecent) {
          const timeA =
            a.type === 'channel'
              ? getLastMessageTime('channel', a.channel.key)
              : getContactRecentTime(a.contact);
          const timeB =
            b.type === 'channel'
              ? getLastMessageTime('channel', b.channel.key)
              : getContactRecentTime(b.contact);
          if (timeA && timeB) return timeB - timeA;
          if (timeA && !timeB) return -1;
          if (!timeA && timeB) return 1;
        }

        return getFavoriteItemName(a).localeCompare(getFavoriteItemName(b));
      });
    },
    [getContactRecentTime, getFavoriteItemName, getLastMessageTime]
  );

  // Split non-repeater contacts and repeater contacts into separate sorted lists
  const sortedNonRepeaterContacts = useMemo(
    () =>
      sortContactsByOrder(
        uniqueContacts.filter(
          (c) => c.type !== CONTACT_TYPE_REPEATER && c.type !== CONTACT_TYPE_ROOM
        ),
        sectionSortOrders.contacts
      ),
    [uniqueContacts, sectionSortOrders.contacts, sortContactsByOrder]
  );

  const sortedRooms = useMemo(
    () =>
      sortContactsByOrder(
        uniqueContacts.filter((c) => c.type === CONTACT_TYPE_ROOM),
        sectionSortOrders.rooms
      ),
    [uniqueContacts, sectionSortOrders.rooms, sortContactsByOrder]
  );

  const sortedRepeaters = useMemo(
    () =>
      sortRepeatersByOrder(
        uniqueContacts.filter((c) => c.type === CONTACT_TYPE_REPEATER),
        sectionSortOrders.repeaters
      ),
    [uniqueContacts, sectionSortOrders.repeaters, sortRepeatersByOrder]
  );

  // Filter by search query
  const query = searchQuery.toLowerCase().trim();
  const isSearching = query.length > 0;

  const filteredChannels = useMemo(
    () =>
      query
        ? sortedChannels.filter(
            (c) => c.name.toLowerCase().includes(query) || c.key.toLowerCase().startsWith(query)
          )
        : sortedChannels,
    [sortedChannels, query]
  );

  const filteredNonRepeaterContacts = useMemo(() => {
    const visible = sortedNonRepeaterContacts.filter((c) => !isContactBlocked(c));
    return query
      ? visible.filter(
          (c) =>
            c.name?.toLowerCase().includes(query) || c.public_key.toLowerCase().startsWith(query)
        )
      : visible;
  }, [sortedNonRepeaterContacts, query, isContactBlocked]);

  const filteredRooms = useMemo(() => {
    const visible = sortedRooms.filter((c) => !isContactBlocked(c));
    return query
      ? visible.filter(
          (c) =>
            c.name?.toLowerCase().includes(query) || c.public_key.toLowerCase().startsWith(query)
        )
      : visible;
  }, [sortedRooms, query, isContactBlocked]);

  const filteredRepeaters = useMemo(() => {
    const visible = sortedRepeaters.filter((c) => !isContactBlocked(c));
    return query
      ? visible.filter(
          (c) =>
            c.name?.toLowerCase().includes(query) || c.public_key.toLowerCase().startsWith(query)
        )
      : visible;
  }, [sortedRepeaters, query, isContactBlocked]);

  // Expand sections while searching; restore prior collapse state when search ends.
  useEffect(() => {
    if (isSearching) {
      if (!collapseSnapshotRef.current) {
        collapseSnapshotRef.current = {
          tools: toolsCollapsed,
          favorites: favoritesCollapsed,
          channels: channelsCollapsed,
          contacts: contactsCollapsed,
          rooms: roomsCollapsed,
          repeaters: repeatersCollapsed,
          favChannels: favChannelsCollapsed,
          favContacts: favContactsCollapsed,
          favRooms: favRoomsCollapsed,
          favRepeaters: favRepeatersCollapsed,
        };
      }

      if (
        toolsCollapsed ||
        favoritesCollapsed ||
        channelsCollapsed ||
        contactsCollapsed ||
        roomsCollapsed ||
        repeatersCollapsed ||
        favChannelsCollapsed ||
        favContactsCollapsed ||
        favRoomsCollapsed ||
        favRepeatersCollapsed
      ) {
        setToolsCollapsed(false);
        setFavoritesCollapsed(false);
        setChannelsCollapsed(false);
        setContactsCollapsed(false);
        setRoomsCollapsed(false);
        setRepeatersCollapsed(false);
        setFavChannelsCollapsed(false);
        setFavContactsCollapsed(false);
        setFavRoomsCollapsed(false);
        setFavRepeatersCollapsed(false);
      }
      return;
    }

    if (collapseSnapshotRef.current) {
      const prev = collapseSnapshotRef.current;
      collapseSnapshotRef.current = null;
      setToolsCollapsed(prev.tools);
      setFavoritesCollapsed(prev.favorites);
      setChannelsCollapsed(prev.channels);
      setContactsCollapsed(prev.contacts);
      setRoomsCollapsed(prev.rooms);
      setRepeatersCollapsed(prev.repeaters);
      setFavChannelsCollapsed(prev.favChannels);
      setFavContactsCollapsed(prev.favContacts);
      setFavRoomsCollapsed(prev.favRooms);
      setFavRepeatersCollapsed(prev.favRepeaters);
    }
  }, [
    isSearching,
    toolsCollapsed,
    favoritesCollapsed,
    channelsCollapsed,
    contactsCollapsed,
    roomsCollapsed,
    repeatersCollapsed,
    favChannelsCollapsed,
    favContactsCollapsed,
    favRoomsCollapsed,
    favRepeatersCollapsed,
  ]);

  useEffect(() => {
    if (isSearching) return;

    const state: CollapseState = {
      tools: toolsCollapsed,
      favorites: favoritesCollapsed,
      channels: channelsCollapsed,
      contacts: contactsCollapsed,
      rooms: roomsCollapsed,
      repeaters: repeatersCollapsed,
      favChannels: favChannelsCollapsed,
      favContacts: favContactsCollapsed,
      favRooms: favRoomsCollapsed,
      favRepeaters: favRepeatersCollapsed,
    };

    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_STATE_KEY, JSON.stringify(state));
    } catch {
      // Ignore localStorage write failures (e.g., disabled storage)
    }
  }, [
    isSearching,
    toolsCollapsed,
    favoritesCollapsed,
    channelsCollapsed,
    contactsCollapsed,
    roomsCollapsed,
    repeatersCollapsed,
    favChannelsCollapsed,
    favContactsCollapsed,
    favRoomsCollapsed,
    favRepeatersCollapsed,
  ]);

  // Separate favorites from regular items, and build combined favorites list
  const {
    favoriteItems,
    nonFavoriteChannels,
    nonFavoriteContacts,
    nonFavoriteRooms,
    nonFavoriteRepeaters,
  } = useMemo(() => {
    const favChannels = filteredChannels.filter((c) => c.favorite);
    const favContacts = [
      ...filteredNonRepeaterContacts,
      ...filteredRooms,
      ...filteredRepeaters,
    ].filter((c) => c.favorite);
    const nonFavChannels = filteredChannels.filter((c) => !c.favorite);
    const nonFavContacts = filteredNonRepeaterContacts.filter((c) => !c.favorite);
    const nonFavRooms = filteredRooms.filter((c) => !c.favorite);
    const nonFavRepeaters = filteredRepeaters.filter((c) => !c.favorite);

    const items: FavoriteItem[] = [
      ...favChannels.map((channel) => ({ type: 'channel' as const, channel })),
      ...favContacts.map((contact) => ({ type: 'contact' as const, contact })),
    ];

    return {
      favoriteItems: sortFavoriteItemsByOrder(items, sectionSortOrders.favorites),
      nonFavoriteChannels: nonFavChannels,
      nonFavoriteContacts: nonFavContacts,
      nonFavoriteRooms: nonFavRooms,
      nonFavoriteRepeaters: nonFavRepeaters,
    };
  }, [
    filteredChannels,
    filteredNonRepeaterContacts,
    filteredRooms,
    filteredRepeaters,
    sectionSortOrders.favorites,
    sortFavoriteItemsByOrder,
  ]);

  const buildChannelRow = (channel: Channel, keyPrefix: string): ConversationRow => ({
    key: `${keyPrefix}-${channel.key}`,
    type: 'channel',
    id: channel.key,
    name: channel.name,
    unreadCount: channel.muted ? 0 : getUnreadCount('channel', channel.key),
    isMention: channel.muted ? false : hasMention('channel', channel.key),
    notificationsEnabled: isConversationNotificationsEnabled?.('channel', channel.key) ?? false,
    muted: channel.muted,
  });

  const buildContactRow = (contact: Contact, keyPrefix: string): ConversationRow => ({
    key: `${keyPrefix}-${contact.public_key}`,
    type: 'contact',
    id: contact.public_key,
    name: getContactDisplayName(contact.name, contact.public_key, contact.last_advert),
    unreadCount: getUnreadCount('contact', contact.public_key),
    isMention: hasMention('contact', contact.public_key),
    notificationsEnabled:
      isConversationNotificationsEnabled?.('contact', contact.public_key) ?? false,
    contact,
  });

  const renderConversationRow = (row: ConversationRow) => {
    const highlightUnread =
      row.isMention ||
      (row.type === 'contact' &&
        row.contact?.type !== CONTACT_TYPE_REPEATER &&
        row.unreadCount > 0);
    const rowIsNew = isNew(getStateKey(row.type, row.id));

    return (
      <div
        key={row.key}
        className={cn(
          'px-3 py-2 cursor-pointer flex items-center gap-2 border-l-2 border-transparent hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive(row.type, row.id) && 'bg-accent border-l-primary',
          row.unreadCount > 0 && '[&_.name]:font-semibold [&_.name]:text-foreground'
        )}
        role="button"
        tabIndex={0}
        aria-current={isActive(row.type, row.id) ? 'page' : undefined}
        onKeyDown={handleKeyboardActivate}
        onClick={() =>
          handleSelectConversation({
            type: row.type,
            id: row.id,
            name: row.name,
          })
        }
      >
        {row.type === 'contact' && row.contact && (
          <ContactAvatar
            name={row.contact.name}
            publicKey={row.contact.public_key}
            size={24}
            contactType={row.contact.type}
          />
        )}
        <span
          className={cn('name flex-1 truncate text-[0.8125rem]', row.muted && 'opacity-40 italic')}
        >
          {row.name}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {rowIsNew && (
            <span
              className="h-2 w-2 rounded-full bg-badge-new"
              aria-label={t('a11y_new_item')}
              title={t('a11y_new_item')}
            />
          )}
          {row.muted ? (
            <span aria-label={t('a11y_channel_muted')} title={t('a11y_channel_muted')}>
              <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : (
            <>
              {row.notificationsEnabled && (
                <span
                  aria-label={t('a11y_notifications_enabled')}
                  title={t('a11y_notifications_enabled')}
                >
                  <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              )}
              {row.unreadCount > 0 && (
                <span
                  className={cn(
                    'text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                    highlightUnread
                      ? 'bg-badge-mention text-badge-mention-foreground'
                      : 'bg-badge-unread/90 text-badge-unread-foreground'
                  )}
                  aria-label={t('a11y_unread_messages', { count: row.unreadCount })}
                >
                  {row.unreadCount}
                </span>
              )}
            </>
          )}
        </span>
      </div>
    );
  };

  const renderSidebarActionRow = ({
    key,
    active = false,
    icon,
    label,
    onClick,
    iconOnly = false,
    iconTitle,
  }: {
    key: string;
    active?: boolean;
    icon: React.ReactNode;
    label: React.ReactNode;
    onClick: () => void;
    iconOnly?: boolean;
    iconTitle?: string;
  }) => {
    if (iconOnly) {
      const labelText = iconTitle ?? (typeof label === 'string' ? label : key);
      return (
        <div
          key={key}
          data-active={active ? 'true' : undefined}
          className={cn(
            'w-full py-2 cursor-pointer flex items-center justify-center border-l-2 border-transparent hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent border-l-primary'
          )}
          role="button"
          tabIndex={0}
          aria-current={active ? 'page' : undefined}
          aria-label={labelText}
          title={labelText}
          onKeyDown={handleKeyboardActivate}
          onClick={onClick}
        >
          <span aria-hidden="true">{icon}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        data-active={active ? 'true' : undefined}
        className={cn(
          'sidebar-action-row px-3 py-2 cursor-pointer flex items-center gap-2 border-l-2 border-transparent hover:bg-accent transition-colors text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'bg-accent border-l-primary'
        )}
        role="button"
        tabIndex={0}
        aria-current={active ? 'page' : undefined}
        onKeyDown={handleKeyboardActivate}
        onClick={onClick}
      >
        <span className="sidebar-tool-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sidebar-tool-label flex-1 truncate">{label}</span>
      </div>
    );
  };

  const getSectionUnreadCount = (rows: ConversationRow[]): number =>
    rows.reduce((total, row) => total + row.unreadCount, 0);

  const sectionHasMention = (rows: ConversationRow[]): boolean => rows.some((row) => row.isMention);

  const favoriteRows = favoriteItems.map((item) =>
    item.type === 'channel'
      ? buildChannelRow(item.channel, 'fav-chan')
      : buildContactRow(item.contact, 'fav-contact')
  );
  // Favourites split by type for the collapsible sub-sections. Ranks come from
  // favoriteTypeRank: channel=0, contact=1, room=2, repeater=3.
  const favoriteChannelRows = favoriteItems
    .filter((i): i is Extract<FavoriteItem, { type: 'channel' }> => i.type === 'channel')
    .map((i) => buildChannelRow(i.channel, 'fav-chan'));
  const favoriteContactRows = favoriteItems
    .filter(
      (i): i is Extract<FavoriteItem, { type: 'contact' }> =>
        i.type === 'contact' && favoriteTypeRank(i) === 1
    )
    .map((i) => buildContactRow(i.contact, 'fav-contact'));
  const favoriteRoomRows = favoriteItems
    .filter(
      (i): i is Extract<FavoriteItem, { type: 'contact' }> =>
        i.type === 'contact' && favoriteTypeRank(i) === 2
    )
    .map((i) => buildContactRow(i.contact, 'fav-room'));
  const favoriteRepeaterRows = favoriteItems
    .filter(
      (i): i is Extract<FavoriteItem, { type: 'contact' }> =>
        i.type === 'contact' && favoriteTypeRank(i) === 3
    )
    .map((i) => buildContactRow(i.contact, 'fav-repeater'));
  // Favourite sub-sections only make sense in a type-grouped sort mode. In the
  // flat modes (recent/alpha) the favourites render as a single flat list, which
  // preserves the existing 4-way favourites sort behaviour.
  const favoritesGroupedByType =
    sectionSortOrders.favorites === 'type-recent' || sectionSortOrders.favorites === 'type-alpha';
  const channelRows = nonFavoriteChannels.map((channel) => buildChannelRow(channel, 'chan'));
  const contactRows = nonFavoriteContacts.map((contact) => buildContactRow(contact, 'contact'));
  const roomRows = nonFavoriteRooms.map((contact) => buildContactRow(contact, 'room'));
  const repeaterRows = nonFavoriteRepeaters.map((contact) => buildContactRow(contact, 'repeater'));

  const favoritesUnreadCount = getSectionUnreadCount(favoriteRows);
  const channelsUnreadCount = getSectionUnreadCount(channelRows);
  const contactsUnreadCount = getSectionUnreadCount(contactRows);
  const roomsUnreadCount = getSectionUnreadCount(roomRows);
  const repeatersUnreadCount = getSectionUnreadCount(repeaterRows);
  const favoritesHasMention = sectionHasMention(favoriteRows);
  const channelsHasMention = sectionHasMention(channelRows);
  const identitiesOf = (rows: ConversationRow[]): string[] =>
    rows.map((row) => getStateKey(row.type, row.id));
  const favoritesNewCount = countNew(identitiesOf(favoriteRows));
  const channelsNewCount = countNew(identitiesOf(channelRows));
  const contactsNewCount = countNew(identitiesOf(contactRows));
  const roomsNewCount = countNew(identitiesOf(roomRows));
  const repeatersNewCount = countNew(identitiesOf(repeaterRows));

  // Clear a section: mark its unread conversations read and all its items seen.
  const clearSection = (rows: ConversationRow[]) => {
    const readItems = rows
      .filter((row) => row.unreadCount > 0)
      .map((row) => ({ type: row.type, id: row.id }));
    onMarkSectionRead?.(readItems);
    markSeen(identitiesOf(rows));
  };

  // Single source of truth for a tool row, used for both the full list and the
  // icon-only rail. Order is data-driven via `toolOrder` (utils/sidebarLayout).
  const buildToolRow = (toolKey: SidebarToolKey, iconOnly: boolean): React.ReactNode => {
    switch (toolKey) {
      case 'my-node':
        return renderSidebarActionRow({
          key: 'tool-my-node',
          active: isActive('node', 'node'),
          icon: <Gauge className="h-4 w-4" />,
          label: t('nav_my_node'),
          onClick: () =>
            handleSelectConversation({ type: 'node', id: 'node', name: t('nav_my_node') }),
          iconOnly,
        });
      case 'mesh-health':
        return renderSidebarActionRow({
          key: 'tool-mesh-health',
          active: isActive('mesh-health', 'mesh-health'),
          icon: <Activity className="h-4 w-4" />,
          label: t('nav_mesh_health'),
          onClick: () =>
            handleSelectConversation({
              type: 'mesh-health',
              id: 'mesh-health',
              name: t('nav_mesh_health'),
            }),
          iconOnly,
        });
      case 'raw':
        return renderSidebarActionRow({
          key: 'tool-raw',
          active: isActive('raw', 'raw'),
          icon: <Logs className="h-4 w-4" />,
          label: t('nav_packet_feed'),
          onClick: () =>
            handleSelectConversation({
              type: 'raw',
              id: 'raw',
              name: t('nav_raw_packet_feed_name'),
            }),
          iconOnly,
        });
      case 'map':
        return renderSidebarActionRow({
          key: 'tool-map',
          active: isActive('map', 'map'),
          icon: <Map className="h-4 w-4" />,
          label: t('nav_node_map'),
          onClick: () =>
            handleSelectConversation({ type: 'map', id: 'map', name: t('nav_node_map') }),
          iconOnly,
        });
      case 'visualizer':
        return renderSidebarActionRow({
          key: 'tool-visualizer',
          active: isActive('visualizer', 'visualizer'),
          icon: <ChartNetwork className="h-4 w-4" />,
          label: t('nav_mesh_visualizer'),
          onClick: () =>
            handleSelectConversation({
              type: 'visualizer',
              id: 'visualizer',
              name: t('nav_mesh_visualizer'),
            }),
          iconOnly,
        });
      case 'trace':
        return renderSidebarActionRow({
          key: 'tool-trace',
          active: isActive('trace', 'trace'),
          icon: <Cable className="h-4 w-4" />,
          label: t('nav_trace'),
          onClick: () =>
            handleSelectConversation({ type: 'trace', id: 'trace', name: t('nav_trace') }),
          iconOnly,
        });
      case 'search':
        return renderSidebarActionRow({
          key: 'tool-search',
          active: isActive('search', 'search'),
          icon: <SearchIcon className="h-4 w-4" />,
          label: t('nav_message_search'),
          onClick: () =>
            handleSelectConversation({
              type: 'search',
              id: 'search',
              name: t('nav_message_search'),
            }),
          iconOnly,
        });
      case 'channel-registry':
        return renderSidebarActionRow({
          key: 'tool-channel-registry',
          active: isActive('channel-registry', 'channel-registry'),
          icon: <Library className="h-4 w-4" />,
          label: 'Channel Registry',
          onClick: () =>
            handleSelectConversation({
              type: 'channel-registry',
              id: 'channel-registry',
              name: 'Channel Registry',
            }),
          iconOnly,
        });
      case 'cracker':
        return renderSidebarActionRow({
          key: 'tool-cracker',
          active: showCracker,
          icon: <LockOpen className="h-4 w-4" />,
          iconTitle: t('nav_show_channel_finder'),
          label: (
            <>
              {t(showCracker ? 'nav_hide_channel_finder' : 'nav_show_channel_finder')}
              <span
                className={cn(
                  'ml-1 text-[0.6875rem]',
                  crackerRunning ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {t(crackerRunning ? 'chat_cracker_status_running' : 'chat_cracker_status_idle')}
              </span>
            </>
          ),
          onClick: onToggleCracker,
          iconOnly,
        });
      default:
        return null;
    }
  };

  const toolRows = !query ? toolOrder.map((k) => buildToolRow(k, false)) : [];
  const toolIconRows = toolOrder.map((k) => buildToolRow(k, true));

  const renderSectionHeader = (
    title: string,
    collapsed: boolean,
    onToggle: () => void,
    sortSection: SidebarSortableSection | null = null,
    unreadCount = 0,
    highlightUnread = false,
    action: React.ReactNode = null,
    totalCount = 0,
    newCount = 0,
    onClearSection: (() => void) | null = null
  ) => {
    const effectiveCollapsed = isSearching ? false : collapsed;
    const sectionSortOrder = sortSection ? sectionSortOrders[sortSection] : null;

    return (
      <div className="flex justify-between items-center px-3 py-2 pt-3.5">
        <button
          className={cn(
            'dd-section-label flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
            isSearching && 'cursor-default'
          )}
          aria-expanded={!effectiveCollapsed}
          onClick={() => {
            if (!isSearching) onToggle();
          }}
          title={t(effectiveCollapsed ? 'nav_expand_section' : 'nav_collapse_section', {
            section: title,
          })}
        >
          {effectiveCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{title}</span>
        </button>
        {totalCount > 0 && (
          <span
            className="ml-1.5 text-[0.625rem] font-semibold tabular-nums text-muted-foreground/70"
            aria-label={t('a11y_total_count', { count: totalCount })}
          >
            {totalCount}
          </span>
        )}
        {(sortSection || unreadCount > 0 || newCount > 0 || action || onClearSection) && (
          <div className="ml-auto flex items-center gap-1.5">
            {action}
            {sortSection && sectionSortOrder && (
              <button
                className="bg-transparent text-muted-foreground/60 px-1 py-0.5 text-[0.625rem] rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap"
                onClick={() => handleSortToggle(sortSection)}
                aria-label={t('chat_sort_aria', {
                  section: title,
                  description: sortOrderDescription(
                    nextSortOrder(sortSection, sectionSortOrder),
                    t
                  ),
                })}
                title={t('chat_sort_title', {
                  current: sortOrderDescription(sectionSortOrder, t),
                  next: sortOrderDescription(nextSortOrder(sortSection, sectionSortOrder), t),
                })}
              >
                {sortOrderLabel(sectionSortOrder, t)}
              </button>
            )}
            {onClearSection && (
              <button
                className="bg-transparent text-muted-foreground/60 p-0.5 rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSection();
                }}
                aria-label={t('nav_section_mark_read_seen')}
                title={t('nav_section_mark_read_seen')}
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {newCount > 0 && (
              <span
                className="text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full bg-badge-new/15 text-badge-new"
                aria-label={t('a11y_new_count', { count: newCount })}
              >
                {newCount}
              </span>
            )}
            {unreadCount > 0 && (
              <span
                className={cn(
                  'text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full',
                  highlightUnread
                    ? 'bg-badge-mention text-badge-mention-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
                aria-label={t('a11y_unread_count', { count: unreadCount })}
              >
                {unreadCount}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (key: SidebarSectionKey): React.ReactNode => {
    switch (key) {
      case 'tools':
        return toolRows.length > 0 ? (
          <div key="sec-tools">
            {renderSectionHeader(t('nav_tools_heading'), toolsCollapsed, () =>
              setToolsCollapsed((prev) => !prev)
            )}
            {(isSearching || !toolsCollapsed) && toolRows}
          </div>
        ) : null;
      case 'favorites':
        return favoriteItems.length > 0 ? (
          <div key="sec-favorites">
            {renderSectionHeader(
              t('nav_favorites_heading'),
              favoritesCollapsed,
              () => setFavoritesCollapsed((prev) => !prev),
              'favorites',
              favoritesUnreadCount,
              favoritesHasMention,
              null,
              favoriteRows.length,
              favoritesNewCount,
              favoritesUnreadCount > 0 || favoritesNewCount > 0
                ? () => clearSection(favoriteRows)
                : null
            )}
            {(isSearching || !favoritesCollapsed) &&
              (favoritesGroupedByType ? (
                <>
                  {favoriteChannelRows.length > 0 && (
                    <>
                      {renderSectionHeader(t('nav_favorite_channels'), favChannelsCollapsed, () =>
                        setFavChannelsCollapsed((prev) => !prev)
                      )}
                      {(isSearching || !favChannelsCollapsed) &&
                        favoriteChannelRows.map((row) => renderConversationRow(row))}
                    </>
                  )}
                  {favoriteContactRows.length > 0 && (
                    <>
                      {renderSectionHeader(t('nav_favorite_contacts'), favContactsCollapsed, () =>
                        setFavContactsCollapsed((prev) => !prev)
                      )}
                      {(isSearching || !favContactsCollapsed) &&
                        favoriteContactRows.map((row) => renderConversationRow(row))}
                    </>
                  )}
                  {favoriteRoomRows.length > 0 && (
                    <>
                      {renderSectionHeader(t('nav_favorite_room_servers'), favRoomsCollapsed, () =>
                        setFavRoomsCollapsed((prev) => !prev)
                      )}
                      {(isSearching || !favRoomsCollapsed) &&
                        favoriteRoomRows.map((row) => renderConversationRow(row))}
                    </>
                  )}
                  {favoriteRepeaterRows.length > 0 && (
                    <>
                      {renderSectionHeader(t('nav_favorite_repeaters'), favRepeatersCollapsed, () =>
                        setFavRepeatersCollapsed((prev) => !prev)
                      )}
                      {(isSearching || !favRepeatersCollapsed) &&
                        favoriteRepeaterRows.map((row) => renderConversationRow(row))}
                    </>
                  )}
                </>
              ) : (
                favoriteRows.map((row) => renderConversationRow(row))
              ))}
          </div>
        ) : null;
      case 'channels':
        return nonFavoriteChannels.length > 0 ? (
          <div key="sec-channels">
            {renderSectionHeader(
              t('nav_channels_heading'),
              channelsCollapsed,
              () => setChannelsCollapsed((prev) => !prev),
              'channels',
              channelsUnreadCount,
              channelsHasMention,
              onOpenChannelImportExport ? (
                <button
                  className="bg-transparent text-muted-foreground/60 p-0.5 rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChannelImportExport();
                  }}
                  aria-label="Import or export channels"
                  title="Import / export channels"
                >
                  <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null,
              channelRows.length,
              channelsNewCount,
              channelsUnreadCount > 0 || channelsNewCount > 0
                ? () => clearSection(channelRows)
                : null
            )}
            {(isSearching || !channelsCollapsed) &&
              channelRows.map((row) => renderConversationRow(row))}
          </div>
        ) : null;
      case 'contacts':
        return nonFavoriteContacts.length > 0 ? (
          <div key="sec-contacts">
            {renderSectionHeader(
              t('nav_contacts_heading'),
              contactsCollapsed,
              () => setContactsCollapsed((prev) => !prev),
              'contacts',
              contactsUnreadCount,
              contactsUnreadCount > 0,
              null,
              contactRows.length,
              contactsNewCount,
              contactsUnreadCount > 0 || contactsNewCount > 0
                ? () => clearSection(contactRows)
                : null
            )}
            {(isSearching || !contactsCollapsed) &&
              contactRows.map((row) => renderConversationRow(row))}
          </div>
        ) : null;
      case 'repeaters':
        return nonFavoriteRepeaters.length > 0 ? (
          <div key="sec-repeaters">
            {renderSectionHeader(
              t('nav_repeaters_heading'),
              repeatersCollapsed,
              () => setRepeatersCollapsed((prev) => !prev),
              'repeaters',
              repeatersUnreadCount,
              false,
              null,
              repeaterRows.length,
              repeatersNewCount,
              repeatersUnreadCount > 0 || repeatersNewCount > 0
                ? () => clearSection(repeaterRows)
                : null
            )}
            {(isSearching || !repeatersCollapsed) &&
              repeaterRows.map((row) => renderConversationRow(row))}
          </div>
        ) : null;
      case 'rooms':
        return nonFavoriteRooms.length > 0 ? (
          <div key="sec-rooms">
            {renderSectionHeader(
              t('nav_room_servers_heading'),
              roomsCollapsed,
              () => setRoomsCollapsed((prev) => !prev),
              'rooms',
              roomsUnreadCount,
              roomsUnreadCount > 0,
              null,
              roomRows.length,
              roomsNewCount,
              roomsUnreadCount > 0 || roomsNewCount > 0 ? () => clearSection(roomRows) : null
            )}
            {(isSearching || !roomsCollapsed) && roomRows.map((row) => renderConversationRow(row))}
          </div>
        ) : null;
      default:
        return null;
    }
  };

  const sectionLabels: Record<SidebarSectionKey, string> = {
    tools: t('nav_tools_heading'),
    favorites: t('nav_favorites_heading'),
    channels: t('nav_channels_heading'),
    contacts: t('nav_contacts_heading'),
    repeaters: t('nav_repeaters_heading'),
    rooms: t('nav_room_servers_heading'),
  };
  const toolLabels: Record<SidebarToolKey, string> = {
    'my-node': t('nav_my_node'),
    'mesh-health': t('nav_mesh_health'),
    raw: t('nav_packet_feed'),
    map: t('nav_node_map'),
    visualizer: t('nav_mesh_visualizer'),
    trace: t('nav_trace'),
    search: t('nav_message_search'),
    'channel-registry': 'Channel Registry',
    cracker: t('nav_show_channel_finder'),
  };

  return (
    <nav
      className={cn(
        'sidebar h-full min-h-0 overflow-hidden bg-card border-r border-border flex flex-col transition-[width] duration-200',
        isRail ? 'w-12' : 'w-60'
      )}
      aria-label={t('a11y_conversations_nav')}
    >
      {isRail ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-stretch py-2">
          {toolIconRows}
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onNewMessage}
              title={t('a11y_add_channel_or_contact')}
              aria-label={t('a11y_add_channel_or_contact')}
              className="h-8 flex-1 justify-start gap-2 border-primary/20 bg-primary/5 px-3 text-[0.8125rem] text-primary hover:bg-primary/10 hover:text-primary"
            >
              <SquarePen className="h-4 w-4" />
              <span>{t('nav_add_channel_contact')}</span>
            </Button>
            <button
              type="button"
              className="h-8 w-8 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowSettings((p) => !p)}
              aria-label={t('nav_customize_sidebar')}
              aria-expanded={showSettings}
              title={t('nav_customize_sidebar')}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 min-h-0 overflow-y-auto [contain:layout_paint]">
            <div className="px-3 py-2 border-b border-border/60">
              <div className="relative min-w-0">
                <Input
                  type="text"
                  placeholder={t('common_search_channels_contacts')}
                  aria-label={t('a11y_search_conversations')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    'h-7 text-[0.8125rem] bg-background/50',
                    searchQuery ? 'pr-8' : 'pr-3'
                  )}
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    onClick={() => setSearchQuery('')}
                    title={t('a11y_clear_search')}
                    aria-label={t('a11y_clear_search')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Customize sidebar panel */}
            {showSettings && (
              <div
                role="group"
                aria-label={t('nav_customize_sidebar')}
                className="px-3 py-3 border-b border-border space-y-4"
              >
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5">
                    {t('nav_section_order')}
                  </div>
                  <DragList
                    items={sectionOrder}
                    labels={sectionLabels}
                    onReorder={handleReorderSections}
                    moveUpLabel={t('nav_move_up')}
                    moveDownLabel={t('nav_move_down')}
                  />
                </div>
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5">
                    {t('nav_tool_order')}
                  </div>
                  <DragList
                    items={toolOrder}
                    labels={toolLabels}
                    onReorder={handleReorderTools}
                    moveUpLabel={t('nav_move_up')}
                    moveDownLabel={t('nav_move_down')}
                  />
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={handleResetLayout}>
                  {t('nav_reset_to_defaults')}
                </Button>
              </div>
            )}

            {/* Mark All Read */}
            {!query && Object.values(unreadCounts).some((c) => c > 0) && (
              <div
                className="px-3 py-2 cursor-pointer flex items-center gap-2 border-l-2 border-transparent hover:bg-accent transition-colors text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                role="button"
                tabIndex={0}
                onKeyDown={handleKeyboardActivate}
                onClick={onMarkAllRead}
              >
                <CheckCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate text-muted-foreground">
                  {t('chat_mark_all_read')}
                </span>
              </div>
            )}

            {/* Sections in user order */}
            {sectionOrder.map((sectionKey) => renderSection(sectionKey))}

            {/* Empty state */}
            {nonFavoriteContacts.length === 0 &&
              nonFavoriteRooms.length === 0 &&
              nonFavoriteChannels.length === 0 &&
              nonFavoriteRepeaters.length === 0 &&
              favoriteItems.length === 0 && (
                <div className="p-5 text-center text-muted-foreground">
                  {query ? t('common_no_matches_found') : t('common_no_conversations_yet')}
                </div>
              )}
          </div>
        </>
      )}

      {!forceExpanded && (
        <div className="border-t border-border p-1 flex justify-center">
          <button
            type="button"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={toggleRail}
            aria-label={isRail ? t('nav_expand_sidebar') : t('nav_collapse_sidebar')}
            title={isRail ? t('nav_expand_sidebar') : t('nav_collapse_sidebar')}
          >
            {isRail ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </nav>
  );
}
