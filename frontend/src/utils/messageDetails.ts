import type { MessagePath } from '../types';
import { parsePathHops } from './pathUtils';

/**
 * An offset between the sender's stamp and our receive time below this many
 * seconds is ordinary flood delay or clock jitter, so the details view does not
 * call it out.
 */
export const CLOCK_OFFSET_NOTE_SECONDS = 60;

/**
 * Seconds the sender's own stamp is ahead of (positive) or behind (negative)
 * the time we received the message. Null without a sender stamp.
 */
export function senderClockOffset(
  senderTimestamp: number | null | undefined,
  receivedAt: number
): number | null {
  if (senderTimestamp == null || senderTimestamp <= 0) return null;
  return senderTimestamp - receivedAt;
}

/** Compact absolute duration: "2d 8h", "3h 5m", "4m 10s", "45s". */
export function formatOffsetDuration(seconds: number): string {
  const secs = Math.round(Math.abs(seconds));
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const rest = secs % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${rest}s`;
}

/** Distinct hop counts over a message's receive paths, ascending. */
export function pathHopCounts(paths: MessagePath[] | null | undefined): number[] {
  if (!paths || paths.length === 0) return [];
  const counts = new Set<number>();
  for (const p of paths) {
    counts.add(parsePathHops(p.path, p.path_len).length);
  }
  return [...counts].sort((a, b) => a - b);
}
