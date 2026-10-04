import type { Channel, Contact, Conversation, Message } from '../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../types';
import { getStateKey, type ConversationTimes } from '../utils/conversationState';
import { parseSenderFromText } from '../utils/messageParser';
import { isPublicChannelKey } from '../utils/publicChannel';
import { getContactDisplayName } from '../utils/pubkey';

export interface PopoutListEntry {
  conversation: Conversation & { type: 'channel' | 'contact' };
  unread: number;
  mention: boolean;
  muted: boolean;
}

export interface PopoutListSections {
  channels: PopoutListEntry[];
  direct: PopoutListEntry[];
  rooms: PopoutListEntry[];
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
}: BuildSectionsArgs): PopoutListSections {
  const needle = query.trim().toLowerCase();
  const stats = (type: 'channel' | 'contact', id: string) => {
    const key = getStateKey(type, id);
    return {
      unread: unreadCounts[key] || 0,
      mention: mentions[key] || false,
      time: lastMessageTimes[key] || 0,
    };
  };

  const seenChannels = new Set<string>();
  const channelEntries = channels
    .filter((channel) => {
      if (seenChannels.has(channel.key)) return false;
      seenChannels.add(channel.key);
      return !needle || channel.name.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      if (isPublicChannelKey(a.key)) return -1;
      if (isPublicChannelKey(b.key)) return 1;
      if (a.muted !== b.muted) return a.muted ? 1 : -1;
      return a.name.localeCompare(b.name);
    })
    .map((channel): PopoutListEntry => {
      const { unread, mention } = stats('channel', channel.key);
      return {
        conversation: { type: 'channel', id: channel.key, name: channel.name },
        unread,
        mention,
        muted: channel.muted,
      };
    });

  const seenContacts = new Set<string>();
  const direct: Array<PopoutListEntry & { time: number }> = [];
  const rooms: Array<PopoutListEntry & { time: number }> = [];
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
    if (needle) {
      const matches =
        name.toLowerCase().includes(needle) || contact.public_key.toLowerCase().startsWith(needle);
      if (!matches) continue;
    } else if (!isRoom) {
      const isActive =
        activeConversation?.type === 'contact' && activeConversation.id === contact.public_key;
      if (!time && !unread && !contact.favorite && !isActive) continue;
    }

    (isRoom ? rooms : direct).push({
      conversation: { type: 'contact', id: contact.public_key, name },
      unread,
      mention,
      muted: false,
      time,
    });
  }

  const byActivity = (
    a: PopoutListEntry & { time: number },
    b: PopoutListEntry & { time: number }
  ) => {
    if (a.unread > 0 !== b.unread > 0) return a.unread > 0 ? -1 : 1;
    if (a.time !== b.time) return b.time - a.time;
    return a.conversation.name.localeCompare(b.conversation.name);
  };

  return {
    channels: channelEntries,
    direct: direct.sort(byActivity),
    rooms: rooms.sort(byActivity),
  };
}

export interface RecentSender {
  name: string;
  /** What contact info is opened with: a public key, or `name:<name>` when unknown. */
  key: string;
}

/**
 * Who has spoken in the loaded history, A-Z. MeshCore channels have no member
 * roster, so this is the nearest thing to a nick list. Plain DMs yield nothing:
 * only channel messages and room-server posts carry a sender name.
 */
export function recentSenders(messages: Message[], contacts: Contact[]): RecentSender[] {
  const byName = new Map<string, RecentSender>();
  for (const msg of messages) {
    if (msg.outgoing) continue;
    const name =
      msg.type === 'CHAN'
        ? msg.sender_name || parseSenderFromText(msg.text).sender
        : msg.sender_name;
    if (!name) continue;
    const known = byName.get(name);
    if (known && !known.key.startsWith('name:')) continue;
    const key =
      msg.sender_key ||
      contacts.find((contact) => contact.name === name)?.public_key ||
      `name:${name}`;
    byName.set(name, { name, key });
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}
