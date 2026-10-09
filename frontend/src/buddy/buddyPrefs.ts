import { getEffectiveTheme } from '../utils/theme';
import { isBuddyAgentId, type BuddyAgentId } from './agents';
import { BUDDY_GROUPS, type BuddyGroup } from './buddyLogic';
import { isQuiet, isValidQuietHours, type BuddyMute, type QuietHours } from './buddyQuiet';

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
const GROUPS_OFF_KEY = 'rtfm-buddy-groups-off';
const MUTE_UNTIL_KEY = 'rtfm-buddy-mute-until';
const QUIET_HOURS_KEY = 'rtfm-buddy-quiet-hours';
const BATTERY_WARNED_KEY = 'rtfm-buddy-battery-warned';

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

function readJson(key: string): unknown {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Groups of lines the user switched off (everything is on by default). */
export function getBuddyGroupsOff(): BuddyGroup[] {
  const stored = readJson(GROUPS_OFF_KEY);
  if (!Array.isArray(stored)) return [];
  return BUDDY_GROUPS.filter((group) => stored.includes(group));
}

export function isBuddyGroupOn(group: BuddyGroup): boolean {
  return !getBuddyGroupsOff().includes(group);
}

export function setBuddyGroupOn(group: BuddyGroup, on: boolean): void {
  const off = new Set(getBuddyGroupsOff());
  if (on) off.delete(group);
  else off.add(group);
  write(GROUPS_OFF_KEY, off.size > 0 ? JSON.stringify([...off].sort()) : null);
  notify();
}

// "Until reload" must not outlive the page, so it is not stored.
let mutedUntilReload = false;

/** The mute that is running at `now` (epoch ms), or null. */
export function getBuddyMute(now: number = Date.now()): BuddyMute {
  if (mutedUntilReload) return { kind: 'reload' };
  const until = Number(read(MUTE_UNTIL_KEY));
  return Number.isFinite(until) && until > now ? { kind: 'until', until } : null;
}

export function muteBuddyFor(durationMs: number, now: number = Date.now()): void {
  mutedUntilReload = false;
  write(MUTE_UNTIL_KEY, String(Math.round(now + durationMs)));
  notify();
}

export function muteBuddyUntilReload(): void {
  mutedUntilReload = true;
  write(MUTE_UNTIL_KEY, null);
  notify();
}

export function unmuteBuddy(): void {
  mutedUntilReload = false;
  write(MUTE_UNTIL_KEY, null);
  notify();
}

/** Test helper: forget a mute "until reload" (a reload cannot be simulated). */
export function __resetBuddyMuteForTests(): void {
  mutedUntilReload = false;
}

/** Daily quiet hours, or null when none are set. */
export function getBuddyQuietHours(): QuietHours | null {
  const stored = readJson(QUIET_HOURS_KEY);
  return isValidQuietHours(stored) ? { from: stored.from, to: stored.to } : null;
}

export function setBuddyQuietHours(hours: QuietHours | null): void {
  write(QUIET_HOURS_KEY, hours && isValidQuietHours(hours) ? JSON.stringify(hours) : null);
  notify();
}

/** Whether a mute or the quiet hours keep the buddy silent at `now`. */
export function isBuddyQuiet(now: Date = new Date()): boolean {
  return isQuiet(now, getBuddyMute(now.getTime()), getBuddyQuietHours());
}

/** Battery keys ("self" or a node's public key) that were already warned about. */
export function getWarnedBatteries(): string[] {
  const stored = readJson(BATTERY_WARNED_KEY);
  return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : [];
}

export function setWarnedBatteries(keys: string[]): void {
  write(BATTERY_WARNED_KEY, keys.length > 0 ? JSON.stringify(keys) : null);
}
