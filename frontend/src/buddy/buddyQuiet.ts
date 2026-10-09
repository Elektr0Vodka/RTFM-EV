import { BUDDY_GROUPS, type BuddyGroup } from './buddyLogic';

/** Daily quiet hours in the browser's local time, both as "HH:MM". */
export interface QuietHours {
  from: string;
  to: string;
}

/** A running mute: until a moment (epoch ms), or until the page is reloaded. */
export type BuddyMute = { kind: 'until'; until: number } | { kind: 'reload' } | null;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight for "HH:MM", or null when it is not a valid time. */
function clockMinutes(value: unknown): number | null {
  const match = typeof value === 'string' ? CLOCK.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isValidQuietHours(value: unknown): value is QuietHours {
  if (!value || typeof value !== 'object') return false;
  const { from, to } = value as Partial<QuietHours>;
  return clockMinutes(from) !== null && clockMinutes(to) !== null;
}

/** True inside the range; it may wrap midnight. Equal times mean off. */
export function isWithinQuietHours(now: Date, hours: QuietHours | null): boolean {
  if (!hours) return false;
  const from = clockMinutes(hours.from);
  const to = clockMinutes(hours.to);
  if (from === null || to === null || from === to) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** Whether the buddy should keep silent at this moment. */
export function isQuiet(now: Date, mute: BuddyMute, hours: QuietHours | null): boolean {
  if (mute?.kind === 'reload') return true;
  if (mute?.kind === 'until' && mute.until > now.getTime()) return true;
  return isWithinQuietHours(now, hours);
}

export interface HeldBackCount {
  group: BuddyGroup;
  count: number;
}

/** Counts what was kept back during a quiet period, per group. */
export class HeldBack {
  private counts = new Map<BuddyGroup, number>();

  /** `count`: how many things the line was about (3 for "3 new nodes"). */
  add(group: BuddyGroup, count = 1): void {
    this.counts.set(group, (this.counts.get(group) ?? 0) + count);
  }

  /** The counts in group order, emptying the counter; null when nothing was held back. */
  takeSummary(): HeldBackCount[] | null {
    if (this.counts.size === 0) return null;
    const summary = BUDDY_GROUPS.filter((group) => this.counts.has(group)).map((group) => ({
      group,
      count: this.counts.get(group) ?? 0,
    }));
    this.counts.clear();
    return summary;
  }
}
