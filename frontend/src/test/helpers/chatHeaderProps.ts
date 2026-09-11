import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { ChatHeader } from '../../components/ChatHeader';
import type { Channel, Contact, Conversation, PathDiscoveryResponse } from '../../types';
import { CONTACT_TYPE_ROOM } from '../../types';

const CHANNEL_KEY = 'AA'.repeat(16);
const CONTACT_KEY = 'BB'.repeat(32);

const channel: Channel = {
  key: CHANNEL_KEY,
  name: '#general',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

const conversation: Conversation = { type: 'channel', id: CHANNEL_KEY, name: '#general' };

const noop = () => {};

type ChatHeaderProps = ComponentProps<typeof ChatHeader>;

/**
 * A complete, valid ChatHeader props object for a channel conversation, mirroring
 * the baseline in chatHeaderKeyVisibility.test.tsx. Spread overrides last.
 */
export function makeChannelChatHeaderProps(
  overrides: Partial<ChatHeaderProps> = {}
): ChatHeaderProps {
  return {
    conversation,
    channels: [channel],
    contacts: [],
    config: null,
    notificationsSupported: true,
    notificationsEnabled: false,
    notificationsPermission: 'granted' as const,
    onTrace: noop,
    onPathDiscovery: vi.fn(async () => {
      throw new Error('unused');
    }) as (_: string) => Promise<PathDiscoveryResponse>,
    onToggleNotifications: noop,
    onToggleFavorite: noop,
    onSetChannelFloodScopeOverride: noop,
    onDeleteChannel: noop,
    onDeleteContact: noop,
    ...overrides,
  } as ChatHeaderProps;
}

function makeContact(type: number): Contact {
  return {
    public_key: CONTACT_KEY,
    name: 'Alice',
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: true,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

const contactConversation: Conversation = {
  type: 'contact',
  id: CONTACT_KEY,
  name: 'Alice',
};

/**
 * A complete, valid ChatHeader props object for a contact (DM) conversation,
 * mirroring makeChannelChatHeaderProps. `contactType` selects a plain client
 * (default) or a room-server contact (CONTACT_TYPE_ROOM). Spread overrides last.
 */
export function makeContactChatHeaderProps(
  overrides: Partial<ChatHeaderProps> = {},
  contactType: number = 1
): ChatHeaderProps {
  return {
    conversation: contactConversation,
    channels: [],
    contacts: [makeContact(contactType)],
    config: null,
    notificationsSupported: true,
    notificationsEnabled: false,
    notificationsPermission: 'granted' as const,
    onTrace: noop,
    onPathDiscovery: vi.fn(async () => {
      throw new Error('unused');
    }) as (_: string) => Promise<PathDiscoveryResponse>,
    onToggleNotifications: noop,
    onToggleFavorite: noop,
    onSetChannelFloodScopeOverride: noop,
    onDeleteChannel: noop,
    onDeleteContact: noop,
    ...overrides,
  } as ChatHeaderProps;
}

export { CONTACT_TYPE_ROOM };
