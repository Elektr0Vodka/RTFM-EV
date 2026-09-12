import type { NeighborInfo, RepeaterNeighborHistoryResponse } from '../../types';

/**
 * Reconstruct a "last-known neighbours" list from stored per-neighbour signal
 * history. Used as a fallback for the Neighbors pane when a live radio query
 * returns no neighbours (a common transient outcome over RF): the SNR history
 * is already persisted server-side, so we can still show the last-seen set.
 *
 * The repeater->neighbour samples are the relevant channel (they mirror what a
 * live neighbours fetch reports), so entries without any repeater sample are
 * skipped. Names stay null here; the pane resolves display names and coords
 * from the contact list by pubkey prefix, exactly as it does for live data.
 */
export function buildNeighborsFromHistory(
  history: RepeaterNeighborHistoryResponse,
  nowSec: number
): NeighborInfo[] {
  const out: NeighborInfo[] = [];
  for (const entry of history.neighbors ?? []) {
    const samples = entry.repeater_samples ?? [];
    if (samples.length === 0) continue;
    let latest = samples[0];
    for (const s of samples) {
      if (s.observed_at > latest.observed_at) latest = s;
    }
    const lastHeard =
      latest.secs_ago != null ? latest.secs_ago : Math.max(0, nowSec - latest.observed_at);
    out.push({
      pubkey_prefix: entry.neighbor_pubkey,
      name: null,
      snr: latest.snr,
      last_heard_seconds: lastHeard,
    });
  }
  return out;
}
