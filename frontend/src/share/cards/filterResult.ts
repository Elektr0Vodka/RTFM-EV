import type { SnmpHistoryEntry } from '../../types';

export interface FilterReason {
  key: string;
  label: string;
  value: number;
}

/** Cards 5a-5d, "Filter results": what a filter dropped or hid, by reason. */
export interface FilterResultModel {
  /** Reasons with a count above 0, largest first. */
  reasons: FilterReason[];
  total: number;
  airtimeMs: number | null;
  /** Counts per time bin, for the animation; empty when there is no history. */
  bins: number[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Increase of one counter between two polls. A lower value is a reset (reboot
 *  or cleared stats): the new value is what was counted since. */
function counterDelta(prev: number, next: number): number {
  return next >= prev ? next - prev : next;
}

/**
 * Per-key totals over an SNMP history of Counter32 values. A key the node
 * never reported (always null) is null, so the card can leave it out.
 */
export function snmpCounterTotals(
  history: SnmpHistoryEntry[],
  keys: string[]
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of keys) {
    let prev: number | null = null;
    let total: number | null = null;
    for (const row of history) {
      const v = num(row.values[key]);
      if (v == null) continue;
      if (prev != null) total = (total ?? 0) + counterDelta(prev, v);
      else total = total ?? 0;
      prev = v;
    }
    out[key] = total;
  }
  return out;
}

/** The summed increase of `keys` per equal time bin over the history's span. */
export function snmpCounterBins(history: SnmpHistoryEntry[], keys: string[], n: number): number[] {
  const bins = new Array<number>(n).fill(0);
  if (history.length < 2 || n < 1) return bins;
  const t0 = history[0].timestamp;
  const span = history[history.length - 1].timestamp - t0;
  if (span <= 0) return bins;
  const width = span / n;
  for (const key of keys) {
    let prev: number | null = null;
    for (const row of history) {
      const v = num(row.values[key]);
      if (v == null) continue;
      if (prev != null) {
        // The increase covers the interval that ends at this poll.
        const idx = Math.min(n - 1, Math.max(0, Math.ceil((row.timestamp - t0) / width) - 1));
        bins[idx] += counterDelta(prev, v);
      }
      prev = v;
    }
  }
  return bins;
}

export function buildFilterResult(
  reasons: { key: string; label: string; value: number | null }[],
  opts: { airtimeMs?: number | null; bins?: number[] } = {}
): FilterResultModel {
  const kept = reasons
    .filter((r): r is FilterReason => r.value != null && r.value > 0)
    .sort((a, b) => b.value - a.value);
  return {
    reasons: kept,
    total: kept.reduce((s, r) => s + r.value, 0),
    airtimeMs: opts.airtimeMs ?? null,
    bins: opts.bins ?? [],
  };
}
