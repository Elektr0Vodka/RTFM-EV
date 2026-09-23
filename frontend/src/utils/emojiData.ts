import {
  defaultEmojiDataResolver,
  type EmojiData,
  type EmojiDataResolver,
  type EmojiDetails,
} from 'frimousse';

import { isCountryFlagFontActive } from './countryFlagFont';

/**
 * Self-hosted Emojibase data (see the emojibase-data plugin in vite.config.ts).
 * Relative, like the app's other static assets, so sub-path deployments work.
 */
export const EMOJIBASE_URL = './emojibase-data';

const COUNTRY_FLAG_RE = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;

/** The subset of an Emojibase `data.json` entry that is needed here. */
export interface EmojibaseEntry {
  emoji: string;
  label: string;
  group?: number;
  version: number;
  tags?: string[];
}

/**
 * Re-insert the country flags that frimousse filtered out, keeping Emojibase
 * order. frimousse detects flag support with its own font stack, which does not
 * include the app's "Twemoji Country Flags" polyfill font, so on Windows it
 * drops every country flag even though the app can render them.
 */
export function mergeCountryFlags(data: EmojiData, raw: EmojibaseEntry[]): EmojiData {
  if (data.emojis.some((e) => e.countryFlag)) return data;
  const byEmoji = new Map(data.emojis.map((e) => [e.emoji, e]));
  const emojis = raw.flatMap((entry): EmojiDetails[] => {
    const existing = byEmoji.get(entry.emoji);
    if (existing) return [existing];
    if (entry.group === undefined || !COUNTRY_FLAG_RE.test(entry.emoji)) return [];
    return [
      {
        emoji: entry.emoji,
        category: entry.group,
        label: entry.label.charAt(0).toUpperCase() + entry.label.slice(1),
        version: entry.version,
        tags: entry.tags ?? [],
        countryFlag: true,
      },
    ];
  });
  return { ...data, emojis };
}

// A single character that already defaults to emoji style, followed by U+FE0F.
const REDUNDANT_VS16_RE = /^(\p{Emoji_Presentation})\uFE0F$/u;

/**
 * Emojibase spells ~500 emojis with a trailing U+FE0F (e.g. 👍 as U+1F44D U+FE0F).
 * For characters that already render as emoji by default the selector is
 * redundant but costs 3 of the ~150 bytes a LoRa message allows, so drop it.
 * It is kept where it matters: text-default characters like ❤ (U+2764) and
 * keycap/ZWJ sequences.
 */
export function stripRedundantEmojiVariationSelectors(data: EmojiData): EmojiData {
  const strip = (emoji: string) => emoji.replace(REDUNDANT_VS16_RE, '$1');
  return {
    ...data,
    emojis: data.emojis.map((e) =>
      REDUNDANT_VS16_RE.test(e.emoji) ? { ...e, emoji: strip(e.emoji) } : e
    ),
  };
}

/** frimousse's default resolver, plus country flags when the flag font polyfill is active. */
const resolveWithFlags: EmojiDataResolver = async (locale, options) => {
  const data = await defaultEmojiDataResolver(locale, options);
  if (!isCountryFlagFontActive() || data.emojis.some((e) => e.countryFlag)) return data;
  try {
    const res = await fetch(`${options.emojibaseUrl ?? EMOJIBASE_URL}/${data.locale}/data.json`, {
      signal: options.signal,
    });
    if (!res.ok) return data;
    return mergeCountryFlags(data, (await res.json()) as EmojibaseEntry[]);
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return data;
  }
};

/**
 * The resolver the picker uses: frimousse's default data, plus country flags
 * (see resolveWithFlags), minus redundant U+FE0F variation selectors.
 */
export const resolveEmojiData: EmojiDataResolver = async (locale, options) =>
  stripRedundantEmojiVariationSelectors(await resolveWithFlags(locale, options));
