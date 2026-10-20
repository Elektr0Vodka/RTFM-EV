// Which heard senders behave as repeaters (core-hunter feed.js): the newest
// reception per sender decides, and a node counts when it is an advertised
// Repeater, a relay of a flood, or answered our trace (only a forwarding node
// does). A trace ping addresses its target by one byte, so ids collapse on
// that byte (the longest kept): two ids with one byte would be one frame.
import type { Sender } from '../decode/reception';

export interface HeardEntry {
  at: number;
  sender: Sender;
}

function newestPerSender(
  entries: HeardEntry[],
  wanted: (id: string) => boolean
): Map<string, HeardEntry> {
  const by = new Map<string, HeardEntry>();
  for (const e of entries) {
    if (!e.sender.id) continue;
    const id = e.sender.id.toLowerCase();
    if (!wanted(id)) continue;
    const prev = by.get(id);
    if (!prev || e.at > prev.at) by.set(id, e);
  }
  return by;
}

function repeaterReading(entries: HeardEntry[], wanted: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const [id, e] of newestPerSender(entries, wanted)) {
    const s = e.sender;
    if (s.role === 'Repeater' || s.kind === 'relay' || s.kind === 'trace_reply') out.push(id);
  }
  return out;
}

function repeaterIds(entries: HeardEntry[], wanted: (id: string) => boolean): string[] {
  const byByte = new Map<string, string>();
  for (const id of repeaterReading(entries, wanted)) {
    const b = id.slice(0, 2);
    const prev = byByte.get(b);
    if (!prev || id.length > prev.length) byByte.set(b, id);
  }
  return [...byByte.values()];
}

export function selectedRepeaterIds(entries: HeardEntry[], selected: Set<string>): string[] {
  if (!selected.size) return [];
  return repeaterIds(entries, (id) => selected.has(id));
}

/** The picked targets a trace cannot reach: everything picked that is not a
 * repeater, compared on full ids. */
export function selectedCompanionIds(entries: HeardEntry[], selected: Set<string>): string[] {
  if (!selected.size) return [];
  const repeaters = new Set(repeaterReading(entries, (id) => selected.has(id)));
  return [...newestPerSender(entries, (id) => selected.has(id)).keys()].filter(
    (id) => !repeaters.has(id)
  );
}

export function heardRepeaterIds(entries: HeardEntry[]): string[] {
  return repeaterIds(entries, () => true);
}
