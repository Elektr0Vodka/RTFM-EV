import type { SkinTone } from 'frimousse';

// Per-browser emoji picker preferences: the recently used emojis (newest first)
// and the chosen default skin tone.
const RECENT_KEY = 'remoteterm-recent-emojis';
const SKIN_TONE_KEY = 'remoteterm-emoji-skin-tone';

export const MAX_RECENT_EMOJIS = 16;

const SKIN_TONES: readonly SkinTone[] = [
  'none',
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
];

export function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is string => typeof e === 'string' && e.length > 0)
      .slice(0, MAX_RECENT_EMOJIS);
  } catch {
    return [];
  }
}

/** Move (or add) an emoji to the front of the recent list and return the new list. */
export function addRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable
  }
  return next;
}

export function getEmojiSkinTone(): SkinTone {
  try {
    const raw = localStorage.getItem(SKIN_TONE_KEY);
    return SKIN_TONES.find((tone) => tone === raw) ?? 'none';
  } catch {
    return 'none';
  }
}

export function setEmojiSkinTone(tone: SkinTone): void {
  try {
    localStorage.setItem(SKIN_TONE_KEY, tone);
  } catch {
    // localStorage may be unavailable
  }
}
