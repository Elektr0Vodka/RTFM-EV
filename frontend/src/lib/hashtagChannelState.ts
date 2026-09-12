// Pure classification of #hashtag channel references seen in chat, used by
// MessageList to style them and decide whether to offer capture. Kept out of
// the component so it is unit-testable.

export type HashtagState = 'followed' | 'known' | 'unknown';

function normalise(name: string): string {
  const n = name.trim().toLowerCase();
  return n.startsWith('#') ? n : `#${n}`;
}

/** Build a lookup set of channel names, each lowercased and '#'-prefixed. */
export function buildNameSet(names: string[]): Set<string> {
  return new Set(names.map(normalise));
}

/**
 * followed  = present in the app's followed radio channel list
 * known     = present only in the Channel Registry
 * unknown   = present in neither (a capture candidate)
 */
export function classifyHashtag(
  label: string,
  followedNames: Set<string>,
  registryNames: Set<string>
): HashtagState {
  const key = normalise(label);
  if (followedNames.has(key)) return 'followed';
  if (registryNames.has(key)) return 'known';
  return 'unknown';
}
