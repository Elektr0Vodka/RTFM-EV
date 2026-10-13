import { describe, expect, it } from 'vitest';

import {
  FLEET_CSV_COLUMNS,
  buildFleetCsv,
  filterFleetAssets,
  fleetAssetName,
  fleetAttention,
  fleetExportFilename,
  ownedKeysWithoutAsset,
  sortFleetAssets,
} from '../components/fleet/fleetShared';
import type { Contact, FleetAsset } from '../types';

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);
const KEY_C = 'cc'.repeat(32);
const OWNER = 'ee'.repeat(32);

function asset(overrides: Partial<FleetAsset> = {}): FleetAsset {
  return {
    id: 1,
    public_key: null,
    label: null,
    org_serial: null,
    hw_serial: null,
    model: null,
    role: null,
    wifi_mac: null,
    ble_mac: null,
    assigned_to: null,
    site_name: null,
    status: 'in_stock',
    notes: null,
    target_firmware: null,
    last_maintenance: null,
    last_failure: null,
    health: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    contact: null,
    ...overrides,
  };
}

function contact(publicKey: string, ownerKey: string | null): Contact {
  return { public_key: publicKey, name: publicKey.slice(0, 4), owner_key: ownerKey } as Contact;
}

const HEADERS = Object.fromEntries(FLEET_CSV_COLUMNS.map((c) => [c, c])) as Record<
  (typeof FLEET_CSV_COLUMNS)[number],
  string
>;

describe('fleetAssetName', () => {
  it('prefers the label, then the contact name, the serial, the key and the id', () => {
    const contactInfo = { name: 'Tower RPT', type: 2, last_seen: null, lat: null, lon: null };
    expect(
      fleetAssetName(asset({ label: 'North mast', contact: contactInfo, org_serial: 'S-1' }))
    ).toBe('North mast');
    expect(fleetAssetName(asset({ contact: contactInfo, org_serial: 'S-1' }))).toBe('Tower RPT');
    expect(fleetAssetName(asset({ org_serial: 'S-1', public_key: KEY_A }))).toBe('S-1');
    expect(fleetAssetName(asset({ public_key: KEY_A }))).toBe('aaaaaaaaaaaa');
    expect(fleetAssetName(asset({ id: 7 }))).toBe('#7');
  });
});

describe('filterFleetAssets', () => {
  const assets = [
    asset({ id: 1, label: 'North mast', status: 'deployed', org_serial: 'DTIS-0042' }),
    asset({ id: 2, public_key: KEY_B, status: 'in_stock', wifi_mac: 'AA:BB:CC:DD:EE:FF' }),
    asset({
      id: 3,
      status: 'deployed',
      label: 'Hill',
      contact: { name: 'Hill RPT', type: 2, last_seen: null, lat: null, lon: null },
      assigned_to: 'Team North',
    }),
  ];

  it('returns everything for an empty query and "all"', () => {
    expect(filterFleetAssets(assets, '  ', 'all')).toHaveLength(3);
  });

  it('filters by status', () => {
    expect(filterFleetAssets(assets, '', 'deployed').map((a) => a.id)).toEqual([1, 3]);
  });

  it('matches any text field, case-insensitively', () => {
    expect(filterFleetAssets(assets, 'dtis', 'all').map((a) => a.id)).toEqual([1]);
    expect(filterFleetAssets(assets, 'bbbb', 'all').map((a) => a.id)).toEqual([2]);
    expect(filterFleetAssets(assets, 'dd:ee', 'all').map((a) => a.id)).toEqual([2]);
    expect(filterFleetAssets(assets, 'hill rpt', 'all').map((a) => a.id)).toEqual([3]);
    expect(filterFleetAssets(assets, 'NORTH', 'all').map((a) => a.id)).toEqual([1, 3]);
  });

  it('combines the query with the status', () => {
    expect(filterFleetAssets(assets, 'north', 'in_stock')).toEqual([]);
  });
});

describe('sortFleetAssets', () => {
  const assets = [
    asset({ id: 1, label: 'bravo', status: 'retired', org_serial: 'S-2' }),
    asset({ id: 2, label: 'Alpha', status: 'deployed' }),
    asset({
      id: 3,
      label: 'charlie',
      status: 'lost',
      org_serial: 'S-1',
      contact: { name: null, type: 2, last_seen: 1700000500, lat: null, lon: null },
    }),
  ];

  it('sorts by name without regard to case', () => {
    expect(sortFleetAssets(assets, 'name', 'asc').map((a) => a.id)).toEqual([2, 1, 3]);
    expect(sortFleetAssets(assets, 'name', 'desc').map((a) => a.id)).toEqual([3, 1, 2]);
  });

  it('sorts by status in lifecycle order, lost and stolen first', () => {
    expect(sortFleetAssets(assets, 'status', 'asc').map((a) => a.status)).toEqual([
      'lost',
      'deployed',
      'retired',
    ]);
  });

  it('puts assets without a value last in both directions', () => {
    expect(sortFleetAssets(assets, 'org_serial', 'asc').map((a) => a.id)).toEqual([3, 1, 2]);
    expect(sortFleetAssets(assets, 'org_serial', 'desc').map((a) => a.id)).toEqual([1, 3, 2]);
    expect(sortFleetAssets(assets, 'last_seen', 'desc').map((a) => a.id)[0]).toBe(3);
  });

  it('does not change the list it was given', () => {
    const before = assets.map((a) => a.id);
    sortFleetAssets(assets, 'name', 'desc');
    expect(assets.map((a) => a.id)).toEqual(before);
  });
});

describe('ownedKeysWithoutAsset', () => {
  it('lists full-key contacts owned by one of the owner keys that have no asset yet', () => {
    const contacts = [
      contact(KEY_A, OWNER.toUpperCase()),
      contact(KEY_B, OWNER),
      contact(KEY_C, 'ff'.repeat(32)),
      contact('abcdef', OWNER),
      contact('dd'.repeat(32), null),
    ];
    const assets = [asset({ public_key: KEY_B })];

    expect(ownedKeysWithoutAsset(contacts, [OWNER], assets)).toEqual([KEY_A]);
  });

  it('is empty without an owner key', () => {
    expect(ownedKeysWithoutAsset([contact(KEY_A, OWNER)], [], [])).toEqual([]);
  });
});

describe('buildFleetCsv', () => {
  it('writes a header row and one row per asset', () => {
    const csv = buildFleetCsv(
      [
        asset({
          id: 4,
          label: 'North, mast',
          public_key: KEY_A,
          status: 'deployed',
          notes: 'says "hi"\nsecond line',
          contact: { name: 'Tower RPT', type: 2, last_seen: 1700000000, lat: null, lon: null },
        }),
      ],
      HEADERS
    );
    const [header, ...rest] = csv.split('\r\n');

    expect(header).toBe(FLEET_CSV_COLUMNS.join(','));
    const row = rest.join('\r\n');
    expect(row.startsWith(`4,"North, mast",${KEY_A},Tower RPT,deployed,`)).toBe(true);
    expect(row).toContain('"says ""hi""\nsecond line"');
    expect(row).toContain('2023-11-14T22:13:20.000Z');
  });

  it('keeps a spreadsheet from running a cell as a formula', () => {
    const csv = buildFleetCsv([asset({ label: '=1+1', notes: '@cmd' })], HEADERS);

    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@cmd");
  });
});

describe('fleetAttention', () => {
  const NOW = 1_700_000_000;
  const RULES = { silent_hours: 48, low_battery_volts: 3.5 };
  const seen = (secondsAgo: number) => ({
    name: 'Tower',
    type: 2,
    last_seen: NOW - secondsAgo,
    lat: null,
    lon: null,
  });
  const health = (overrides: Partial<NonNullable<FleetAsset['health']>> = {}) => ({
    battery_volts: null,
    temperature: null,
    telemetry_at: null,
    firmware_version: null,
    firmware_at: null,
    firmware_source: null,
    ...overrides,
  });
  const deployed = (overrides: Partial<FleetAsset> = {}) =>
    asset({ status: 'deployed', public_key: KEY_A, contact: seen(60), ...overrides });

  it('reports nothing for a healthy deployed node', () => {
    expect(fleetAttention(deployed({ health: health() }), RULES, NOW)).toEqual([]);
  });

  it('reports lost and stolen from the status alone', () => {
    expect(fleetAttention(asset({ status: 'lost' }), RULES, NOW)).toEqual(['lost']);
    expect(fleetAttention(asset({ status: 'stolen' }), RULES, NOW)).toEqual(['stolen']);
  });

  it('reports a deployed node that is silent for longer than the limit, or never heard', () => {
    expect(fleetAttention(deployed({ contact: seen(49 * 3600) }), RULES, NOW)).toEqual(['silent']);
    expect(fleetAttention(deployed({ contact: seen(47 * 3600) }), RULES, NOW)).toEqual([]);
    expect(fleetAttention(deployed({ contact: null }), RULES, NOW)).toEqual(['silent']);
  });

  it('reports a battery reading under the limit', () => {
    const low = deployed({ health: health({ battery_volts: 3.41 }) });
    const fine = deployed({ health: health({ battery_volts: 3.5 }) });

    expect(fleetAttention(low, RULES, NOW)).toEqual(['battery']);
    expect(fleetAttention(fine, RULES, NOW)).toEqual([]);
  });

  it('reports a firmware other than the target, and accepts a longer reported string', () => {
    const off = deployed({
      target_firmware: 'v1.10.0',
      health: health({ firmware_version: 'v1.9.0 (Build: 12 Sep)' }),
    });
    const match = deployed({
      target_firmware: 'V1.10.0',
      health: health({ firmware_version: 'v1.10.0 (Build: 2 Oct)' }),
    });
    const unknown = deployed({ target_firmware: 'v1.10.0', health: health() });

    expect(fleetAttention(off, RULES, NOW)).toEqual(['firmware']);
    expect(fleetAttention(match, RULES, NOW)).toEqual([]);
    expect(fleetAttention(unknown, RULES, NOW)).toEqual([]);
  });

  it('leaves assets alone that are not deployed or have no key', () => {
    const stale = { contact: seen(999 * 3600), health: health({ battery_volts: 1 }) };
    const inStock = asset({ status: 'in_stock', public_key: KEY_A, ...stale });

    expect(fleetAttention(inStock, RULES, NOW)).toEqual([]);
    expect(fleetAttention(asset({ status: 'deployed', public_key: null }), RULES, NOW)).toEqual([]);
  });
});

describe('fleetExportFilename', () => {
  it('carries the date and the extension', () => {
    expect(fleetExportFilename('csv', new Date(2026, 9, 13, 8, 5, 9))).toBe(
      'fleet_20261013_080509.csv'
    );
  });
});
