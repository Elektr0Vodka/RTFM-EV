import { describe, it, expect } from 'vitest';
import type { EmojiData } from 'frimousse';

import {
  mergeCountryFlags,
  stripRedundantEmojiVariationSelectors,
  type EmojibaseEntry,
} from '../utils/emojiData';

const SKIN_TONES: EmojiData['skinTones'] = {
  light: '🏻',
  'medium-light': '🏼',
  medium: '🏽',
  'medium-dark': '🏾',
  dark: '🏿',
};

const RAW: EmojibaseEntry[] = [
  { emoji: '😀', label: 'grinning face', group: 0, version: 1, tags: ['face'] },
  { emoji: '🏁', label: 'chequered flag', group: 9, version: 0.6, tags: ['flag'] },
  { emoji: '🇳🇱', label: 'flag: Netherlands', group: 9, version: 2, tags: ['NL', 'flag'] },
  { emoji: '🇩🇪', label: 'flag: Germany', group: 9, version: 1, tags: ['DE', 'flag'] },
  { emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', label: 'flag: Scotland', group: 9, version: 5, tags: ['flag'] },
];

function filtered(): EmojiData {
  // What frimousse returns when its canvas check says "no country flags".
  return {
    locale: 'en',
    categories: [
      { index: 0, label: 'Smileys & emotion' },
      { index: 9, label: 'Flags' },
    ],
    skinTones: SKIN_TONES,
    emojis: [
      { emoji: '😀', category: 0, label: 'Grinning face', version: 1, tags: ['face'] },
      { emoji: '🏁', category: 9, label: 'Chequered flag', version: 0.6, tags: ['flag'] },
      { emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', category: 9, label: 'Flag: Scotland', version: 5, tags: ['flag'] },
    ],
  };
}

describe('mergeCountryFlags', () => {
  it('re-inserts country flags in Emojibase order with frimousse-style labels', () => {
    const merged = mergeCountryFlags(filtered(), RAW);
    expect(merged.emojis.map((e) => e.emoji)).toEqual(['😀', '🏁', '🇳🇱', '🇩🇪', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']);
    expect(merged.emojis[2]).toEqual({
      emoji: '🇳🇱',
      category: 9,
      label: 'Flag: Netherlands',
      version: 2,
      tags: ['NL', 'flag'],
      countryFlag: true,
    });
  });

  it('does not re-add non-flag emojis that frimousse filtered out', () => {
    const raw = [...RAW, { emoji: '🫨', label: 'shaking face', group: 0, version: 15 }];
    const merged = mergeCountryFlags(filtered(), raw);
    expect(merged.emojis.some((e) => e.emoji === '🫨')).toBe(false);
  });

  it('returns the data unchanged when flags are already present', () => {
    const data = mergeCountryFlags(filtered(), RAW);
    expect(mergeCountryFlags(data, RAW)).toBe(data);
  });
});

describe('stripRedundantEmojiVariationSelectors', () => {
  const vs16 = (s: string) => s.includes('\uFE0F');

  it('drops U+FE0F after characters that already default to emoji style', () => {
    const data = filtered();
    data.emojis = [
      { emoji: '👍\uFE0F', category: 1, label: 'Thumbs up', version: 0.6, tags: [] },
      { emoji: '⛳\uFE0F', category: 5, label: 'Flag in hole', version: 0.6, tags: [] },
    ];
    const out = stripRedundantEmojiVariationSelectors(data);
    expect(out.emojis.map((e) => e.emoji)).toEqual(['👍', '⛳']);
    expect(new TextEncoder().encode(out.emojis[0].emoji).length).toBe(4);
  });

  it('keeps U+FE0F where it is needed for emoji style or part of a sequence', () => {
    const data = filtered();
    data.emojis = [
      // U+2764 defaults to text style; without FE0F it may render as a glyph.
      { emoji: '❤\uFE0F', category: 0, label: 'Red heart', version: 0.6, tags: [] },
      // Keycap and ZWJ sequences must stay intact.
      { emoji: '1\uFE0F\u20E3', category: 7, label: 'Keycap: 1', version: 0.6, tags: [] },
      { emoji: '🏳\uFE0F\u200D🌈', category: 9, label: 'Rainbow flag', version: 4, tags: [] },
    ];
    const out = stripRedundantEmojiVariationSelectors(data);
    expect(out.emojis.every((e) => vs16(e.emoji))).toBe(true);
  });
});
