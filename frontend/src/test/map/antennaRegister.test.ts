import { describe, it, expect } from 'vitest';
import { buildAntennaFeatures } from '../../map/layers/antennaRegisterLayer';
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

const deps = (config: Partial<RadioConfig> | null = null) => ({
  t,
  config: config as RadioConfig | null,
  distanceUnit: 'metric' as const,
  coordinateFormat: 'decimal' as const,
});

describe('buildAntennaFeatures', () => {
  it('maps sites to [lon, lat] points carrying id and power', () => {
    const fc = buildAntennaFeatures([
      { id: 1, lat: 52.1, lon: 4.9, bands: ['800'], max_power_dbw: 33 },
      { id: 2, lat: 51.5, lon: 5.5, bands: ['900'], max_power_dbw: null },
    ]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [4.9, 52.1] });
    expect(fc.features[0].properties).toEqual({ id: 1, power: 33 });
    // Unknown power still draws, as a small dot.
    expect(fc.features[1].properties.power).toBe(20);
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

  it('adds the distance from our own node when it is located', () => {
    const withNode = buildAntennaSitePopup(site(), deps({ lat: 52.2, lon: 5.1 })).textContent;
    expect(withNode).toContain('map_shared_locations_distance');
    const without = buildAntennaSitePopup(site(), deps(null)).textContent;
    expect(without).not.toContain('map_shared_locations_distance');
  });
});
