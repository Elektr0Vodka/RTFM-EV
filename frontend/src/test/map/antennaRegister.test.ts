import { describe, it, expect } from 'vitest';
import { buildAntennaFeatures, sitesForBand } from '../../map/layers/antennaRegisterLayer';
import { buildAntennaSitePopup } from '../../map/useAntennaRegister';
import type { AntennaRegisterSite, RadioConfig } from '../../types';

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const site = (over: Partial<AntennaRegisterSite> = {}): AntennaRegisterSite => ({
  id: 5,
  lat: 52.229339,
  lon: 5.174312,
  bands: ['800', '900'],
  max_power_dbw: 31.4,
  municipality: 'Hilversum',
  postcode: '1217LG',
  place: '',
  kinds: 'LTE, GSM',
  transmitters: [
    {
      system: 'LTE',
      band: '800',
      frequency: '816 MHz',
      sectors: 3,
      bearings_deg: [0, 120, 240],
      omni: false,
      height_m: 30,
      power_dbw: 31.4,
    },
    {
      system: 'GSM 900',
      band: '900',
      frequency: '925-934.8 MHz',
      sectors: 1,
      bearings_deg: [],
      omni: true,
      height_m: null,
      power_dbw: null,
    },
  ],
  ...over,
});

const deps = (config: Partial<RadioConfig> | null = null, band: '868' | '433' = '868') => ({
  t,
  band,
  config: config as RadioConfig | null,
  distanceUnit: 'metric' as const,
  coordinateFormat: 'decimal' as const,
});

const summary = (id: number, bands: string[], power: number | null = 30) => ({
  id,
  lat: 52.1,
  lon: 4.9,
  bands,
  max_power_dbw: power,
});

describe('buildAntennaFeatures', () => {
  it('maps sites to [lon, lat] points carrying id, power and kind', () => {
    const fc = buildAntennaFeatures([summary(1, ['800'], 33), summary(2, ['900'], null)], '868');
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [4.9, 52.1] });
    expect(fc.features[0].properties).toEqual({ id: 1, power: 33, kind: '868' });
    // Unknown power still draws, as a small dot.
    expect(fc.features[1].properties.power).toBe(20);
  });

  it('marks amateur-only sites on the 433 view', () => {
    const fc = buildAntennaFeatures(
      [summary(1, ['450']), summary(2, ['amateur'], null), summary(3, ['450', 'amateur'])],
      '433'
    );
    expect(fc.features.map((f) => f.properties.kind)).toEqual(['433', 'amateur', '433']);
  });
});

describe('sitesForBand', () => {
  const sites = [
    summary(1, ['700', '800']),
    summary(2, ['450']),
    summary(3, ['amateur']),
    summary(4, ['900', 'amateur']),
  ];
  it('keeps the 700/800/900 MHz sites for 868', () => {
    expect(sitesForBand(sites, '868').map((s) => s.id)).toEqual([1, 4]);
  });
  it('keeps PAMR and amateur sites for 433', () => {
    expect(sitesForBand(sites, '433').map((s) => s.id)).toEqual([2, 3, 4]);
  });
});

describe('buildAntennaSitePopup', () => {
  it('lists every transmitter with sectors, directions, height and power', () => {
    const text = buildAntennaSitePopup(site(), deps()).textContent ?? '';
    expect(text).toContain('map_antennas_site_title');
    expect(text).toContain('Hilversum 1217LG');
    expect(text).toContain('LTE 816 MHz');
    expect(text).toContain('"directions":"0°, 120°, 240°"');
    expect(text).toContain('"sectors":3');
    expect(text).toContain('"height":"30"');
    expect(text).toContain('GSM 900 925-934.8 MHz');
    expect(text).toContain('"directions":"map_antennas_omni"');
    expect(text).toContain('"height":"?"');
    expect(text).toContain('map_antennas_source');
  });

  it('lists only the chosen band and flags amateur stations on 433', () => {
    const mixed = site({
      bands: ['450', '800', 'amateur'],
      transmitters: [
        ...site().transmitters,
        {
          system: 'PAMR',
          band: '450',
          frequency: '421-425 MHz',
          sectors: 1,
          bearings_deg: [],
          omni: true,
          height_m: 40,
          power_dbw: 17,
        },
      ],
    });
    const on868 = buildAntennaSitePopup(mixed, deps(null, '868')).textContent ?? '';
    expect(on868).toContain('LTE 816 MHz');
    expect(on868).not.toContain('PAMR');
    expect(on868).not.toContain('map_antennas_amateur');
    const on433 = buildAntennaSitePopup(mixed, deps(null, '433')).textContent ?? '';
    expect(on433).toContain('PAMR 421-425 MHz');
    expect(on433).not.toContain('LTE 816 MHz');
    expect(on433).toContain('map_antennas_amateur_detail');
  });

  it('adds the distance from our own node when it is located', () => {
    const withNode = buildAntennaSitePopup(site(), deps({ lat: 52.2, lon: 5.1 })).textContent;
    expect(withNode).toContain('map_shared_locations_distance');
    const without = buildAntennaSitePopup(site(), deps(null)).textContent;
    expect(without).not.toContain('map_shared_locations_distance');
  });
});
