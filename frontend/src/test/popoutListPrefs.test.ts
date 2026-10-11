import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_POPOUT_LIST_PREFS,
  getSavedPopoutListPrefs,
  POPOUT_LIST_PREFS_KEY,
  savePopoutListPrefs,
  watchPopoutListPrefs,
} from '../popout/popoutListPrefs';

describe('popout list preferences', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to the orders the list always had, nothing folded or filtered', () => {
    expect(getSavedPopoutListPrefs()).toEqual({
      sort: { channels: 'alpha', direct: 'recent', rooms: 'recent' },
      collapsed: { channels: false, direct: false, rooms: false },
      favoritesOnly: false,
      unreadOnly: false,
      hideMuted: false,
      senderSort: 'alpha',
      sendersCollapsed: false,
    });
  });

  it('remembers a change', () => {
    const next = {
      ...DEFAULT_POPOUT_LIST_PREFS,
      sort: { channels: 'unread', direct: 'nearest', rooms: 'alpha-desc' },
      collapsed: { channels: false, direct: true, rooms: false },
      favoritesOnly: true,
      senderSort: 'messages',
      sendersCollapsed: true,
    } as const;
    savePopoutListPrefs(next);
    expect(getSavedPopoutListPrefs()).toEqual(next);
  });

  it('falls back per field on junk and on an order the section does not offer', () => {
    localStorage.setItem(
      POPOUT_LIST_PREFS_KEY,
      JSON.stringify({
        sort: { channels: 'nearest', direct: 'sideways', rooms: 'oldest' },
        collapsed: { channels: 'yes', rooms: true },
        favoritesOnly: 1,
        unreadOnly: true,
        senderSort: 'unread',
      })
    );
    expect(getSavedPopoutListPrefs()).toEqual({
      ...DEFAULT_POPOUT_LIST_PREFS,
      sort: { channels: 'alpha', direct: 'recent', rooms: 'oldest' },
      collapsed: { channels: false, direct: false, rooms: true },
      unreadOnly: true,
    });

    localStorage.setItem(POPOUT_LIST_PREFS_KEY, '{not json');
    expect(getSavedPopoutListPrefs()).toEqual(DEFAULT_POPOUT_LIST_PREFS);
  });

  it('adopts a change made in another popup until it is stopped', () => {
    const onChange = vi.fn();
    const stop = watchPopoutListPrefs(onChange);

    const next = { ...DEFAULT_POPOUT_LIST_PREFS, hideMuted: true };
    savePopoutListPrefs(next);
    window.dispatchEvent(new StorageEvent('storage', { key: POPOUT_LIST_PREFS_KEY }));
    expect(onChange).toHaveBeenCalledWith(next);

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: POPOUT_LIST_PREFS_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
