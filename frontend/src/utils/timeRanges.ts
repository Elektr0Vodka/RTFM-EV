export interface TimeRange {
  /** Stable id used as the selection value and persistence key. */
  id: string;
  /** i18n key for the button label. */
  labelKey: string;
  /** Window length in seconds, or null for "no lower bound" (e.g. All). */
  seconds: number | null;
}

export const CUSTOM_RANGE_ID = 'custom';

export const BASE_TIME_RANGES: TimeRange[] = [
  { id: '20m', labelKey: 'time_range_20m', seconds: 20 * 60 },
  { id: '1h', labelKey: 'time_range_1h', seconds: 60 * 60 },
  { id: '3h', labelKey: 'time_range_3h', seconds: 3 * 60 * 60 },
  { id: '6h', labelKey: 'time_range_6h', seconds: 6 * 60 * 60 },
  { id: '12h', labelKey: 'time_range_12h', seconds: 12 * 60 * 60 },
  { id: '24h', labelKey: 'time_range_24h', seconds: 24 * 60 * 60 },
  { id: '48h', labelKey: 'time_range_48h', seconds: 48 * 60 * 60 },
  { id: '3d', labelKey: 'time_range_3d', seconds: 3 * 24 * 60 * 60 },
  { id: '7d', labelKey: 'time_range_7d', seconds: 7 * 24 * 60 * 60 },
  { id: '14d', labelKey: 'time_range_14d', seconds: 14 * 24 * 60 * 60 },
  { id: '30d', labelKey: 'time_range_30d', seconds: 30 * 24 * 60 * 60 },
];

interface ResolveOpts {
  nowSec?: number;
  customStartSec?: number | null;
  customEndSec?: number | null;
  extras?: TimeRange[];
}

/** Resolve a range id to absolute {startTs,endTs} in Unix seconds, or null if unresolvable. */
export function resolveRange(
  id: string,
  opts: ResolveOpts = {}
): { startTs: number; endTs: number } | null {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (id === CUSTOM_RANGE_ID) {
    if (opts.customStartSec == null || opts.customEndSec == null) return null;
    return { startTs: opts.customStartSec, endTs: opts.customEndSec };
  }
  const all = [...BASE_TIME_RANGES, ...(opts.extras ?? [])];
  const range = all.find((r) => r.id === id);
  if (!range) return null;
  if (range.seconds == null) return { startTs: 0, endTs: now };
  return { startTs: now - range.seconds, endTs: now };
}
