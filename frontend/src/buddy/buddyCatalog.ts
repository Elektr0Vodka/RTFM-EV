import type { SettingsSection } from '../components/settings/settingsConstants';
import type { TFn } from '../i18n';
import type { Channel, Contact, Conversation } from '../types';
import { getContactDisplayName } from '../utils/pubkey';
import { BUDDY_ANCHORS, conversationAnchor } from './buddyAnchors';
import type { BuddyEvent } from './buddyEvents';
import { pageTipKey, type BuddyGroup } from './buddyLogic';
import type { BuddyMood } from './buddyMood';
import type { HeldBackCount } from './buddyQuiet';

/** What clicking the speech balloon opens. */
export type BuddyTarget =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'mention'; channelKey: string; messageId: number }
  /** The User Guide, opened at a section. */
  | { kind: 'manual'; section: string }
  /** The buddy's own list of what it said and kept back. */
  | { kind: 'recap' };

export type BuddyPage = Conversation['type'] | 'settings';

export type BuddyLineKind =
  | 'dm'
  | 'mention'
  | 'new-node'
  | 'radio-disconnected'
  | 'radio-connected'
  | 'radio-paused'
  | 'battery-own'
  | 'battery-node'
  | 'update-app'
  | 'update-openhop'
  | 'tip'
  | 'quiet-summary';

/** One thing the buddy can say, with how it says it. */
export interface BuddyLine {
  kind: BuddyLineKind;
  /** Settings switch this line falls under; null = always said. */
  group: BuddyGroup | null;
  /** Animation played before the line; null = none. */
  mood: BuddyMood | null;
  /** Element to gesture toward when it is on screen (see buddyAnchors). */
  anchor: string | null;
  text: string;
  target: BuddyTarget | null;
  /** How many things the line is about (3 for "3 new nodes"); for the quiet summary. */
  count: number;
}

/**
 * The table of line kinds: which switch a kind belongs to and its mood. A new
 * kind needs a row here, a builder below and something that triggers it.
 */
const LINE_KINDS: Record<BuddyLineKind, { group: BuddyGroup | null; mood: BuddyMood | null }> = {
  dm: { group: 'messages', mood: 'attention' },
  mention: { group: 'messages', mood: 'attention' },
  'new-node': { group: 'nodes', mood: 'happy' },
  'radio-disconnected': { group: 'radio', mood: 'alert' },
  'radio-connected': { group: 'radio', mood: 'happy' },
  'radio-paused': { group: 'radio', mood: null },
  'battery-own': { group: 'batteries', mood: 'alert' },
  'battery-node': { group: 'batteries', mood: 'alert' },
  'update-app': { group: 'updates', mood: 'info' },
  'update-openhop': { group: 'updates', mood: 'info' },
  tip: { group: 'tips', mood: 'explain' },
  'quiet-summary': { group: null, mood: null },
};

function line(
  kind: BuddyLineKind,
  text: string,
  target: BuddyTarget | null,
  anchor: string | null = null,
  count = 1
): BuddyLine {
  return { kind, ...LINE_KINDS[kind], anchor, text, target, count };
}

function contactName(contacts: Contact[], publicKey: string, fallback?: string | null): string {
  const contact = contacts.find((c) => c.public_key === publicKey);
  if (contact) return getContactDisplayName(contact.name, contact.public_key, contact.last_advert);
  return fallback || publicKey.slice(0, 12);
}

function contactInfoTarget(contacts: Contact[], publicKey: string, name?: string | null) {
  return {
    kind: 'conversation',
    conversation: {
      type: 'contact-info',
      id: publicKey,
      name: contactName(contacts, publicKey, name),
    },
  } satisfies BuddyTarget;
}

function meshHealthTarget(t: TFn) {
  return {
    kind: 'conversation',
    conversation: { type: 'mesh-health', id: 'mesh-health', name: t('nav_mesh_health') },
  } satisfies BuddyTarget;
}

/** The line for an app event, or null when there is nothing to say. */
export function describeBuddyEvent(
  event: BuddyEvent,
  t: TFn,
  contacts: Contact[],
  channels: Channel[]
): BuddyLine | null {
  switch (event.kind) {
    case 'new-node': {
      if (event.count === 1 && event.publicKey) {
        const name = contactName(contacts, event.publicKey, event.name);
        return line(
          'new-node',
          t('buddy_new_node', { name }),
          contactInfoTarget(contacts, event.publicKey, event.name)
        );
      }
      if (event.count < 1) return null;
      return line(
        'new-node',
        t('buddy_new_nodes', { count: event.count }),
        meshHealthTarget(t),
        null,
        event.count
      );
    }
    case 'radio':
      if (event.state === 'connected') {
        return line('radio-connected', t('buddy_radio_connected'), null, BUDDY_ANCHORS.radio);
      }
      if (event.state === 'paused') {
        return line('radio-paused', t('buddy_radio_paused'), null, BUDDY_ANCHORS.radio);
      }
      return line(
        'radio-disconnected',
        t('buddy_radio_disconnected'),
        { kind: 'settings', section: 'radio' },
        BUDDY_ANCHORS.radio
      );
    case 'dm': {
      const name = contactName(contacts, event.publicKey, event.senderName);
      return line(
        'dm',
        t('buddy_dm', { name }),
        { kind: 'conversation', conversation: { type: 'contact', id: event.publicKey, name } },
        conversationAnchor('contact', event.publicKey)
      );
    }
    case 'mention': {
      const channel = channels.find((c) => c.key === event.channelKey);
      return line(
        'mention',
        t('buddy_mention', {
          name: event.senderName || '?',
          channel: channel?.name ?? event.channelKey.slice(0, 8),
        }),
        { kind: 'mention', channelKey: event.channelKey, messageId: event.messageId },
        conversationAnchor('channel', event.channelKey)
      );
    }
  }
}

export function batteryOwnLine(t: TFn, pct: number): BuddyLine {
  return line(
    'battery-own',
    t('buddy_battery_own', { pct }),
    { kind: 'conversation', conversation: { type: 'node', id: 'node', name: t('nav_my_node') } },
    BUDDY_ANCHORS.battery
  );
}

/** One line for the nodes that just dropped below the threshold; null for none. */
export function batteryNodesLine(
  t: TFn,
  contacts: Contact[],
  low: { publicKey: string; pct: number }[]
): BuddyLine | null {
  if (low.length === 0) return null;
  if (low.length === 1) {
    const [node] = low;
    const name = contactName(contacts, node.publicKey);
    return line(
      'battery-node',
      t('buddy_battery_node', { name, pct: node.pct }),
      contactInfoTarget(contacts, node.publicKey, name)
    );
  }
  return line(
    'battery-node',
    t('buddy_battery_nodes', {
      count: low.length,
      names: low
        .slice(0, 3)
        .map((node) => contactName(contacts, node.publicKey))
        .join(', '),
    }),
    meshHealthTarget(t),
    null,
    low.length
  );
}

export function updateAppLine(t: TFn, commitsBehind: number): BuddyLine {
  return line(
    'update-app',
    t('buddy_update_app', { count: commitsBehind }),
    { kind: 'settings', section: 'about' },
    BUDDY_ANCHORS.update
  );
}

export function updateOpenHopLine(t: TFn, version: string): BuddyLine {
  return line('update-openhop', t('buddy_update_openhop', { version }), {
    kind: 'settings',
    section: 'openhop',
  });
}

/** The tip for a page, or null when the page has none. */
export function tipLine(t: TFn, page: BuddyPage | null): BuddyLine | null {
  const key = pageTipKey(page);
  return key ? line('tip', t(key), null) : null;
}

/** Page tips are never kept back, so they have no part in the summary. */
const QUIET_PART_KEYS: Partial<Record<BuddyGroup, string>> = {
  messages: 'buddy_quiet_part_messages',
  nodes: 'buddy_quiet_part_nodes',
  radio: 'buddy_quiet_part_radio',
  batteries: 'buddy_quiet_part_batteries',
  updates: 'buddy_quiet_part_updates',
};

/** Said once when a quiet period ends: what was kept back, counted per group. */
export function quietSummaryLine(t: TFn, summary: HeldBackCount[]): BuddyLine {
  const items = summary
    .map(({ group, count }) => {
      const key = QUIET_PART_KEYS[group];
      return key ? t(key, { count }) : null;
    })
    .filter((item): item is string => item !== null)
    .join(', ');
  return line('quiet-summary', t('buddy_quiet_summary', { items }), { kind: 'recap' });
}
