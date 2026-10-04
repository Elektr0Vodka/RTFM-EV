import { describe, expect, it } from 'vitest';

import { buildPopoutSections, recentSenders } from '../popout/popoutLists';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  type Channel,
  type Contact,
  type Message,
} from '../types';
import { getStateKey } from '../utils/conversationState';

const PUBLIC_KEY = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';

function channel(key: string, name: string, extra: Partial<Channel> = {}): Channel {
  return {
    key,
    name,
    is_hashtag: name.startsWith('#'),
    on_radio: false,
    last_read_at: null,
    favorite: false,
    muted: false,
    ...extra,
  };
}

function contact(prefix: string, name: string, extra: Partial<Contact> = {}): Contact {
  return {
    public_key: prefix.repeat(32),
    name,
    type: CONTACT_TYPE_CLIENT,
    favorite: false,
    ...extra,
  } as Contact;
}

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'C1',
    text: 'Alice: hi',
    sender_timestamp: 1,
    received_at: 1,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    ...overrides,
  } as Message;
}

const base = {
  lastMessageTimes: {},
  unreadCounts: {},
  mentions: {},
  activeConversation: null,
};

describe('buildPopoutSections', () => {
  it('orders channels Public first, muted last, the rest A-Z', () => {
    const sections = buildPopoutSections({
      ...base,
      channels: [
        channel('K3', '#zulu'),
        channel('K2', '#alpha', { muted: true }),
        channel(PUBLIC_KEY, 'Public'),
        channel('K1', '#bravo'),
        channel('K1', '#bravo'),
      ],
      contacts: [],
    });
    expect(sections.channels.map((entry) => entry.conversation.name)).toEqual([
      'Public',
      '#bravo',
      '#zulu',
      '#alpha',
    ]);
  });

  it('lists only contacts with something to show, never repeaters', () => {
    const talked = contact('aa', 'Talked');
    const unread = contact('bb', 'Unread');
    const favorite = contact('cc', 'Favorite', { favorite: true });
    const silent = contact('dd', 'Silent');
    const open = contact('ee', 'Open');
    const tower = contact('ff', 'Tower', { type: CONTACT_TYPE_REPEATER });
    const room = contact('11', 'Room NL', { type: CONTACT_TYPE_ROOM });

    const sections = buildPopoutSections({
      ...base,
      channels: [],
      contacts: [talked, unread, favorite, silent, open, tower, room],
      lastMessageTimes: {
        [getStateKey('contact', talked.public_key)]: 500,
        [getStateKey('contact', tower.public_key)]: 900,
      },
      unreadCounts: { [getStateKey('contact', unread.public_key)]: 2 },
      mentions: { [getStateKey('contact', unread.public_key)]: true },
      activeConversation: { type: 'contact', id: open.public_key, name: 'Open' },
    });

    expect(sections.direct.map((entry) => entry.conversation.name)).toEqual([
      'Unread',
      'Talked',
      'Favorite',
      'Open',
    ]);
    expect(sections.direct[0]).toMatchObject({ unread: 2, mention: true });
    expect(sections.rooms.map((entry) => entry.conversation.name)).toEqual(['Room NL']);
  });

  it('hides blocked contacts', () => {
    const blockedByKey = contact('aa', 'Key', { favorite: true });
    const blockedByName = contact('bb', 'Name', { favorite: true });
    const sections = buildPopoutSections({
      ...base,
      channels: [],
      contacts: [blockedByKey, blockedByName],
      blockedKeys: [blockedByKey.public_key],
      blockedNames: ['Name'],
    });
    expect(sections.direct).toEqual([]);
  });

  it('searches every channel and contact when filtering', () => {
    const silent = contact('dd', 'Silent Bob');
    const sections = buildPopoutSections({
      ...base,
      channels: [channel('K1', '#bravo'), channel('K2', '#bob-fans')],
      contacts: [silent, contact('ee', 'Other'), contact('ff', 'Bob Tower', { type: 2 })],
      query: ' BOB ',
    });
    expect(sections.channels.map((entry) => entry.conversation.name)).toEqual(['#bob-fans']);
    expect(sections.direct.map((entry) => entry.conversation.name)).toEqual(['Silent Bob']);
  });
});

describe('recentSenders', () => {
  it('lists unique channel senders A-Z and skips own messages', () => {
    const senders = recentSenders(
      [
        message({ id: 1, text: 'zed: one' }),
        message({ id: 2, text: 'Alice: two' }),
        message({ id: 3, text: 'zed: three' }),
        message({ id: 4, text: 'Me: four', outgoing: true }),
      ],
      []
    );
    expect(senders.map((sender) => sender.name)).toEqual(['Alice', 'zed']);
  });

  it('resolves the key contact info opens with', () => {
    const alice = contact('aa', 'Alice');
    const senders = recentSenders(
      [
        message({ id: 1, text: 'Alice: hi' }),
        message({ id: 2, text: 'Bob: hi', sender_name: 'Bob', sender_key: 'bb'.repeat(32) }),
        message({ id: 3, text: 'Carol: hi' }),
      ],
      [alice]
    );
    expect(senders).toEqual([
      { name: 'Alice', key: alice.public_key },
      { name: 'Bob', key: 'bb'.repeat(32) },
      { name: 'Carol', key: 'name:Carol' },
    ]);
  });

  it('uses the sender name of room posts and yields nothing for plain DMs', () => {
    expect(
      recentSenders([message({ type: 'PRIV', text: 'hello', sender_name: 'Dave' })], [])
    ).toEqual([{ name: 'Dave', key: 'name:Dave' }]);
    expect(recentSenders([message({ type: 'PRIV', text: 'a: b' })], [])).toEqual([]);
  });
});
