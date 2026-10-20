// The senders a driver can pick as targets: the newest reception per sender
// id, searchable by name or id, and a short Top list by signal and age.
import type { Sender, SenderKind } from './decode/reception';
import type { Filterable } from './filters';
import type { NameParts } from './names';

/** Senders that are one node: a channel name, a key, or a relay of 2+ bytes.
 * A 1-byte hash is one of 256 buckets, so it is not a target. */
export const TARGET_KINDS: SenderKind[] = [
  'channel_name',
  'advert_pubkey',
  'discover_pubkey',
  'relay',
];

export type TargetEntry = Filterable & { rssi: number | null; name: NameParts };

export interface TargetRow {
  id: string;
  sender: Sender;
  name: NameParts;
  rssi: number | null;
  at: number;
}

/** One row per target-kind sender id, from its newest reception. */
export function senderRows(entries: TargetEntry[], ignore: Set<string>): TargetRow[] {
  const rows = new Map<string, TargetRow>();
  for (const e of entries) {
    const id = e.sender.id;
    if (!id || !e.sender.kind || !TARGET_KINDS.includes(e.sender.kind)) continue;
    if (ignore.has(id.toLowerCase())) continue;
    const had = rows.get(id);
    if (!had || e.at > had.at) {
      rows.set(id, { id, sender: e.sender, name: e.name, rssi: e.rssi, at: e.at });
    }
  }
  return [...rows.values()];
}

export function matchesQuery(row: TargetRow, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return row.name.name.toLowerCase().includes(query) || row.id.toLowerCase().startsWith(query);
}

/** The rows matching the search, by name (else id). */
export function senderList(rows: TargetRow[], query: string): TargetRow[] {
  return rows
    .filter((r) => matchesQuery(r, query))
    .sort((a, b) =>
      (a.name.name || a.id).localeCompare(b.name.name || b.id, undefined, { sensitivity: 'base' })
    );
}

const NO_SIGNAL = -200;
const AGE_PENALTY_S = 30;

/** The best few by signal less a dB per 30 s of age; empty when the whole
 * list is no longer than that. */
export function topSenders(rows: TargetRow[], nowMs: number, count = 3): TargetRow[] {
  if (rows.length <= count) return [];
  const score = (r: TargetRow) =>
    (r.rssi ?? NO_SIGNAL) - Math.max(0, nowMs - r.at) / 1000 / AGE_PENALTY_S;
  return [...rows].sort((a, b) => score(b) - score(a)).slice(0, count);
}
