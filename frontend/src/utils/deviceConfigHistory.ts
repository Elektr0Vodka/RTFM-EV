import type { DeviceConfigHistoryEntry, DeviceConfigKind } from '../types';

/** Pane order of the repeater dashboard; kinds render in this order. */
export const DEVICE_CONFIG_KINDS: DeviceConfigKind[] = [
  'node_info',
  'radio_settings',
  'advert_intervals',
  'owner_info',
  'regions',
];

export interface ConfigFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ConfigSnapshotView {
  timestamp: number;
  data: Record<string, unknown>;
  /** Fields that differ from the previous (older) snapshot; null = oldest stored one. */
  changes: ConfigFieldChange[] | null;
}

export interface ConfigKindHistory {
  kind: DeviceConfigKind;
  /** Newest first. */
  snapshots: ConfigSnapshotView[];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Group stored pane snapshots by kind (dashboard pane order, empty kinds
 * dropped) and diff each snapshot against the previous one of the same kind.
 */
export function buildConfigHistory(entries: DeviceConfigHistoryEntry[]): ConfigKindHistory[] {
  const result: ConfigKindHistory[] = [];
  for (const kind of DEVICE_CONFIG_KINDS) {
    const ofKind = entries.filter((e) => e.kind === kind).sort((a, b) => b.timestamp - a.timestamp);
    if (ofKind.length === 0) continue;
    const snapshots = ofKind.map((entry, i): ConfigSnapshotView => {
      const previous = ofKind[i + 1];
      if (!previous) return { timestamp: entry.timestamp, data: entry.data, changes: null };
      const fields = [...new Set([...Object.keys(previous.data), ...Object.keys(entry.data)])];
      const changes = fields
        .filter((field) => !sameValue(previous.data[field], entry.data[field]))
        .map((field) => ({ field, before: previous.data[field], after: entry.data[field] }));
      return { timestamp: entry.timestamp, data: entry.data, changes };
    });
    result.push({ kind, snapshots });
  }
  return result;
}

/** Display a stored field value: '-' for empty, compact JSON for lists/objects. */
export function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
