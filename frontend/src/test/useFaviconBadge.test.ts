import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildBadgedFaviconSvg,
  buildBrandIconSvg,
  deriveFaviconBadgeState,
  getFavoriteUnreadCount,
  getUnreadTitle,
  getTotalUnreadCount,
  useFaviconBadge,
  useUnreadTitle,
} from '../hooks/useFaviconBadge';
import type { Channel, Contact } from '../types';
import { getStateKey } from '../utils/conversationState';

function makeChannel(key: string, favorite = false): Channel {
  return {
    key,
    name: key,
    is_hashtag: false,
    on_radio: false,
    last_read_at: null,
    favorite,
    muted: false,
  };
}

function makeContact(publicKey: string, favorite = false): Contact {
  return {
    public_key: publicKey,
    name: publicKey,
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

function getIconHref(rel: 'icon' | 'shortcut icon'): string | null {
  return (
    document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.getAttribute('href') ?? null
  );
}

describe('useFaviconBadge', () => {
  const baseSvg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1000"/></svg>';
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let objectUrlCounter = 0;
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="shortcut icon" href="/favicon.ico" />
    `;
    document.title = 'RTFM-EV';
    objectUrlCounter = 0;
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => baseSvg,
    });
    createObjectURLMock = vi.fn(() => `blob:generated-${++objectUrlCounter}`);
    revokeObjectURLMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });

  it('derives badge priority from unread counts, mentions, and favorites', () => {
    const channels = [makeChannel('fav-chan', true)];

    expect(deriveFaviconBadgeState({}, {}, channels)).toBe('none');
    expect(
      deriveFaviconBadgeState(
        {
          [getStateKey('channel', 'fav-chan')]: 3,
        },
        {},
        channels
      )
    ).toBe('green');
    expect(
      deriveFaviconBadgeState(
        {
          [getStateKey('contact', 'abc')]: 12,
        },
        {},
        channels
      )
    ).toBe('red');
    expect(
      deriveFaviconBadgeState(
        {
          [getStateKey('channel', 'fav-chan')]: 1,
        },
        {
          [getStateKey('channel', 'fav-chan')]: true,
        },
        channels
      )
    ).toBe('red');
  });

  it('builds a dot-only badge into the base svg markup', () => {
    const svg = buildBadgedFaviconSvg(baseSvg, '#16a34a');

    expect(svg).toContain('<circle cx="750" cy="750" r="220" fill="#ffffff"/>');
    expect(svg).toContain('<circle cx="750" cy="750" r="180" fill="#16a34a"/>');
    expect(svg).not.toContain('<text');
  });

  it('derives the unread count and page title', () => {
    expect(getTotalUnreadCount({})).toBe(0);
    expect(getTotalUnreadCount({ a: 2, b: 5 })).toBe(7);
    expect(getFavoriteUnreadCount({}, [], [])).toBe(0);
    expect(
      getFavoriteUnreadCount(
        {
          [getStateKey('channel', 'fav-chan')]: 7,
          [getStateKey('contact', 'fav-contact')]: 3,
          [getStateKey('channel', 'other-chan')]: 9,
        },
        [makeContact('fav-contact', true)],
        [makeChannel('fav-chan', true)]
      )
    ).toBe(10);
    expect(getUnreadTitle({}, [], [])).toBe('RTFM-EV');
    expect(
      getUnreadTitle(
        {
          [getStateKey('channel', 'fav-chan')]: 7,
          [getStateKey('channel', 'other-chan')]: 9,
        },
        [],
        [makeChannel('fav-chan', true)]
      )
    ).toBe('(7) RTFM-EV');
    expect(
      getUnreadTitle(
        {
          [getStateKey('channel', 'fav-chan')]: 120,
        },
        [],
        [makeChannel('fav-chan', true)]
      )
    ).toBe('(99+) RTFM-EV');
  });

  it('switches between the base favicon and generated blob badges', async () => {
    const channels = [makeChannel('fav-chan', true)];
    const { rerender } = renderHook(
      ({
        unreadCounts,
        mentions,
        currentChannels,
      }: {
        unreadCounts: Record<string, number>;
        mentions: Record<string, boolean>;
        currentChannels: Channel[];
      }) => useFaviconBadge(unreadCounts, mentions, currentChannels),
      {
        initialProps: {
          unreadCounts: {},
          mentions: {},
          currentChannels: channels,
        },
      }
    );

    await waitFor(() => {
      expect(getIconHref('icon')).toBe('./favicon.svg');
      expect(getIconHref('shortcut icon')).toBe('./favicon.svg');
    });

    rerender({
      unreadCounts: {
        [getStateKey('channel', 'fav-chan')]: 1,
      },
      mentions: {},
      currentChannels: channels,
    });

    await waitFor(() => {
      expect(getIconHref('icon')).toBe('blob:generated-1');
      expect(getIconHref('shortcut icon')).toBe('blob:generated-1');
    });

    rerender({
      unreadCounts: {
        [getStateKey('contact', 'dm-key')]: 12,
      },
      mentions: {},
      currentChannels: channels,
    });

    await waitFor(() => {
      expect(getIconHref('icon')).toBe('blob:generated-2');
      expect(getIconHref('shortcut icon')).toBe('blob:generated-2');
    });

    rerender({
      unreadCounts: {},
      mentions: {},
      currentChannels: channels,
    });

    await waitFor(() => {
      expect(getIconHref('icon')).toBe('./favicon.svg');
      expect(getIconHref('shortcut icon')).toBe('./favicon.svg');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:generated-1');
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:generated-2');
  });

  it('writes unread counts into the page title', () => {
    const channels = [makeChannel('fav-chan', true)];
    const { rerender, unmount } = renderHook(
      ({
        unreadCounts,
        contacts,
        currentChannels,
      }: {
        unreadCounts: Record<string, number>;
        contacts: Contact[];
        currentChannels: Channel[];
      }) => useUnreadTitle(unreadCounts, contacts, currentChannels),
      {
        initialProps: {
          unreadCounts: {},
          contacts: [],
          currentChannels: channels,
        },
      }
    );

    expect(document.title).toBe('RTFM-EV');

    rerender({
      unreadCounts: {
        [getStateKey('channel', 'fav-chan')]: 4,
        [getStateKey('contact', 'dm-key')]: 2,
      },
      contacts: [],
      currentChannels: channels,
    });

    expect(document.title).toBe('(4) RTFM-EV');

    unmount();

    expect(document.title).toBe('RTFM-EV');
  });
  it('uses the custom brand name in the page title', () => {
    const channels = [makeChannel('fav-chan', true)];
    expect(getUnreadTitle({}, [], channels, 'My Mesh')).toBe('My Mesh');
    expect(getUnreadTitle({}, [], channels, '   ')).toBe('RTFM-EV');
    expect(
      getUnreadTitle({ [getStateKey('channel', 'fav-chan')]: 3 }, [], channels, 'My Mesh')
    ).toBe('(3) My Mesh');

    const { rerender } = renderHook(
      ({ brandName }: { brandName?: string }) => useUnreadTitle({}, [], channels, brandName),
      { initialProps: { brandName: 'My Mesh' } as { brandName?: string } }
    );
    expect(document.title).toBe('My Mesh');

    rerender({ brandName: undefined });
    expect(document.title).toBe('RTFM-EV');
  });

  it('wraps a brand icon data URL in an escaped svg image', () => {
    const svg = buildBrandIconSvg('data:image/svg+xml;utf8,<svg a="b&c"></svg>');
    expect(svg).toContain(
      'href="data:image/svg+xml;utf8,&lt;svg a=&quot;b&amp;c&quot;&gt;&lt;/svg&gt;"'
    );
    expect(svg).toContain('viewBox="0 0 1000 1000"');
  });

  it('uses the custom brand icon as the favicon and badges it', async () => {
    const brandIcon = 'data:image/png;base64,AAAA';
    const channels = [makeChannel('fav-chan', true)];
    const { rerender } = renderHook(
      ({ unreadCounts }: { unreadCounts: Record<string, number> }) =>
        useFaviconBadge(unreadCounts, {}, channels, brandIcon),
      { initialProps: { unreadCounts: {} as Record<string, number> } }
    );

    await waitFor(() => {
      expect(getIconHref('icon')).toBe(brandIcon);
      expect(getIconHref('shortcut icon')).toBe(brandIcon);
    });
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.type).toBe(
      'image/png'
    );

    rerender({ unreadCounts: { [getStateKey('channel', 'fav-chan')]: 1 } });

    await waitFor(() => {
      expect(getIconHref('icon')).toBe('blob:generated-1');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toContain(`href="${brandIcon}"`);
    expect(text).toContain('fill="#16a34a"');
  });
});
