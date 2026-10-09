/** How the buddy feels about a line; picks the animation played before it. */
export type BuddyMood = 'attention' | 'happy' | 'alert' | 'info' | 'explain';

/**
 * Animation names per mood, best first. Characters differ in what they have
 * (Clippy has no Announce, Courtney no Alert, Gourdy none of these), so the
 * first name the character knows is played.
 */
const MOOD_ANIMATIONS: Record<BuddyMood, readonly string[]> = {
  attention: ['GetAttention', 'Wave', 'Alert'],
  happy: ['Congratulate', 'Pleased', 'Wave'],
  alert: ['Alert', 'GetAttention', 'Surprised'],
  info: ['Announce', 'Explain', 'GetAttention'],
  explain: ['Explain', 'Thinking'],
};

/** The animation to play for this mood, or null when the character has none. */
export function pickAnimation(
  has: (name: string) => boolean,
  mood: BuddyMood | null
): string | null {
  if (!mood) return null;
  return MOOD_ANIMATIONS[mood].find((name) => has(name)) ?? null;
}
