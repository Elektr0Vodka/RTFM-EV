import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { ChatHeader } from '../../components/ChatHeader';
import type { Channel, Conversation, PathDiscoveryResponse } from '../../types';

const CHANNEL_KEY = 'AA'.repeat(16);

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
