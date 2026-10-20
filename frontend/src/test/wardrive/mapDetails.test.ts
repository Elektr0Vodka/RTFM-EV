import { describe, expect, it } from 'vitest';

import { translate } from '../../i18n/i18n';
import en from '../../i18n/locales/en.json';
import type { WardriveDataObs, WardriveLiveDriver } from '../../wardrive/api';
import { liveGeoJson, receptionDetails } from '../../wardrive/map/details';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const catalogs = { en } as any;
const t = (key: string, vars?: Record<string, string | number>) =>
  translate(catalogs, 'en', key, vars);

const OBS: WardriveDataObs = {
  user_id: 1,
  username: 'anna',
  radio_key: 'AB'.repeat(32),
  radio_name: 'car',
  rx_at: '2026-10-19T10:00:00.000Z',
  pub_at: '2026-10-19T10:00:01.000Z',
  uploaded_at: 1792404005,
  hash: '0123456789abcdef',
  len: 6,
  packet_type: 4,
  route: 'F',
  payload_len: 4,
  path: ['a1', 'b2'],
  rssi: -92,
  snr: 6.5,
  lat: 52.1,
  lon: 5.1,
  accuracy: 4,
  src: 'phone',
  drive_id: 7,
  drive_name: 'Ochtend',
  heard_id: 'b2',
  heard_name: 'Toren',
  heard_guess: true,
};

describe('reception details for the map popup', () => {
  it('lists every stored field with its label', () => {
    const rows = receptionDetails(OBS, t, 'decimal');
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map['Driver']).toBe('anna');
    expect(map['Radio']).toBe('car (ABABABAB)');
    expect(map['Drive']).toBe('Ochtend');
    expect(map['Signal']).toBe('-92 dBm, SNR 6.5 dB');
    expect(map['Packet']).toBe('Advert, flood, 6 bytes');
    expect(map['Hops']).toBe('2 (a1 > b2)');
    expect(map['Heard via']).toBe('~Toren (b2)');
    expect(map['Position']).toBe('52.10000, 5.10000 ± 4 m (phone)');
    expect(map['Hash']).toBe('0123456789abcdef');
    expect(Object.keys(map)).toEqual([
      'Heard',
      'Driver',
      'Radio',
      'Drive',
      'Signal',
      'Packet',
      'Hops',
      'Heard via',
      'Position',
      'Hash',
      'Published',
      'Uploaded',
    ]);
  });

  it('leaves out what was not stored and says unknown for a missing signal', () => {
    const rows = receptionDetails(
      {
        ...OBS,
        radio_name: null,
        drive_id: null,
        drive_name: null,
        heard_id: null,
        heard_name: null,
        heard_guess: false,
        path: [],
        route: 'D',
        rssi: null,
        snr: null,
        pub_at: null,
        accuracy: null,
        src: null,
        len: null,
      },
      t,
      'decimal'
    );
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map['Radio']).toBe('ABABABAB');
    expect(map['Drive']).toBeUndefined();
    expect(map['Heard via']).toBeUndefined();
    expect(map['Published']).toBeUndefined();
    expect(map['Hops']).toBe('0');
    expect(map['Signal']).toBe('unknown');
    expect(map['Packet']).toBe('Advert, direct');
    expect(map['Position']).toBe('52.10000, 5.10000');
  });

  it('follows the coordinate format setting', () => {
    const rows = receptionDetails(OBS, t, 'dms');
    const position = rows.find((r) => r.label === 'Position')!.value;
    expect(position).toMatch(/°/);
  });
});

describe('live drivers on the map', () => {
  const D: WardriveLiveDriver = {
    user_id: 1,
    username: 'anna',
    radio_key: 'AB'.repeat(32),
    radio_name: 'car',
    last_upload_at: 1792404000,
    last_ts: 1792403990,
    lat: 52.3,
    lon: 5.3,
    accuracy: 5,
    last_rssi: -97,
    last_snr: 3.5,
    drive_id: 7,
    drive_name: null,
    receptions: 12,
  };

  it('puts each driver at their newest position with their name', () => {
    const geo = liveGeoJson([D]);
    expect(geo.features).toHaveLength(1);
    expect(geo.features[0].geometry.coordinates).toEqual([5.3, 52.3]);
    expect(geo.features[0].properties).toMatchObject({ label: 'anna', radio: 'car' });
  });
});
