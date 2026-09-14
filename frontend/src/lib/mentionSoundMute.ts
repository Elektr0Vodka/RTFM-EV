// Per-conversation "mute the mention sound" flags, kept per-device in
// localStorage - the override half of the global mention-sound setting.
import { getStateKey } from '../utils/conversationState';

const STORAGE_KEY = 'meshcore_mention_sound_muted_by_conversation';

type MutedMap = Record<string, true>;

function read(): MutedMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([k, v]) => typeof k === 'string' && v === true)
    ) as MutedMap;
  } catch {
    return {};
  }
}

function write(map: MutedMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

export function isConversationSoundMuted(type: 'channel' | 'contact', id: string): boolean {
  return read()[getStateKey(type, id)] === true;
}

/** Toggle and persist. Returns the new muted state. */
export function toggleConversationSoundMuted(type: 'channel' | 'contact', id: string): boolean {
  const key = getStateKey(type, id);
  const map = read();
  let nowMuted: boolean;
  if (map[key]) {
    delete map[key];
    nowMuted = false;
  } else {
    map[key] = true;
    nowMuted = true;
  }
  write(map);
  return nowMuted;
}
