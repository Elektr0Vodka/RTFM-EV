import type { Map as MlMap } from 'maplibre-gl';
import type { TeamBeaconPoint, TeamWaypointPin, VesselType } from '../../types';
import {
  TEAM_BEACON_ICONS,
  TEAM_VESSEL_ICONS,
  TEAM_VESSEL_TYPES,
  TEAM_WAYPOINT_TYPES,
  teamBeaconKind,
  teamWaypointIcon,
  teamWaypointKind,
  type TeamBeaconKind,
} from '../../utils/teamPayloads';
import { NODE_LABEL_FONT } from './nodesLayer';
import { buildEmojiPinImage } from './sharedLocationsLayer';

// MeshCore TEAM beacons (#TEL: / #T:) and waypoints (#WAY:) from followed
// channels. Each sender's newest beacon is a teardrop pin; its older beacons in
// the window are small dots joined by a dashed trail. Waypoints are pins in a
// second colour, with their route as a solid line in the colour TEAM sent.
// The pin head carries an icon: the sender kind for beacons (boat, autonomous
// radio, person) and TEAM's own type icon for waypoints.
export const TEAM_BEACON_FILL = '#d97706';
export const TEAM_WAYPOINT_FILL = '#7c3aed';
const PIN_SCALE = 2;
// Drawn a little larger than the shared-location pins so the icon stays legible.
const PIN_ICON_SIZE = 1.3;

const beaconPinId = (kind: TeamBeaconKind) => `rt-team-pin-${kind}`;
const vesselPinId = (vesselType: VesselType) => `rt-team-pin-vessel-${vesselType}`;
const waypointPinId = (waypointType: string) => `rt-team-pin-way-${teamWaypointKind(waypointType)}`;

/** Every pin image a feature's `icon` property can name. */
export const TEAM_PIN_IMAGES: { id: string; fill: string; emoji: string }[] = [
  ...(Object.keys(TEAM_BEACON_ICONS) as TeamBeaconKind[]).map((kind) => ({
    id: beaconPinId(kind),
    fill: TEAM_BEACON_FILL,
    emoji: TEAM_BEACON_ICONS[kind],
  })),
  ...TEAM_VESSEL_TYPES.map((type) => ({
    id: vesselPinId(type),
    fill: TEAM_BEACON_FILL,
    emoji: TEAM_VESSEL_ICONS[type],
  })),
  ...TEAM_WAYPOINT_TYPES.map((type) => ({
    id: waypointPinId(type),
    fill: TEAM_WAYPOINT_FILL,
    emoji: teamWaypointIcon(type),
  })),
];

const BEACON_SOURCE_ID = 'rt-team-beacons';
const TRAIL_SOURCE_ID = 'rt-team-trails';
const WAYPOINT_SOURCE_ID = 'rt-team-waypoints';
const ROUTE_SOURCE_ID = 'rt-team-routes';

const TRAIL_LAYER_ID = 'rt-team-trails';
const ROUTE_CASING_LAYER_ID = 'rt-team-routes-casing';
const ROUTE_LAYER_ID = 'rt-team-routes';
const TRAIL_DOT_LAYER_ID = 'rt-team-trail-dots';
const BEACON_PIN_LAYER_ID = 'rt-team-beacons';
const BEACON_LABEL_LAYER_ID = 'rt-team-beacons-label';
const WAYPOINT_PIN_LAYER_ID = 'rt-team-waypoints';
const WAYPOINT_LABEL_LAYER_ID = 'rt-team-waypoints-label';
const LAYER_IDS = [
  TRAIL_LAYER_ID,
  ROUTE_CASING_LAYER_ID,
  ROUTE_LAYER_ID,
  TRAIL_DOT_LAYER_ID,
  WAYPOINT_PIN_LAYER_ID,
  WAYPOINT_LABEL_LAYER_ID,
  BEACON_PIN_LAYER_ID,
  BEACON_LABEL_LAYER_ID,
];
const BEACON_CLICK_LAYERS = [BEACON_PIN_LAYER_ID, TRAIL_DOT_LAYER_ID];

/** One sender: by key when known, else by name, else the message itself. */
export function teamBeaconSenderId(beacon: TeamBeaconPoint): string {
  if (beacon.outgoing) return 'self';
  if (beacon.sender_key) return `key:${beacon.sender_key.toLowerCase()}`;
  if (beacon.sender_name) return `name:${beacon.sender_name.trim().toLowerCase()}`;
  return `msg:${beacon.message_id}`;
}

export function countTeamBeaconSenders(beacons: TeamBeaconPoint[]): number {
  return new Set(beacons.map(teamBeaconSenderId)).size;
}

/** Sender contact key (lower case) to its hand-set vessel type. */
export type VesselTypeLookup = ReadonlyMap<string, VesselType>;

/** The vessel type set on the contact that sent a beacon, if any. */
export function teamBeaconVesselType(
  beacon: TeamBeaconPoint,
  vesselTypes?: VesselTypeLookup
): VesselType | null {
  if (beacon.outgoing || !beacon.sender_key) return null;
  return vesselTypes?.get(beacon.sender_key.toLowerCase()) ?? null;
}

/**
 * Beacon points, newest first as given; `latest` marks each sender's newest.
 * The pin icon is the sender contact's vessel type when set, else the sender kind.
 */
export function buildTeamBeaconFeatures(
  beacons: TeamBeaconPoint[],
  ownName = '',
  vesselTypes?: VesselTypeLookup
) {
  const seen = new Set<string>();
  return {
    type: 'FeatureCollection' as const,
    features: beacons.map((beacon) => {
      const sender = teamBeaconSenderId(beacon);
      const latest = !seen.has(sender);
      seen.add(sender);
      const vesselType = teamBeaconVesselType(beacon, vesselTypes);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [beacon.lon, beacon.lat] },
        properties: {
          message_id: beacon.message_id,
          title: beacon.outgoing ? ownName : (beacon.sender_name ?? ''),
          icon: vesselType ? vesselPinId(vesselType) : beaconPinId(teamBeaconKind(beacon)),
          latest,
        },
      };
    }),
  };
}

/** One line per sender with two or more beacons, oldest to newest. */
export function buildTeamTrailFeatures(beacons: TeamBeaconPoint[]) {
  const bySender = new Map<string, [number, number][]>();
  for (const beacon of beacons) {
    const sender = teamBeaconSenderId(beacon);
    const points = bySender.get(sender) ?? [];
    points.push([beacon.lon, beacon.lat]);
    bySender.set(sender, points);
  }
  return {
    type: 'FeatureCollection' as const,
    features: [...bySender.entries()]
      .filter(([, points]) => points.length >= 2)
      .map(([sender, points]) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: [...points].reverse() },
        properties: { sender },
      })),
  };
}

export function buildTeamWaypointFeatures(waypoints: TeamWaypointPin[]) {
  return {
    type: 'FeatureCollection' as const,
    features: waypoints.map((waypoint) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [waypoint.lon, waypoint.lat] },
      properties: {
        message_id: waypoint.message_id,
        // The type icon is in the pin; map glyphs cannot draw emoji in the label.
        title: waypoint.name,
        icon: waypointPinId(waypoint.waypoint_type),
      },
    })),
  };
}

/** Route lines for waypoints whose route has two or more points. */
export function buildTeamRouteFeatures(waypoints: TeamWaypointPin[]) {
  return {
    type: 'FeatureCollection' as const,
    features: waypoints
      .filter((waypoint) => waypoint.route.length >= 2)
      .map((waypoint) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: waypoint.route.map(([lat, lon]) => [lon, lat]),
        },
        properties: { message_id: waypoint.message_id, color: waypoint.color },
      })),
  };
}

export interface TeamBeaconsLayerOptions {
  onBeaconClick?: (messageId: number) => void;
  onWaypointClick?: (messageId: number) => void;
}

export function createTeamBeaconsLayer(map: MlMap, opts: TeamBeaconsLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;
  let visible = false;
  let lastBeacons = buildTeamBeaconFeatures([]);
  let lastTrails = buildTeamTrailFeatures([]);
  let lastWaypoints = buildTeamWaypointFeatures([]);
  let lastRoutes = buildTeamRouteFeatures([]);

  function addImages() {
    for (const image of TEAM_PIN_IMAGES) {
      if (!m.hasImage(image.id)) {
        m.addImage(image.id, buildEmojiPinImage(image.fill, image.emoji), {
          pixelRatio: PIN_SCALE,
        });
      }
    }
  }

  function pinLayers(pinId: string, labelId: string, source: string) {
    const visibility = visible ? 'visible' : 'none';
    const latestOnly = source === BEACON_SOURCE_ID ? { filter: ['get', 'latest'] } : {};
    m.addLayer({
      id: pinId,
      type: 'symbol',
      source,
      ...latestOnly,
      layout: {
        visibility,
        'icon-image': ['get', 'icon'],
        'icon-size': PIN_ICON_SIZE,
        // The pin's tip marks the spot.
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    m.addLayer({
      id: labelId,
      type: 'symbol',
      source,
      ...latestOnly,
      layout: {
        visibility,
        'text-field': ['get', 'title'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-optional': true,
        // Single font: a multi-font stack 404s on the glyph servers (see
        // NODE_LABEL_FONT in nodesLayer.ts).
        'text-font': NODE_LABEL_FONT,
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#0f172a',
        'text-halo-width': 1.2,
      },
    });
  }

  function addSourceAndLayer() {
    // A basemap setStyle drops images too; re-add them before the layers.
    addImages();
    if (m.getSource(BEACON_SOURCE_ID)) return;
    const visibility = visible ? 'visible' : 'none';
    m.addSource(TRAIL_SOURCE_ID, { type: 'geojson', data: lastTrails });
    m.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: lastRoutes });
    m.addSource(WAYPOINT_SOURCE_ID, { type: 'geojson', data: lastWaypoints });
    m.addSource(BEACON_SOURCE_ID, { type: 'geojson', data: lastBeacons });
    m.addLayer({
      id: TRAIL_LAYER_ID,
      type: 'line',
      source: TRAIL_SOURCE_ID,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': TEAM_BEACON_FILL,
        'line-width': 2,
        'line-dasharray': [1, 2],
      },
    });
    // A light casing keeps a route readable on basemaps whose roads share its colour.
    m.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 },
    });
    m.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], TEAM_WAYPOINT_FILL],
        'line-width': 3,
      },
    });
    m.addLayer({
      id: TRAIL_DOT_LAYER_ID,
      type: 'circle',
      source: BEACON_SOURCE_ID,
      filter: ['!', ['get', 'latest']],
      layout: { visibility },
      paint: {
        'circle-radius': 4,
        'circle-color': TEAM_BEACON_FILL,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
    pinLayers(WAYPOINT_PIN_LAYER_ID, WAYPOINT_LABEL_LAYER_ID, WAYPOINT_SOURCE_ID);
    pinLayers(BEACON_PIN_LAYER_ID, BEACON_LABEL_LAYER_ID, BEACON_SOURCE_ID);
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    const bind = (layerId: string, handler?: (messageId: number) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', layerId, (e: any) => {
        const props = e.features?.[0]?.properties;
        if (props && handler) handler(Number(props.message_id));
      });
      m.on('mouseenter', layerId, () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', layerId, () => {
        m.getCanvas().style.cursor = '';
      });
    };
    for (const layerId of BEACON_CLICK_LAYERS) bind(layerId, opts.onBeaconClick);
    bind(WAYPOINT_PIN_LAYER_ID, opts.onWaypointClick);
  }

  function setData(
    beacons: TeamBeaconPoint[],
    waypoints: TeamWaypointPin[],
    ownName = '',
    vesselTypes?: VesselTypeLookup
  ) {
    lastBeacons = buildTeamBeaconFeatures(beacons, ownName, vesselTypes);
    lastTrails = buildTeamTrailFeatures(beacons);
    lastWaypoints = buildTeamWaypointFeatures(waypoints);
    lastRoutes = buildTeamRouteFeatures(waypoints);
    m.getSource(BEACON_SOURCE_ID)?.setData(lastBeacons);
    m.getSource(TRAIL_SOURCE_ID)?.setData(lastTrails);
    m.getSource(WAYPOINT_SOURCE_ID)?.setData(lastWaypoints);
    m.getSource(ROUTE_SOURCE_ID)?.setData(lastRoutes);
  }

  function setVisible(on: boolean) {
    visible = on;
    for (const id of LAYER_IDS) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    // A basemap setStyle drops custom sources/layers; re-add them with the last data.
    addSourceAndLayer();
  }

  return { ensure, reattach, setData, setVisible };
}
