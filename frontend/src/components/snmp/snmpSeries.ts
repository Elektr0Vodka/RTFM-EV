// Turn stored SNMP polls into chart series.
//
// Gauges (heap, RSSI, queue depth) are plotted as they are. Counters only go up
// since boot, so they are shown as a rate between two polls; a reboot starts
// the counter over and that interval is left out.

import type { SnmpHistoryEntry } from '../../types';

export interface SnmpChartPoint {
  time: number;
  value: number;
}

function numberAt(entry: SnmpHistoryEntry, key: string): number | null {
  const value = entry.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** History rows to chart points for one value; rows without a number are skipped. */
export function toChartPoints(history: SnmpHistoryEntry[], key: string): SnmpChartPoint[] {
  const points: SnmpChartPoint[] = [];
  for (const entry of history) {
    const value = numberAt(entry, key);
    if (value !== null) points.push({ time: entry.timestamp, value });
  }
  return points;
}

/** True when the node restarted between two polls: its uptime went down. */
function rebootedBetween(previous: SnmpHistoryEntry, current: SnmpHistoryEntry): boolean {
  const before = numberAt(previous, 'uptime_secs');
  const after = numberAt(current, 'uptime_secs');
  return before !== null && after !== null && after < before;
}

/**
 * A counter as a rate: its increase between two polls, per `scale` seconds
 * (60 = per minute; 100 on a seconds counter = a percentage of the time).
 * Each point sits at the later poll. An interval with a reboot, or one where
 * the counter went down, gives no point.
 */
export function ratePoints(
  history: SnmpHistoryEntry[],
  key: string,
  scale: number
): SnmpChartPoint[] {
  const points: SnmpChartPoint[] = [];
  let previous: SnmpHistoryEntry | null = null;
  let previousValue = 0;
  for (const entry of history) {
    const value = numberAt(entry, key);
    if (value === null) continue;
    if (previous !== null) {
      const seconds = entry.timestamp - previous.timestamp;
      const increase = value - previousValue;
      if (seconds > 0 && increase >= 0 && !rebootedBetween(previous, entry)) {
        points.push({ time: entry.timestamp, value: (increase / seconds) * scale });
      }
    }
    previous = entry;
    previousValue = value;
  }
  return points;
}

/** How often the uptime went down in the stored polls. */
export function countReboots(history: SnmpHistoryEntry[]): number {
  let reboots = 0;
  let previous: number | null = null;
  for (const entry of history) {
    const uptime = numberAt(entry, 'uptime_secs');
    if (uptime === null) continue;
    if (previous !== null && uptime < previous) reboots += 1;
    previous = uptime;
  }
  return reboots;
}
