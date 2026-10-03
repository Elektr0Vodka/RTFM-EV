import { describe, it, expect, vi } from 'vitest';
import {
  buildTeamBeaconFeatures,
  buildTeamRouteFeatures,
  buildTeamTrailFeatures,
  buildTeamWaypointFeatures,
  countTeamBeaconSenders,
  TEAM_PIN_IMAGES,
} from '../../map/layers/teamBeaconsLayer';
import { buildTeamBeaconPopup, buildTeamWaypointPopup } from '../../map/useTeamBeacons';
import {
  CONTACT_TYPE_CLIENT,
  type Contact,
  type TeamBeaconPoint,
  type TeamWaypointPin,
} from '../../types';

const ALICE = 'aa'.repeat(32);

const beacon = (over: Partial<TeamBeaconPoint> = {}): TeamBeaconPoint => ({
  message_id: 7,
  conversation_key: 'AB'.repeat(16),
  conversation_name: 'team',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: 1_789_999_998,
  kind: 'tel',
  source: 'team',
  lat: 52.0907,
  lon: 5.1214,
  radio_battery_mv: 3998,
  phone_battery_mv: 3800,
  phone_battery_pct: null,
  autonomous: false,
  needs_forwarding: false,
  max_path_observed: 0,
  node_count: null,
  neighbor_count: null,
  paths: null,
  ...over,
});

const waypoint = (over: Partial<TeamWaypointPin> = {}): TeamWaypointPin => ({
  message_id: 9,
  conversation_key: 'AB'.repeat(16),
  conversation_name: 'team',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: null,
  mesh_id: 'ab12',
  name: 'Camp',
  description: 'Base camp',
  waypoint_type: 'CAMP',
  color: null,
  lat: 52.1,
  lon: 5.2,
  route: [],
  route_complete: true,
  paths: null,
  ...over,
});

const contact = (publicKey: string): Contact => ({
  public_key: publicKey,
  name: 'Alice node',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: false,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
});

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const deps = {
  t,
  contacts: [] as Contact[],
  config: null,
  distanceUnit: 'metric' as const,
  coordinateFormat: 'decimal' as const,
};

describe('teamBeaconsLayer builders', () => {
  // Newest first, as the API returns them.
  const beacons = [
    beacon({ message_id: 3, lat: 52.3, lon: 5.3, received_at: 300 }),
    beacon({ message_id: 4, sender_name: 'Bob', lat: 51.0, lon: 4.0, received_at: 250 }),
    beacon({ message_id: 2, lat: 52.2, lon: 5.2, received_at: 200 }),
    beacon({ message_id: 1, lat: 52.1, lon: 5.1, received_at: 100 }),
  ];

  it('marks the newest beacon of each sender as its pin', () => {
    const fc = buildTeamBeaconFeatures(beacons);

    expect(fc.features.map((f) => [f.properties.message_id, f.properties.latest])).toEqual([
      [3, true],
      [4, true],
      [2, false],
      [1, false],
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([5.3, 52.3]);
    expect(fc.features[0].properties.title).toBe('Alice');
  });

  it('picks the pin icon by sender kind', () => {
    const fc = buildTeamBeaconFeatures([
      beacon({ message_id: 1, sender_name: 'Walker' }),
      beacon({ message_id: 2, sender_name: 'Tracker', autonomous: true }),
      beacon({ message_id: 3, sender_name: 'Boat', source: 'signalk' }),
    ]);

    expect(fc.features.map((f) => f.properties.icon)).toEqual([
      'rt-team-pin-person',
      'rt-team-pin-radio',
      'rt-team-pin-boat',
    ]);
  });

  it('uses the vessel type set on the sending contact', () => {
    const fc = buildTeamBeaconFeatures(
      [
        beacon({ message_id: 1, sender_key: ALICE.toUpperCase(), source: 'signalk' }),
        beacon({ message_id: 2, sender_name: 'Other boat', source: 'signalk' }),
      ],
      '',
      new Map([[ALICE, 'sailing']])
    );

    expect(fc.features.map((f) => f.properties.icon)).toEqual([
      'rt-team-pin-vessel-sailing',
      'rt-team-pin-boat',
    ]);
    expect(TEAM_PIN_IMAGES.map((image) => image.id)).toContain('rt-team-pin-vessel-sailing');
  });

  it('groups a sender by key across name changes', () => {
    const fc = buildTeamBeaconFeatures([
      beacon({ message_id: 2, sender_key: ALICE, sender_name: 'New name' }),
      beacon({ message_id: 1, sender_key: ALICE.toUpperCase(), sender_name: 'Old name' }),
    ]);

    expect(fc.features.map((f) => f.properties.latest)).toEqual([true, false]);
    expect(countTeamBeaconSenders(beacons)).toBe(2);
  });

  it('draws a trail per sender, oldest to newest, only with 2+ points', () => {
    const fc = buildTeamTrailFeatures(beacons);

    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [5.1, 52.1],
      [5.2, 52.2],
      [5.3, 52.3],
    ]);
  });

  it('builds waypoint pins with an icon per TEAM type', () => {
    const fc = buildTeamWaypointFeatures([
      waypoint(),
      waypoint({ message_id: 10, name: 'Bunker', waypoint_type: 'BUNKER' }),
    ]);

    expect(fc.features[0].geometry.coordinates).toEqual([5.2, 52.1]);
    expect(fc.features[0].properties).toMatchObject({
      message_id: 9,
      title: 'Camp',
      icon: 'rt-team-pin-way-camp',
    });
    expect(fc.features[1].properties.icon).toBe('rt-team-pin-way-custom');
  });

  it('defines a pin image for every icon a feature can name', () => {
    const ids = TEAM_PIN_IMAGES.map((image) => image.id);

    expect(ids).toEqual(expect.arrayContaining(['rt-team-pin-boat', 'rt-team-pin-radio']));
    expect(ids).toEqual(expect.arrayContaining(['rt-team-pin-way-camp', 'rt-team-pin-way-custom']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a route line in the route colour, only for 2+ points', () => {
    const fc = buildTeamRouteFeatures([
      waypoint(),
      waypoint({
        message_id: 10,
        color: '#f44336',
        route: [
          [52.0, 5.0],
          [52.1, 5.1],
        ],
      }),
      waypoint({ message_id: 11, route: [[52.0, 5.0]] }),
    ]);

    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [5.0, 52.0],
      [5.1, 52.1],
    ]);
    expect(fc.features[0].properties).toMatchObject({ message_id: 10, color: '#f44336' });
  });
});

describe('buildTeamBeaconPopup', () => {
  it('shows sender, channel, position and status', () => {
    const el = buildTeamBeaconPopup(
      beacon({
        needs_forwarding: true,
        max_path_observed: 2,
        paths: [{ path: 'aabb', received_at: 1, path_len: 2 }],
      }),
      { ...deps, trailCount: 3 }
    );
    const text = el.textContent ?? '';

    expect(text).toContain('Alice');
    expect(text).toContain('🚶 team_beacon');
    expect(text).toContain('map_shared_locations_in_channel {"name":"team"}');
    expect(text).toContain('52.090700, 5.121400');
    expect(text).toContain('team_radio_battery {"volts":"4.00"}');
    expect(text).toContain('team_phone_battery {"volts":"3.80"}');
    expect(text).toContain('team_needs_forwarding');
    expect(text).toContain('team_max_path {"count":2}');
    expect(text).toContain('map_shared_locations_hops {"count":2}');
    expect(text).toContain('map_beacons_trail_points {"count":3}');
  });

  it('labels a topology beacon and a signalk sender', () => {
    const topology = buildTeamBeaconPopup(
      beacon({ kind: 'topology', node_count: 10, neighbor_count: 3 }),
      { ...deps, trailCount: 1 }
    );
    expect(topology.textContent).toContain('team_topology_beacon');
    expect(topology.textContent).toContain('team_neighbors {"neighbors":3,"nodes":10}');
    expect(topology.textContent).not.toContain('map_beacons_trail_points');

    const signalk = buildTeamBeaconPopup(
      beacon({ source: 'signalk', phone_battery_mv: null, phone_battery_pct: 87 }),
      { ...deps, trailCount: 1 }
    );
    expect(signalk.textContent).toContain('⛵ team_beacon');
    expect(signalk.textContent).toContain('team_phone_battery_pct {"percent":87}');
    expect(signalk.textContent).toContain('team_source_signalk');
  });

  it('titles the popup with the vessel type icon of the sending contact', () => {
    const el = buildTeamBeaconPopup(beacon({ sender_key: ALICE, source: 'signalk' }), {
      ...deps,
      contacts: [{ ...contact(ALICE), vessel_type: 'sar' }],
      trailCount: 1,
    });

    expect(el.textContent).toContain('🆘 team_beacon');
    expect(el.textContent).toContain('vessel_type_sar');
  });

  it('jumps to the message and opens the sender contact', () => {
    const onNavigateToMessage = vi.fn();
    const onOpenContactInfo = vi.fn();
    const onAction = vi.fn();
    const el = buildTeamBeaconPopup(beacon({ sender_key: ALICE }), {
      ...deps,
      contacts: [contact(ALICE)],
      trailCount: 1,
      onNavigateToMessage,
      onOpenContactInfo,
      onAction,
    });
    const buttons = Array.from(el.querySelectorAll('button'));

    buttons.find((b) => b.textContent === 'map_shared_locations_open_in_chat')!.click();
    expect(onNavigateToMessage).toHaveBeenCalledWith({
      id: 7,
      type: 'CHAN',
      conversation_key: 'AB'.repeat(16),
      conversation_name: 'team',
    });
    buttons.find((b) => b.textContent === 'map_node_details')!.click();
    expect(onOpenContactInfo).toHaveBeenCalledWith(ALICE);
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});

describe('buildTeamWaypointPopup', () => {
  it('shows name, type, description and sender', () => {
    const text = buildTeamWaypointPopup(waypoint(), deps).textContent ?? '';

    expect(text).toContain('⛺ Camp');
    expect(text).toContain('team_waypoint_type_camp');
    expect(text).toContain('Base camp');
    expect(text).toContain('map_beacons_waypoint_from {"sender":"Alice"}');
    expect(text).toContain('52.100000, 5.200000');
    expect(text).not.toContain('team_route_incomplete');
  });

  it('reports route size, or that the route is incomplete', () => {
    const complete = buildTeamWaypointPopup(
      waypoint({
        waypoint_type: 'ROUTE',
        route: [
          [52.0, 5.0],
          [52.1, 5.1],
        ],
      }),
      deps
    );
    expect(complete.textContent).toContain('team_route_points {"count":2}');

    const incomplete = buildTeamWaypointPopup(
      waypoint({ waypoint_type: 'ROUTE', route_complete: false }),
      deps
    );
    expect(incomplete.textContent).toContain('team_route_incomplete');
  });

  it('keeps an unknown waypoint type as sent', () => {
    const text = buildTeamWaypointPopup(waypoint({ waypoint_type: 'BUNKER' }), deps).textContent;

    expect(text).toContain('BUNKER');
  });
});
