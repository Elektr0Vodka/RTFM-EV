import { describe, it, expect } from 'vitest';
import {
  buildTeamWaypointPayload,
  decodeTeamRoute,
  parseTeamPayload,
  TEAM_VESSEL_TYPES,
  teamBeaconIcon,
  teamBeaconKind,
  teamWaypointIcon,
} from '../utils/teamPayloads';

function b64(bytes: number[], padded = false): string {
  const text = btoa(String.fromCharCode(...bytes));
  return padded ? text : text.replace(/=+$/, '');
}

function position(lat: number, lon: number): number[] {
  const view = new DataView(new ArrayBuffer(8));
  view.setInt32(0, Math.round(lat * 1e7));
  view.setInt32(4, Math.round(lon * 1e7));
  return Array.from(new Uint8Array(view.buffer));
}

function tel(lat: number, lon: number, radio: number, phone: number, fwd: number, padded = false) {
  return `#TEL:${b64([...position(lat, lon), radio, phone, fwd], padded)}`;
}

function topology(lat: number, lon: number, nodeCount: number, bitmap: number[], phone = 177) {
  return `#T:${b64([...position(lat, lon), 210, phone, nodeCount, ...bitmap])}`;
}

describe('parseTeamPayload: #TEL:', () => {
  it('decodes a TEAM beacon', () => {
    expect(parseTeamPayload(tel(52.0907, 5.1214, 210, 177, 6))).toEqual({
      type: 'beacon',
      kind: 'tel',
      source: 'team',
      lat: 52.0907,
      lon: 5.1214,
      radioBatteryMv: 3998,
      phoneBatteryMv: 3800,
      phoneBatteryPct: null,
      autonomous: false,
      needsForwarding: true,
      maxPathObserved: 2,
      nodeCount: null,
      neighborCount: null,
    });
  });

  it('decodes the same literal wire string as the backend test', () => {
    const beacon = parseTeamPayload('#TEL:Hwxo+AMNdrDSsQY');
    expect(beacon).toMatchObject({ type: 'beacon', lat: 52.0907, lon: 5.1214 });
  });

  it('decodes negative coordinates', () => {
    expect(parseTeamPayload(tel(-33.865143, -151.2099, 2, 2, 1))).toMatchObject({
      lat: -33.865143,
      lon: -151.2099,
      radioBatteryMv: 2750,
      needsForwarding: false,
      maxPathObserved: 0,
    });
  });

  it('treats battery bytes 0 and 1 as unknown', () => {
    expect(parseTeamPayload(tel(52, 5, 1, 0, 1))).toMatchObject({
      radioBatteryMv: null,
      phoneBatteryMv: null,
    });
  });

  it('flags an autonomous radio (phone byte 0xFF)', () => {
    expect(parseTeamPayload(tel(52, 5, 100, 0xff, 1))).toMatchObject({
      autonomous: true,
      phoneBatteryMv: null,
    });
  });

  it('recognizes signalk-meshcore by forwarding status 0', () => {
    expect(parseTeamPayload(tel(52, 5, 210, 0xfe, 0, true))).toMatchObject({
      source: 'signalk',
      radioBatteryMv: 3998,
      phoneBatteryMv: null,
      phoneBatteryPct: null,
      needsForwarding: null,
      maxPathObserved: null,
    });
    expect(parseTeamPayload(tel(52, 5, 0, 87, 0, true))).toMatchObject({
      radioBatteryMv: null,
      phoneBatteryPct: 87,
    });
  });

  it('treats a saturated radio battery byte as unknown', () => {
    expect(parseTeamPayload(tel(52, 5, 0xff, 0xfe, 0))).toMatchObject({ radioBatteryMv: null });
  });

  it('keeps batteries when the position is unset or out of range', () => {
    expect(parseTeamPayload(tel(0, 0, 210, 177, 1))).toMatchObject({
      lat: null,
      lon: null,
      radioBatteryMv: 3998,
    });
    expect(parseTeamPayload(tel(95, 5, 210, 177, 1))).toMatchObject({ lat: null, lon: null });
  });

  it('rejects a wrong length or invalid Base64', () => {
    expect(parseTeamPayload(`#TEL:${b64(new Array(10).fill(1))}`)).toBeNull();
    expect(parseTeamPayload(`#TEL:${b64(new Array(12).fill(1))}`)).toBeNull();
    expect(parseTeamPayload('#TEL:not base64!')).toBeNull();
    expect(parseTeamPayload('#TEL:')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseTeamPayload('  #TEL:Hwxo+AMNdrDSsQY \n')).not.toBeNull();
  });
});

describe('parseTeamPayload: #T:', () => {
  it('decodes a topology beacon and counts neighbours', () => {
    expect(parseTeamPayload(topology(52.0907, 5.1214, 10, [0x09, 0x02]))).toMatchObject({
      type: 'beacon',
      kind: 'topology',
      source: 'team',
      lat: 52.0907,
      lon: 5.1214,
      radioBatteryMv: 3998,
      phoneBatteryMv: 3800,
      nodeCount: 10,
      neighborCount: 3,
      needsForwarding: null,
    });
  });

  it('ignores bits beyond the node count', () => {
    expect(parseTeamPayload(topology(52, 5, 3, [0xff]))).toMatchObject({ neighborCount: 3 });
  });

  it('handles an empty network and the autonomous sentinel', () => {
    expect(parseTeamPayload(topology(52, 5, 0, [], 0xff))).toMatchObject({
      nodeCount: 0,
      neighborCount: 0,
      autonomous: true,
    });
  });

  it('rejects a short bitmap or header', () => {
    expect(parseTeamPayload(topology(52, 5, 20, [0x01]))).toBeNull();
    expect(parseTeamPayload(`#T:${b64(new Array(10).fill(1))}`)).toBeNull();
  });
});

describe('parseTeamPayload: #WAY: and #WRC:', () => {
  it('parses a waypoint with a mesh id', () => {
    expect(parseTeamPayload('#WAY:ab12|Camp|52.0907|5.1214|Base camp|CAMP|')).toEqual({
      type: 'waypoint',
      meshId: 'ab12',
      name: 'Camp',
      lat: 52.0907,
      lon: 5.1214,
      description: 'Base camp',
      waypointType: 'CAMP',
      color: null,
      routeChunk: '',
      partNum: null,
      totalParts: null,
    });
  });

  it('parses the legacy five-field form', () => {
    expect(parseTeamPayload('#WAY:Camp|52.0907|5.1214|Base camp|CAMP')).toMatchObject({
      meshId: null,
      name: 'Camp',
      lat: 52.0907,
      waypointType: 'CAMP',
    });
  });

  it('strips the colour prefix from the description', () => {
    expect(parseTeamPayload('#WAY:ab12|Trail|52.0|5.0|@C:FFF44336North loop|ROUTE|')).toMatchObject(
      { description: 'North loop', color: '#f44336' }
    );
  });

  it('keeps the route chunk and multi-part info', () => {
    expect(
      parseTeamPayload('#WAY:ab12|Trail|52.0|5.0||ROUTE|52.0,5.0~52.1,5.1~|1/3')
    ).toMatchObject({ routeChunk: '52.0,5.0~52.1,5.1~', partNum: 1, totalParts: 3 });
    expect(parseTeamPayload('#WAY:|Camp|52.0|5.0||CAMP|')).toMatchObject({ meshId: null });
  });

  it('rejects bad coordinates and too few fields', () => {
    expect(parseTeamPayload('#WAY:ab12|Camp|north|5.0||CAMP|')).toBeNull();
    expect(parseTeamPayload('#WAY:ab12|Camp|0|0||CAMP|')).toBeNull();
    expect(parseTeamPayload('#WAY:ab12|Camp|NaN|5.0||CAMP|')).toBeNull();
    expect(parseTeamPayload('#WAY:ab12|Camp|200|5.0||CAMP|')).toBeNull();
    expect(parseTeamPayload('#WAY:Camp|52.0|5.0|desc')).toBeNull();
  });

  it('parses a route continuation', () => {
    expect(parseTeamPayload('#WRC:ab12|52.2,5.2~52.3,5.3~|2/3')).toEqual({
      type: 'routePart',
      meshId: 'ab12',
      routeChunk: '52.2,5.2~52.3,5.3~',
      partNum: 2,
      totalParts: 3,
    });
    expect(parseTeamPayload('#WRC:ab12|52.2,5.2')).toBeNull();
    expect(parseTeamPayload('#WRC:ab12|52.2,5.2|two/3')).toBeNull();
  });
});

describe('parseTeamPayload: #CAP:', () => {
  it('parses v1', () => {
    expect(parseTeamPayload('#CAP:1:0b')).toEqual({
      type: 'capability',
      version: 1,
      flags: 0x0b,
      customFirmware: true,
      forwardingCapable: true,
      autonomousCapable: false,
      autonomousEnabled: true,
      smartForwardingActive: false,
      radioKeyPrefix: null,
      appId: null,
      alias: null,
    });
  });

  it('parses v2 with an alias that contains a colon', () => {
    expect(parseTeamPayload('#CAP:2:1f:a1b2c3d4e5f6:0123456789abcdef:Team: Alpha')).toMatchObject({
      version: 2,
      smartForwardingActive: true,
      radioKeyPrefix: 'a1b2c3d4e5f6',
      appId: '0123456789abcdef',
      alias: 'Team: Alpha',
    });
  });

  it('parses v2 placeholders and the early form without an app id', () => {
    expect(parseTeamPayload('#CAP:2:01:-:-:')).toMatchObject({
      radioKeyPrefix: null,
      appId: null,
      alias: '',
    });
    expect(parseTeamPayload('#CAP:2:01:a1b2c3d4e5f6:Scout')).toMatchObject({
      appId: null,
      alias: 'Scout',
    });
  });

  it('parses an advert request', () => {
    expect(parseTeamPayload('#CAP:R:a1b2c3d4e5f6:Radio: One')).toEqual({
      type: 'capabilityRequest',
      targetKeyPrefix: 'a1b2c3d4e5f6',
      targetRadioName: 'Radio: One',
    });
    expect(parseTeamPayload('#CAP:R:-:Radio One')).toMatchObject({ targetKeyPrefix: null });
  });

  it('rejects malformed adverts', () => {
    expect(parseTeamPayload('#CAP:1')).toBeNull();
    expect(parseTeamPayload('#CAP:x:0b')).toBeNull();
    expect(parseTeamPayload('#CAP:1:zz')).toBeNull();
    expect(parseTeamPayload('#CAP:R:-:')).toBeNull();
  });
});

describe('parseTeamPayload: other text', () => {
  it('returns null', () => {
    expect(parseTeamPayload('hello world')).toBeNull();
    expect(parseTeamPayload('see #TEL: later')).toBeNull();
    expect(parseTeamPayload('')).toBeNull();
  });
});

describe('decodeTeamRoute', () => {
  it('decodes points and skips bad entries', () => {
    expect(decodeTeamRoute('52.0,5.0~bad~52.1,5.1~')).toEqual([
      [52.0, 5.0],
      [52.1, 5.1],
    ]);
    expect(decodeTeamRoute('')).toEqual([]);
  });
});

describe('teamWaypointIcon', () => {
  it('maps TEAM types case-insensitively and falls back to a pin', () => {
    expect(teamWaypointIcon('CAMP')).toBe('⛺');
    expect(teamWaypointIcon('water')).toBe('💧');
    expect(teamWaypointIcon('something else')).toBe('📌');
  });
});

describe('teamBeaconKind', () => {
  it('tells a boat, an autonomous radio and a phone user apart', () => {
    expect(teamBeaconKind({ source: 'signalk', autonomous: false })).toBe('boat');
    expect(teamBeaconKind({ source: 'team', autonomous: true })).toBe('radio');
    expect(teamBeaconKind({ source: 'team', autonomous: false })).toBe('person');
    expect(teamBeaconIcon({ source: 'signalk', autonomous: false })).toBe('⛵');
    expect(teamBeaconIcon({ source: 'team', autonomous: true })).toBe('📡');
    expect(teamBeaconIcon({ source: 'team', autonomous: false })).toBe('🚶');
  });
});

describe('vessel types', () => {
  it('a hand-set vessel type wins over the sender kind', () => {
    expect(teamBeaconIcon({ source: 'signalk', autonomous: false }, 'motor')).toBe('🚤');
    expect(teamBeaconIcon({ source: 'team', autonomous: true }, 'sailing')).toBe('⛵');
    expect(teamBeaconIcon({ source: 'team', autonomous: true }, null)).toBe('📡');
  });

  it('has an icon for every vessel type', () => {
    expect(TEAM_VESSEL_TYPES).toEqual([
      'sailing',
      'motor',
      'fishing',
      'cargo',
      'passenger',
      'tug',
      'sar',
      'other',
    ]);
    const icons = TEAM_VESSEL_TYPES.map((type) =>
      teamBeaconIcon({ source: 'signalk', autonomous: false }, type)
    );
    expect(new Set(icons).size).toBe(TEAM_VESSEL_TYPES.length);
  });
});

describe('buildTeamWaypointPayload', () => {
  it('builds a #WAY: message the parser reads back', () => {
    const text = buildTeamWaypointPayload({
      meshId: 'ab12cd34',
      name: 'Camp',
      lat: 52.0907,
      lon: 5.1214,
      waypointType: 'camp',
    });

    expect(text).toBe('#WAY:ab12cd34|Camp|52.090700|5.121400||CAMP|');
    expect(parseTeamPayload(text)).toMatchObject({
      type: 'waypoint',
      meshId: 'ab12cd34',
      name: 'Camp',
      lat: 52.0907,
      lon: 5.1214,
      waypointType: 'CAMP',
      routeChunk: '',
    });
  });

  it('keeps pipes and line breaks out of the name and makes a mesh id when none is given', () => {
    const text = buildTeamWaypointPayload({
      name: ' a|b\nc ',
      lat: 1.5,
      lon: 2.5,
      waypointType: 'water',
    });

    expect(text).toMatch(/^#WAY:[0-9a-f]{8}\|ab c\|1\.500000\|2\.500000\|\|WATER\|$/);
  });
});
