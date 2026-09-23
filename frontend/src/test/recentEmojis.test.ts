import { describe, it, expect, beforeEach } from 'vitest';

import {
  MAX_RECENT_EMOJIS,
  addRecentEmoji,
  getEmojiSkinTone,
  getRecentEmojis,
  setEmojiSkinTone,
} from '../utils/recentEmojis';

describe('recentEmojis', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty list when nothing is stored', () => {
    expect(getRecentEmojis()).toEqual([]);
  });

  it('puts the newest emoji first and de-duplicates', () => {
    addRecentEmoji('👍');
    addRecentEmoji('🔥');
    const next = addRecentEmoji('👍');
    expect(next).toEqual(['👍', '🔥']);
    expect(getRecentEmojis()).toEqual(['👍', '🔥']);
  });

  it('keeps skin-toned variants as distinct entries', () => {
    addRecentEmoji('👍');
    addRecentEmoji('👍🏽');
    expect(getRecentEmojis()).toEqual(['👍🏽', '👍']);
  });

  it(`caps the list at ${MAX_RECENT_EMOJIS} entries`, () => {
    for (let i = 0; i < MAX_RECENT_EMOJIS + 5; i++)
      addRecentEmoji(String.fromCodePoint(0x1f600 + i));
    const recent = getRecentEmojis();
    expect(recent).toHaveLength(MAX_RECENT_EMOJIS);
    expect(recent[0]).toBe(String.fromCodePoint(0x1f600 + MAX_RECENT_EMOJIS + 4));
  });

  it('ignores corrupt or non-string stored data', () => {
    localStorage.setItem('remoteterm-recent-emojis', '{not json');
    expect(getRecentEmojis()).toEqual([]);
    localStorage.setItem('remoteterm-recent-emojis', JSON.stringify(['😀', 42, null, '']));
    expect(getRecentEmojis()).toEqual(['😀']);
  });

  it('persists the skin tone and rejects unknown values', () => {
    expect(getEmojiSkinTone()).toBe('none');
    setEmojiSkinTone('medium-dark');
    expect(getEmojiSkinTone()).toBe('medium-dark');
    localStorage.setItem('remoteterm-emoji-skin-tone', 'purple');
    expect(getEmojiSkinTone()).toBe('none');
  });
});
