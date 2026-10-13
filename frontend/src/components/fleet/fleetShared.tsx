/**
 * Shared pieces of the fleet asset register (Tools > Fleet): the status list,
 * the name shown for an asset, and the pure filter, sort and export helpers.
 */
import { useT } from '../../i18n';
import { cn } from '@/lib/utils';
import type { Contact, FleetAsset, FleetAssetStatus, FleetSettings } from '../../types';

/** Statuses in the order of an asset's life. */
export const FLEET_STATUSES: FleetAssetStatus[] = [
  'in_stock',
  'deployed',
  'maintenance',
  'lost',
  'stolen',
  'retired',
];

// Sorting by status puts what needs a person first.
const STATUS_RANK: Record<FleetAssetStatus, number> = {
  lost: 0,
  stolen: 1,
  maintenance: 2,
  deployed: 3,
  in_stock: 4,
  retired: 5,
};

const STATUS_CLASS: Record<FleetAssetStatus, string> = {
  in_stock: 'border-border text-muted-foreground',
  deployed: 'border-success/40 bg-success/10 text-success',
  maintenance: 'border-warning/40 bg-warning/10 text-warning',
  lost: 'border-destructive/40 bg-destructive/10 text-destructive',
  stolen: 'border-destructive/40 bg-destructive/10 text-destructive',
  retired: 'border-border text-muted-foreground line-through',
};

export function fleetStatusLabelKey(status: FleetAssetStatus): string {
  return `fleet_status_${status}`;
}

export function FleetStatusBadge({ status }: { status: FleetAssetStatus }) {
  const t = useT();
  return (
    <span
      data-status={status}
      className={cn(
        'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium',
        STATUS_CLASS[status]
      )}
    >
      {t(fleetStatusLabelKey(status))}
    </span>
  );
}

/** The operator's own label wins; then what the mesh calls the node. */
export function fleetAssetName(asset: FleetAsset): string {
  return (
    asset.label ||
    asset.contact?.name ||
    asset.org_serial ||
    (asset.public_key ? asset.public_key.slice(0, 12) : `#${asset.id}`)
  );
}

function searchText(asset: FleetAsset): string {
  return [
    asset.label,
    asset.contact?.name,
    asset.public_key,
    asset.org_serial,
    asset.hw_serial,
    asset.model,
    asset.role,
    asset.wifi_mac,
    asset.ble_mac,
    asset.assigned_to,
    asset.site_name,
    asset.notes,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function filterFleetAssets(
  assets: FleetAsset[],
  query: string,
  status: FleetAssetStatus | 'all'
): FleetAsset[] {
  const needle = query.trim().toLowerCase();
  return assets.filter(
    (asset) =>
      (status === 'all' || asset.status === status) &&
      (needle === '' || searchText(asset).includes(needle))
  );
}

export type FleetAttentionReason = 'lost' | 'stolen' | 'silent' | 'battery' | 'firmware';

/** True when the node reports the firmware it is meant to run ("v1.9" fits "v1.9.0 (Build: x)"). */
export function firmwareMatches(target: string, reported: string): boolean {
  return reported.toLowerCase().includes(target.trim().toLowerCase());
}

/**
 * Why an asset needs a person, from stored data only.
 *
 * Lost and stolen come from the status. The others apply to a deployed asset
 * with a public key: not seen for longer than `silent_hours` (or never), a
 * stored battery reading under `low_battery_volts`, or a reported firmware
 * that differs from the asset's target.
 */
export function fleetAttention(
  asset: FleetAsset,
  settings: FleetSettings,
  nowSec: number
): FleetAttentionReason[] {
  if (asset.status === 'lost' || asset.status === 'stolen') return [asset.status];
  if (asset.status !== 'deployed' || !asset.public_key) return [];
  const reasons: FleetAttentionReason[] = [];
  const lastSeen = asset.contact?.last_seen ?? null;
  if (lastSeen === null || nowSec - lastSeen > settings.silent_hours * 3600) {
    reasons.push('silent');
  }
  const volts = asset.health?.battery_volts ?? null;
  if (volts !== null && volts < settings.low_battery_volts) reasons.push('battery');
  const reported = asset.health?.firmware_version ?? null;
  if (asset.target_firmware && reported && !firmwareMatches(asset.target_firmware, reported)) {
    reasons.push('firmware');
  }
  return reasons;
}

export type FleetSortKey =
  | 'status'
  | 'name'
  | 'org_serial'
  | 'model'
  | 'assigned_to'
  | 'site_name'
  | 'last_seen'
  | 'battery'
  | 'firmware'
  | 'last_maintenance';
export type FleetSortDir = 'asc' | 'desc';

function sortValue(asset: FleetAsset, key: FleetSortKey): number | string | null {
  switch (key) {
    case 'status':
      return STATUS_RANK[asset.status];
    case 'name':
      return fleetAssetName(asset).toLowerCase();
    case 'last_seen':
      return asset.contact?.last_seen ?? null;
    case 'battery':
      return asset.health?.battery_volts ?? null;
    case 'firmware':
      return asset.health?.firmware_version?.toLowerCase() ?? null;
    case 'last_maintenance':
      return asset.last_maintenance;
    default:
      return asset[key]?.toLowerCase() ?? null;
  }
}

/** Sorted copy. Assets without a value for the column go last in both directions. */
export function sortFleetAssets(
  assets: FleetAsset[],
  key: FleetSortKey,
  dir: FleetSortDir
): FleetAsset[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...assets].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    let cmp = 0;
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (typeof x === 'number' && typeof y === 'number') {
      cmp = (x - y) * sign;
    } else {
      cmp = String(x).localeCompare(String(y)) * sign;
    }
    return cmp || a.id - b.id;
  });
}

/**
 * Public keys of contacts owned by one of `ownerKeys` (the radio's own key and
 * the earlier radios it inherits from) that have no asset yet. Same rule as
 * the sidebar's Owned section.
 */
export function ownedKeysWithoutAsset(
  contacts: Contact[],
  ownerKeys: string[],
  assets: FleetAsset[]
): string[] {
  const owners = new Set(ownerKeys.filter(Boolean).map((key) => key.toLowerCase()));
  if (owners.size === 0) return [];
  const taken = new Set(assets.map((asset) => asset.public_key).filter(Boolean));
  return contacts
    .filter(
      (contact) =>
        contact.public_key.length === 64 &&
        !!contact.owner_key &&
        owners.has(contact.owner_key.toLowerCase()) &&
        !taken.has(contact.public_key.toLowerCase())
    )
    .map((contact) => contact.public_key.toLowerCase());
}

export const FLEET_CSV_COLUMNS = [
  'id',
  'label',
  'public_key',
  'contact_name',
  'status',
  'org_serial',
  'hw_serial',
  'model',
  'role',
  'wifi_mac',
  'ble_mac',
  'assigned_to',
  'site_name',
  'notes',
  'last_seen',
  'battery_volts',
  'firmware_version',
  'target_firmware',
  'last_maintenance',
  'last_failure',
  'created_at',
  'updated_at',
] as const;
export type FleetCsvColumn = (typeof FLEET_CSV_COLUMNS)[number];

function isoTime(unixSec: number | null | undefined): string {
  return unixSec ? new Date(unixSec * 1000).toISOString() : '';
}

function csvCell(value: string): string {
  // A cell that starts like a formula is run by a spreadsheet; a leading
  // apostrophe makes it plain text there.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvValue(asset: FleetAsset, column: FleetCsvColumn): string {
  switch (column) {
    case 'id':
      return String(asset.id);
    case 'contact_name':
      return asset.contact?.name ?? '';
    case 'last_seen':
      return isoTime(asset.contact?.last_seen);
    case 'battery_volts':
      return asset.health?.battery_volts != null ? String(asset.health.battery_volts) : '';
    case 'firmware_version':
      return asset.health?.firmware_version ?? '';
    case 'last_maintenance':
    case 'last_failure':
    case 'created_at':
    case 'updated_at':
      return isoTime(asset[column]);
    default:
      return asset[column] ?? '';
  }
}

/** CSV text of the register. `headers` supplies the translated column titles. */
export function buildFleetCsv(
  assets: FleetAsset[],
  headers: Record<FleetCsvColumn, string>
): string {
  const lines = [FLEET_CSV_COLUMNS.map((column) => csvCell(headers[column])).join(',')];
  for (const asset of assets) {
    lines.push(FLEET_CSV_COLUMNS.map((column) => csvCell(csvValue(asset, column))).join(','));
  }
  return lines.join('\r\n');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `fleet_YYYYMMDD_HHMMSS.<ext>`. */
export function fleetExportFilename(extension: 'csv' | 'json', at: Date): string {
  const stamp =
    `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}` +
    `_${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `fleet_${stamp}.${extension}`;
}

export function downloadFleetFile(filename: string, type: string, parts: BlobPart[]): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
