import { describe, it, expect } from 'vitest';
import {
  antennaBandFilter,
  buildAntennaFeatures,
  sitesForBand,
} from '../../map/layers/antennaRegisterLayer';
import { buildAntennaDeckLayers } from '../../map/layers/antennaDeckLayer';
import {
  ASSUMED_BEAMWIDTH_DEG,
  buildPatternPolygons,
  centreMhz,
  destinationPoint,
  freeSpaceReachM,
  sectorRing,
} from '../../map/antennaPatterns';
import { buildAntennaSitePopup } from '../../map/useAntennaRegister';
import type {
  AntennaRegisterSite,
  AntennaRegisterSiteSummary,
  AntennaRegisterTransmitter,
  RadioConfig,
} from '../../types';

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const tx = (over: Partial<AntennaRegisterTransmitter> = {}): AntennaRegisterTransmitter => ({
  system: 'LTE',
  band: '800',
  frequency: '816 MHz',
  sectors: 3,
  bearings_deg: [0, 120, 240],
  omni: false,
  height_m: 30,
  power_dbw: 31.4,
  ...over,
});

const site = (over: Partial<AntennaRegisterSite> = {}): AntennaRegisterSite => ({
  id: 5,
  lat: 52.229339,
  lon: 5.174312,
  bands: ['800', '900'],
  max_power_dbw: 31.4,
  max_height_m: 30,
  municipality: 'Hilversum',
  postcode: '1217LG',
  place: '',
  kinds: 'LTE, GSM',
  transmitters: [
    tx(),
    tx({
      system: 'GSM 900',
      band: '900',
      frequency: '925-934.8 MHz',
      sectors: 1,
      bearings_deg: [],
      omni: true,
      height_m: null,
      power_dbw: null,
    }),
  ],
  ...over,
});

const summary = (
  id: number,
  bands: string[],
  power: number | null = 30,
  height: number | null = 25
): AntennaRegisterSiteSummary => ({
  id,
  lat: 52.1,
  lon: 4.9,
  bands,
  max_power_dbw: power,
  max_height_m: height,
});

const deps = (
  config: Partial<RadioConfig> | null = null,
  band: '868' | '433' = '868',
  levelDbm: number | null = null
) => ({
  t,
  band,
  config: config as RadioConfig | null,
  distanceUnit: 'metric' as const,
  coordinateFormat: 'decimal' as const,
  levelDbm,
});

const metres = (a: [number, number], b: [number, number]) => {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
};

describe('buildAntennaFeatures', () => {
  it('maps sites to [lon, lat] points with band flags, band-independent', () => {
    const fc = buildAntennaFeatures([
      summary(1, ['800'], 33),
      summary(2, ['900', 'amateur'], null),
      summary(3, ['450']),
      summary(4, ['amateur'], null),
    ]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [4.9, 52.1] });
    expect(fc.features.map((f) => f.properties)).toEqual([
      { id: 1, power: 33, b868: true, k433: '' },
      { id: 2, power: 20, b868: true, k433: 'amateur' },
      { id: 3, power: 30, b868: false, k433: 'pamr' },
      { id: 4, power: 20, b868: false, k433: 'amateur' },
    ]);
  });

  it('filters per band without new data', () => {
    expect(antennaBandFilter('868')).toEqual(['==', ['get', 'b868'], true]);
    expect(antennaBandFilter('433')).toEqual(['!=', ['get', 'k433'], '']);
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

describe('antennaPatterns', () => {
  it('parses centre frequencies', () => {
    expect(centreMhz('816 MHz')).toBe(816);
    expect(centreMhz('925-934.8 MHz')).toBeCloseTo(929.9);
    expect(centreMhz('71.625 GHz')).toBeNull();
  });

  it('matches the textbook free-space loss of 92.45 dB at 1 km and 1 GHz', () => {
    // ERP -2.15 dBW = EIRP 30 dBm; 30 - 92.45 = -62.45 dBm at 1 km.
    expect(freeSpaceReachM(-2.15, 1000, -62.45)).toBeCloseTo(1000, 0);
    // 10 dB more path loss = 10^(10/20) = 3.16x the distance.
    expect(freeSpaceReachM(-2.15, 1000, -72.45)).toBeCloseTo(3162.3, 0);
  });

  it('gives a 31.4 dBW 816 MHz sector about 4.4 km to -40 dBm', () => {
    expect(freeSpaceReachM(31.4, 816, -40)).toBeCloseTo(4402, -1);
  });

  it('walks the great circle', () => {
    const [lon, lat] = destinationPoint(52, 5, 0, 1000);
    expect(lon).toBeCloseTo(5, 9);
    expect(lat).toBeCloseTo(52.008993, 5);
    expect(metres([5, 52], destinationPoint(52, 5, 135, 2500))).toBeCloseTo(2500, 0);
  });

  it('builds a wedge from the centre over the beamwidth at the radius', () => {
    const ring = sectorRing(52, 5, 90, 60, 1000, 30, 6);
    expect(ring[0]).toEqual([5, 52, 30]);
    expect(ring[ring.length - 1]).toEqual([5, 52, 30]);
    for (const p of ring.slice(1, -1)) {
      expect(metres([5, 52], [p[0], p[1]])).toBeCloseTo(1000, 0);
      expect(p[2]).toBe(30);
    }
    expect(ring).toHaveLength(6 + 3);
  });

  it('builds a closed circle for an omni antenna', () => {
    const ring = sectorRing(52, 5, 0, 360, 500, 0);
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 9);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 9);
  });

  it('makes one polygon per sector of the chosen band, skipping unknown power', () => {
    const polys = buildPatternPolygons([site()], '868', -40, false);
    // LTE 816: 3 sectors; GSM 900 omni has no power -> skipped.
    expect(polys).toHaveLength(3);
    expect(polys.every((p) => p.ring.every((c) => c[2] === 0))).toBe(true);
    expect(polys[0].radiusM).toBeCloseTo(freeSpaceReachM(31.4, 816, -40));
    expect(buildPatternPolygons([site()], '433', -40, false)).toHaveLength(0);
    expect(ASSUMED_BEAMWIDTH_DEG).toBe(65);
  });

  it('raises patterns to antenna height in 3D and draws omni as a circle', () => {
    const omni = site({
      transmitters: [
        tx({ band: '450', frequency: '421-425 MHz', bearings_deg: [], omni: true, height_m: 72 }),
      ],
    });
    const [poly] = buildPatternPolygons([omni], '433', -40, true);
    expect(poly.ring.every((c) => c[2] === 72)).toBe(true);
    expect(poly.ring.length).toBeGreaterThan(40);
  });
});

describe('buildAntennaDeckLayers', () => {
  const fakeDeck = new Proxy(
    {},
    {
      get: (_target, name) =>
        class {
          props: Record<string, unknown>;
          kind = String(name);
          constructor(props: Record<string, unknown>) {
            this.props = props;
          }
        },
    }
  ) as unknown as typeof import('deck.gl');

  it('draws nothing without masts or patterns', () => {
    expect(
      buildAntennaDeckLayers(fakeDeck, { band: '868', masts: [], patterns: [], selected: [] })
    ).toEqual([]);
  });

  it('draws sticks and tops only for masts with a height', () => {
    const layers = buildAntennaDeckLayers(fakeDeck, {
      band: '868',
      masts: [summary(1, ['800'], 30, 25), summary(2, ['800'], 30, null)],
      patterns: [],
      selected: [],
    }) as { kind: string; props: { id: string; data: AntennaRegisterSiteSummary[] } }[];
    expect(layers.map((l) => l.kind)).toEqual(['LineLayer', 'ScatterplotLayer']);
    expect(layers[0].props.data.map((s) => s.id)).toEqual([1]);
  });

  it('draws the pattern fill as a depth-tested union', () => {
    const patterns = buildPatternPolygons([site()], '868', -40, false);
    const layers = buildAntennaDeckLayers(fakeDeck, {
      band: '868',
      masts: [],
      patterns,
      selected: [],
    }) as { kind: string; props: { id: string; parameters: Record<string, unknown> } }[];
    expect(layers.map((l) => l.kind)).toEqual(['SolidPolygonLayer']);
    expect(layers[0].props.parameters).toEqual({ depthCompare: 'less', depthWriteEnabled: true });
  });

  it('puts sticks first, the selected site above the patterns and tops last', () => {
    const patterns = buildPatternPolygons([site()], '868', -40, true);
    const layers = buildAntennaDeckLayers(fakeDeck, {
      band: '868',
      masts: [summary(1, ['800'], 30, 25)],
      patterns,
      selected: patterns.slice(0, 1),
    }) as { props: { id: string } }[];
    expect(layers.map((l) => l.props.id)).toEqual([
      'antenna-mast-stick',
      'antenna-pattern-fill',
      'antenna-pattern-selected-edge',
      'antenna-mast-top',
    ]);
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
    expect(text).not.toContain('map_antennas_tx_reach');
  });

  it('adds the free-space reach when patterns are on', () => {
    const text = buildAntennaSitePopup(site(), deps(null, '868', -40)).textContent ?? '';
    expect(text).toContain('map_antennas_tx_reach {"level":-40,"distance":"4.4km"}');
  });

  it('lists only the chosen band and flags amateur stations on 433', () => {
    const mixed = site({
      bands: ['450', '800', 'amateur'],
      transmitters: [
        ...site().transmitters,
        tx({
          system: 'PAMR',
          band: '450',
          frequency: '421-425 MHz',
          sectors: 1,
          bearings_deg: [],
          omni: true,
          height_m: 40,
          power_dbw: 17,
        }),
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
