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
    lat: null,
    lon: null,
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

  describe('sorting', () => {
    const names = (entries: { conversation: { name: string } }[]) =>
      entries.map((entry) => entry.conversation.name);

    const sortChannels = (order: 'recent' | 'oldest' | 'alpha' | 'alpha-desc' | 'unread') =>
      names(
        buildPopoutSections({
          ...base,
          channels: [
            channel('K1', '#alpha'),
            channel('K2', '#bravo'),
            channel('K3', '#charlie'),
            channel('K4', '#muted', { muted: true }),
            channel('K5', '#delta'),
            channel(PUBLIC_KEY, 'Public'),
          ],
          contacts: [],
          lastMessageTimes: {
            [getStateKey('channel', 'K1')]: 200,
            [getStateKey('channel', 'K2')]: 300,
            [getStateKey('channel', 'K3')]: 100,
            [getStateKey('channel', 'K4')]: 900,
            [getStateKey('channel', PUBLIC_KEY)]: 1,
          },
          unreadCounts: {
            [getStateKey('channel', 'K1')]: 2,
            [getStateKey('channel', 'K3')]: 7,
            [getStateKey('channel', 'K4')]: 50,
          },
          sort: { channels: order },
        }).channels
      );

    it('keeps Public first and muted channels last in every channel order', () => {
      expect(sortChannels('alpha')).toEqual([
        'Public',
        '#alpha',
        '#bravo',
        '#charlie',
        '#delta',
        '#muted',
      ]);
      expect(sortChannels('alpha-desc')).toEqual([
        'Public',
        '#delta',
        '#charlie',
        '#bravo',
        '#alpha',
        '#muted',
      ]);
      expect(sortChannels('unread')).toEqual([
        'Public',
        '#charlie',
        '#alpha',
        '#bravo',
        '#delta',
        '#muted',
      ]);
    });

    it('sorts by newest activity with unread chats on top', () => {
      // #alpha and #charlie are unread; #bravo is read but spoke last.
      expect(sortChannels('recent')).toEqual([
        'Public',
        '#alpha',
        '#charlie',
        '#bravo',
        '#delta',
        '#muted',
      ]);
    });

    it('sorts by oldest activity and puts chats that never spoke last', () => {
      expect(sortChannels('oldest')).toEqual([
        'Public',
        '#charlie',
        '#alpha',
        '#bravo',
        '#delta',
        '#muted',
      ]);
    });

    const near = contact('aa', 'Near', { favorite: true, lat: 52.1, lon: 5 });
    const far = contact('bb', 'Far', { favorite: true, lat: 53, lon: 5 });
    const manual = contact('cc', 'Manual', { favorite: true, manual_lat: 52.5, manual_lon: 5 });
    const nowhere = contact('dd', 'Nowhere', { favorite: true });
    const adrift = contact('ee', 'Adrift', { favorite: true, lat: 0, lon: 0 });
    const origin = { lat: 52, lon: 5 };

    it('sorts contacts by distance from the radio, unknown locations last A-Z', () => {
      const args = {
        ...base,
        channels: [],
        contacts: [nowhere, far, adrift, manual, near],
        origin,
      };
      const nearest = buildPopoutSections({ ...args, sort: { direct: 'nearest' } }).direct;
      expect(names(nearest)).toEqual(['Near', 'Manual', 'Far', 'Adrift', 'Nowhere']);
      expect(nearest[0].distanceKm).toBeCloseTo(11.1, 0);
      expect(nearest[3].distanceKm).toBeNull();

      const farthest = buildPopoutSections({ ...args, sort: { direct: 'farthest' } }).direct;
      expect(names(farthest)).toEqual(['Far', 'Manual', 'Near', 'Adrift', 'Nowhere']);
    });

    it('falls back to A-Z for a distance order when the radio has no location', () => {
      const sections = buildPopoutSections({
        ...base,
        channels: [],
        contacts: [near, far, manual],
        origin: null,
        sort: { direct: 'nearest' },
      });
      expect(names(sections.direct)).toEqual(['Far', 'Manual', 'Near']);
      expect(sections.direct[0].distanceKm).toBeNull();
    });

    it('sorts each section by its own order', () => {
      const roomA = contact('11', 'Room A', { type: CONTACT_TYPE_ROOM });
      const roomB = contact('22', 'Room B', { type: CONTACT_TYPE_ROOM });
      const sections = buildPopoutSections({
        ...base,
        channels: [],
        contacts: [near, far, roomA, roomB],
        lastMessageTimes: {
          [getStateKey('contact', near.public_key)]: 10,
          [getStateKey('contact', far.public_key)]: 20,
        },
        unreadCounts: { [getStateKey('contact', far.public_key)]: 1 },
        sort: { direct: 'oldest', rooms: 'alpha-desc' },
      });
      // Oldest is plain time order: an unread chat does not jump the queue.
      expect(names(sections.direct)).toEqual(['Near', 'Far']);
      expect(names(sections.rooms)).toEqual(['Room B', 'Room A']);
    });
  });

  describe('toggles', () => {
    const names = (entries: { conversation: { name: string } }[]) =>
      entries.map((entry) => entry.conversation.name);
    const fav = contact('aa', 'Fav', { favorite: true });
    const chatty = contact('bb', 'Chatty');
    const favRoom = contact('11', 'Fav Room', { type: CONTACT_TYPE_ROOM, favorite: true });
    const room = contact('22', 'Room', { type: CONTACT_TYPE_ROOM });
    const args = {
      ...base,
      channels: [
        channel(PUBLIC_KEY, 'Public'),
        channel('K1', '#fav', { favorite: true }),
        channel('K2', '#quiet', { muted: true }),
        channel('K3', '#busy'),
      ],
      contacts: [fav, chatty, favRoom, room],
      lastMessageTimes: { [getStateKey('contact', chatty.public_key)]: 5 },
      unreadCounts: {
        [getStateKey('channel', 'K3')]: 4,
        [getStateKey('contact', chatty.public_key)]: 1,
      },
    };

    it('lists only favorites, plus the open chat', () => {
      const sections = buildPopoutSections({
        ...args,
        favoritesOnly: true,
        activeConversation: { type: 'channel', id: 'K3', name: '#busy' },
      });
      expect(names(sections.channels)).toEqual(['#busy', '#fav']);
      expect(names(sections.direct)).toEqual(['Fav']);
      expect(names(sections.rooms)).toEqual(['Fav Room']);
    });

    it('lists only unread chats, plus the open chat', () => {
      const sections = buildPopoutSections({
        ...args,
        unreadOnly: true,
        activeConversation: { type: 'contact', id: favRoom.public_key, name: 'Fav Room' },
      });
      expect(names(sections.channels)).toEqual(['#busy']);
      expect(names(sections.direct)).toEqual(['Chatty']);
      expect(names(sections.rooms)).toEqual(['Fav Room']);
    });

    it('hides muted channels unless one is open', () => {
      expect(names(buildPopoutSections({ ...args, hideMuted: true }).channels)).toEqual([
        'Public',
        '#busy',
        '#fav',
      ]);
      expect(
        names(
          buildPopoutSections({
            ...args,
            hideMuted: true,
            activeConversation: { type: 'channel', id: 'K2', name: '#quiet' },
          }).channels
        )
      ).toContain('#quiet');
    });

    it('applies the toggles to filter results too', () => {
      const sections = buildPopoutSections({
        ...args,
        contacts: [fav, chatty, contact('cc', 'Fav Lookalike')],
        favoritesOnly: true,
        query: 'fav',
      });
      expect(names(sections.channels)).toEqual(['#fav']);
      expect(names(sections.direct)).toEqual(['Fav']);
    });
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

  it('sorts senders Z-A, by who spoke last and by who spoke most', () => {
    const messages = [
      message({ id: 1, text: 'Alice: one', received_at: 10 }),
      message({ id: 2, text: 'Bob: two', received_at: 20 }),
      message({ id: 3, text: 'Carol: three', received_at: 30 }),
      message({ id: 4, text: 'Alice: four', received_at: 40 }),
      message({ id: 5, text: 'Bob: five', received_at: 25 }),
      message({ id: 6, text: 'Bob: six', received_at: 26 }),
    ];
    const sorted = (sort: 'alpha-desc' | 'recent' | 'messages') =>
      recentSenders(messages, [], { sort }).map((sender) => sender.name);

    expect(sorted('alpha-desc')).toEqual(['Carol', 'Bob', 'Alice']);
    expect(sorted('recent')).toEqual(['Alice', 'Carol', 'Bob']);
    expect(sorted('messages')).toEqual(['Bob', 'Alice', 'Carol']);
  });

  it('sorts senders by distance when they resolve to a located contact', () => {
    const near = contact('aa', 'Near', { lat: 52.1, lon: 5 });
    const far = contact('bb', 'Far', { lat: 53, lon: 5 });
    const messages = [
      message({ id: 1, text: 'Far: hi' }),
      message({ id: 2, text: 'Stranger: hi' }),
      message({ id: 3, text: 'x', sender_name: 'Near', sender_key: near.public_key.toUpperCase() }),
    ];
    const origin = { lat: 52, lon: 5 };

    const nearest = recentSenders(messages, [near, far], { sort: 'nearest', origin });
    expect(nearest.map((sender) => sender.name)).toEqual(['Near', 'Far', 'Stranger']);
    expect(nearest[0].distanceKm).toBeCloseTo(11.1, 0);
    expect(nearest[2].distanceKm).toBeUndefined();

    expect(
      recentSenders(messages, [near, far], { sort: 'farthest', origin }).map((s) => s.name)
    ).toEqual(['Far', 'Near', 'Stranger']);
    expect(
      recentSenders(messages, [near, far], { sort: 'nearest', origin: null }).map((s) => s.name)
    ).toEqual(['Far', 'Near', 'Stranger']);
  });
});
