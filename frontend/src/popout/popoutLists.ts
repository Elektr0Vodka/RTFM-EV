import type { Channel, Contact, Conversation, Message } from '../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../types';
import { getStateKey, type ConversationTimes } from '../utils/conversationState';
import { parseSenderFromText } from '../utils/messageParser';
import { calculateDistance, getEffectiveLocation } from '../utils/pathUtils';
import { isPublicChannelKey } from '../utils/publicChannel';
import { getContactDisplayName } from '../utils/pubkey';
import {
  DEFAULT_POPOUT_LIST_PREFS,
  isDistanceSort,
  type PopoutSection,
  type PopoutSenderSort,
  type PopoutSortOrder,
} from './popoutListPrefs';

export interface PopoutListEntry {
  conversation: Conversation & { type: 'channel' | 'contact' };
  unread: number;
  mention: boolean;
  muted: boolean;
  /** Distance from the radio; null for channels and whenever either end has no location. */
  distanceKm: number | null;
}

export type PopoutListSections = Record<PopoutSection, PopoutListEntry[]>;

/** The radio's own position, already checked to be a real one. */
export interface PopoutOrigin {
  lat: number;
  lon: number;
}

interface BuildSectionsArgs {
  channels: Channel[];
  contacts: Contact[];
  lastMessageTimes: ConversationTimes;
  unreadCounts: Record<string, number>;
  mentions: Record<string, boolean>;
  blockedKeys?: string[];
  blockedNames?: string[];
  activeConversation: Conversation | null;
  /** Filter text. When set, every channel and non-repeater contact is searched. */
  query?: string;
  /** Order per section; a section left out keeps its default. */
  sort?: Partial<Record<PopoutSection, PopoutSortOrder>>;
  /** The three list toggles. The open conversation is listed regardless. */
  favoritesOnly?: boolean;
  unreadOnly?: boolean;
  hideMuted?: boolean;
  /** Where distances are measured from; null when the radio has no location. */
  origin?: PopoutOrigin | null;
}

type RankedEntry = PopoutListEntry & { time: number };

function distanceFrom(origin: PopoutOrigin | null, contact: Contact): number | null {
  if (!origin) return null;
  const location = getEffectiveLocation(contact);
  if (!location) return null;
  const km = calculateDistance(origin.lat, origin.lon, location.lat, location.lon);
  return km !== null && Number.isFinite(km) ? km : null;
}

/** Entries without a value (never spoke, no location) go last whichever way the order runs. */
function compareKnown(a: number | null, b: number | null, descending: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return descending ? b - a : a - b;
}

const byName = (a: PopoutListEntry, b: PopoutListEntry) =>
  a.conversation.name.localeCompare(b.conversation.name);

// Every order falls back to A-Z for entries it cannot tell apart.
const ORDER_COMPARATORS: Record<PopoutSortOrder, (a: RankedEntry, b: RankedEntry) => number> = {
  recent: (a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.time - a.time,
  oldest: (a, b) => compareKnown(a.time || null, b.time || null, false),
  alpha: () => 0,
  'alpha-desc': (a, b) => byName(b, a),
  unread: (a, b) => b.unread - a.unread || b.time - a.time,
  nearest: (a, b) => compareKnown(a.distanceKm, b.distanceKm, false),
  farthest: (a, b) => compareKnown(a.distanceKm, b.distanceKm, true),
};

// Public leads the channels and muted channels trail them, in every order.
const channelRank = (entry: PopoutListEntry) =>
  isPublicChannelKey(entry.conversation.id) ? 0 : entry.muted ? 2 : 1;

function sortEntries(
  entries: RankedEntry[],
  order: PopoutSortOrder,
  rank?: (entry: PopoutListEntry) => number
): PopoutListEntry[] {
  const compare = ORDER_COMPARATORS[order];
  return entries.sort((a, b) => (rank ? rank(a) - rank(b) : 0) || compare(a, b) || byName(a, b));
}

/**
 * The popup's conversation list. Channels and rooms are always listed. Direct
 * only lists contacts with something to show (a message, unread, favourite, or
 * the open one): the contact table holds every node ever heard, which is the
 * main sidebar's job to browse. A filter query searches all of them instead.
 * Repeaters are left out; they are dashboards, not chats.
 */
export function buildPopoutSections({
  channels,
  contacts,
  lastMessageTimes,
  unreadCounts,
  mentions,
  blockedKeys = [],
  blockedNames = [],
  activeConversation,
  query = '',
  sort = {},
  favoritesOnly = false,
  unreadOnly = false,
  hideMuted = false,
  origin = null,
}: BuildSectionsArgs): PopoutListSections {
  const needle = query.trim().toLowerCase();
  const order = { ...DEFAULT_POPOUT_LIST_PREFS.sort, ...sort };
  const stats = (type: 'channel' | 'contact', id: string) => {
    const key = getStateKey(type, id);
    return {
      unread: unreadCounts[key] || 0,
      mention: mentions[key] || false,
      time: lastMessageTimes[key] || 0,
    };
  };
  const isActive = (type: 'channel' | 'contact', id: string) =>
    activeConversation?.type === type && activeConversation.id === id;
  const passesToggles = (item: { favorite: boolean; unread: number; muted: boolean }) =>
    (!favoritesOnly || item.favorite) &&
    (!unreadOnly || item.unread > 0) &&
    (!hideMuted || !item.muted);

  const seenChannels = new Set<string>();
  const channelEntries: RankedEntry[] = [];
  for (const channel of channels) {
    if (seenChannels.has(channel.key)) continue;
    seenChannels.add(channel.key);
    if (needle && !channel.name.toLowerCase().includes(needle)) continue;

    const { unread, mention, time } = stats('channel', channel.key);
    if (
      !isActive('channel', channel.key) &&
      !passesToggles({ favorite: channel.favorite, unread, muted: channel.muted })
    ) {
      continue;
    }
    channelEntries.push({
      conversation: { type: 'channel', id: channel.key, name: channel.name },
      unread,
      mention,
      muted: channel.muted,
      distanceKm: null,
      time,
    });
  }

  const seenContacts = new Set<string>();
  const direct: RankedEntry[] = [];
  const rooms: RankedEntry[] = [];
  for (const contact of contacts) {
    if (!contact.public_key || seenContacts.has(contact.public_key)) continue;
    seenContacts.add(contact.public_key);
    if (contact.type === CONTACT_TYPE_REPEATER) continue;
    if (
      blockedKeys.includes(contact.public_key.toLowerCase()) ||
      (contact.name != null && blockedNames.includes(contact.name))
    ) {
      continue;
    }

    const name = getContactDisplayName(contact.name, contact.public_key, contact.last_advert);
    const { unread, mention, time } = stats('contact', contact.public_key);
    const isRoom = contact.type === CONTACT_TYPE_ROOM;
    const active = isActive('contact', contact.public_key);
    if (needle) {
      const matches =
        name.toLowerCase().includes(needle) || contact.public_key.toLowerCase().startsWith(needle);
      if (!matches) continue;
    } else if (!isRoom) {
      if (!time && !unread && !contact.favorite && !active) continue;
    }
    if (!active && !passesToggles({ favorite: contact.favorite, unread, muted: false })) continue;

    (isRoom ? rooms : direct).push({
      conversation: { type: 'contact', id: contact.public_key, name },
      unread,
      mention,
      muted: false,
      distanceKm: distanceFrom(origin, contact),
      time,
    });
  }

  return {
    channels: sortEntries(channelEntries, order.channels, channelRank),
    direct: sortEntries(direct, order.direct),
    rooms: sortEntries(rooms, order.rooms),
  };
}

export interface RecentSender {
  name: string;
  /** What contact info is opened with: a public key, or `name:<name>` when unknown. */
  key: string;
  /** Distance from the radio. Only set under a distance order, for a located contact. */
  distanceKm?: number;
}

interface RecentSendersOptions {
  sort?: PopoutSenderSort;
  /** Where distances are measured from; null when the radio has no location. */
  origin?: PopoutOrigin | null;
}

/**
 * Who has spoken in the loaded history, A-Z unless another order is picked.
 * MeshCore channels have no member roster, so this is the nearest thing to a
 * nick list. Plain DMs yield nothing: only channel messages and room-server
 * posts carry a sender name.
 */
export function recentSenders(
  messages: Message[],
  contacts: Contact[],
  { sort = 'alpha', origin = null }: RecentSendersOptions = {}
): RecentSender[] {
  const byName = new Map<string, RecentSender & { count: number; time: number }>();
  for (const msg of messages) {
    if (msg.outgoing) continue;
    const name =
      msg.type === 'CHAN'
        ? msg.sender_name || parseSenderFromText(msg.text).sender
        : msg.sender_name;
    if (!name) continue;
    const sender = byName.get(name) ?? { name, key: `name:${name}`, count: 0, time: 0 };
    sender.count += 1;
    sender.time = Math.max(sender.time, msg.received_at || 0);
    if (sender.key.startsWith('name:')) {
      sender.key =
        msg.sender_key ||
        contacts.find((contact) => contact.name === name)?.public_key ||
        sender.key;
    }
    byName.set(name, sender);
  }

  const senders = [...byName.values()];
  if (origin && isDistanceSort(sort)) {
    const byKey = new Map(contacts.map((contact) => [contact.public_key.toLowerCase(), contact]));
    for (const sender of senders) {
      const contact = byKey.get(sender.key.toLowerCase());
      const km = contact ? distanceFrom(origin, contact) : null;
      if (km !== null) sender.distanceKm = km;
    }
  }

  const alpha = (a: RecentSender, b: RecentSender) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const distance = (sender: RecentSender) => sender.distanceKm ?? null;
  const compare: Record<
    PopoutSenderSort,
    (a: (typeof senders)[0], b: (typeof senders)[0]) => number
  > = {
    alpha: () => 0,
    'alpha-desc': (a, b) => alpha(b, a),
    recent: (a, b) => b.time - a.time,
    messages: (a, b) => b.count - a.count,
    nearest: (a, b) => compareKnown(distance(a), distance(b), false),
    farthest: (a, b) => compareKnown(distance(a), distance(b), true),
  };
  return senders
    .sort((a, b) => compare[sort](a, b) || alpha(a, b))
    .map(({ name, key, distanceKm }) =>
      distanceKm === undefined ? { name, key } : { name, key, distanceKm }
    );
}
