import { getEffectiveTheme } from '../utils/theme';
import { isBuddyAgentId, type BuddyAgentId } from './agents';

/**
 * Per-browser desktop-buddy preferences (localStorage, like the theme).
 *
 * The buddy belongs to the Windows 95 theme: there it is always available and
 * Clippy is on until the user picks another buddy or Off. Other themes only
 * offer it once this browser has used Windows 95 (it was "discovered"), and
 * default to Off there. An explicit choice (a buddy or Off) applies to every
 * theme.
 */
const AGENT_KEY = 'rtfm-buddy-agent';
const BATTERY_THRESHOLD_KEY = 'rtfm-buddy-battery-threshold';
const POSITION_KEY = 'rtfm-buddy-position';
const DISCOVERED_KEY = 'rtfm-buddy-discovered';

/** The theme the buddy belongs to (always available, Clippy on by default). */
export const BUDDY_THEME_ID = 'windows-95';

export const BUDDY_PREFS_CHANGE_EVENT = 'rtfm-buddy-prefs-change';

export const DEFAULT_BATTERY_THRESHOLD = 20;
export const MIN_BATTERY_THRESHOLD = 1;
export const MAX_BATTERY_THRESHOLD = 95;

export interface BuddyPosition {
  x: number;
  y: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable
  }
}

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BUDDY_PREFS_CHANGE_EVENT));
  }
}

/** Buddy shown under the Windows 95 theme until the user picks another or Off. */
export const DEFAULT_BUDDY_AGENT: BuddyAgentId = 'clippy';
/** Stored when the user turns the buddy off, so the default does not come back. */
const OFF_VALUE = 'off';

/** True once this browser has used the Windows 95 theme. */
export function isBuddyDiscovered(): boolean {
  return read(DISCOVERED_KEY) === '1';
}

export function markBuddyDiscovered(): void {
  if (isBuddyDiscovered()) return;
  write(DISCOVERED_KEY, '1');
  notify();
}

/** Whether the buddy (and its settings) is offered under this theme. */
export function isBuddyAvailable(theme: string = getEffectiveTheme()): boolean {
  return theme === BUDDY_THEME_ID || isBuddyDiscovered();
}

/** The buddy to show under this theme, or null for none. */
export function getBuddyAgent(theme: string = getEffectiveTheme()): BuddyAgentId | null {
  if (!isBuddyAvailable(theme)) return null;
  const raw = read(AGENT_KEY);
  if (raw === OFF_VALUE) return null;
  if (isBuddyAgentId(raw)) return raw;
  return theme === BUDDY_THEME_ID ? DEFAULT_BUDDY_AGENT : null;
}

export function setBuddyAgent(id: BuddyAgentId | null): void {
  write(AGENT_KEY, id ?? OFF_VALUE);
  notify();
}

export function clampBatteryThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BATTERY_THRESHOLD;
  return Math.min(MAX_BATTERY_THRESHOLD, Math.max(MIN_BATTERY_THRESHOLD, Math.round(value)));
}

/** Battery warning threshold in percent. */
export function getBuddyBatteryThreshold(): number {
  const raw = read(BATTERY_THRESHOLD_KEY);
  if (raw === null) return DEFAULT_BATTERY_THRESHOLD;
  return clampBatteryThreshold(Number(raw));
}

export function setBuddyBatteryThreshold(value: number): void {
  write(BATTERY_THRESHOLD_KEY, String(clampBatteryThreshold(value)));
  notify();
}

/** Last position the buddy was dragged to (viewport px), or null for the default corner. */
export function getBuddyPosition(): BuddyPosition | null {
  const raw = read(POSITION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BuddyPosition>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x as number, y: parsed.y as number };
    }
  } catch {
    // corrupt value; fall back to the default corner
  }
  return null;
}

export function setBuddyPosition(pos: BuddyPosition): void {
  write(POSITION_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
}
