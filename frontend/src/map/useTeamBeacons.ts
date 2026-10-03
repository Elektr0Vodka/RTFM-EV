// Map "Beacons" layer: MeshCore TEAM position beacons (#TEL: / #T:) and
// waypoints (#WAY:) from followed channels, fetched for the map's time window.
// Each sender's newest beacon is a pin; with trails on, its older beacons in
// the window are drawn as a track. Clicking a pin opens a popup.
//
// Local view only: this reads GET /messages/beacons and never forwards
// anything. MapView owns the toggles; this hook owns fetch, layer and popup.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { SearchNavigateTarget } from '../components/SearchView';
import type { Contact, RadioConfig, TeamBeaconPoint, TeamWaypointPin, VesselType } from '../types';
import { useT, type TFn } from '../i18n';
import { formatTime } from '../utils/messageParser';
import type { DistanceUnit } from '../utils/distanceUnits';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import { teamBeaconIcon, teamWaypointIcon } from '../utils/teamPayloads';
import {
  teamBeaconDetails,
  teamBeaconStatus,
  teamWaypointTypeName,
} from '../utils/teamPayloadText';
import {
  countTeamBeaconSenders,
  createTeamBeaconsLayer,
  teamBeaconSenderId,
  teamBeaconVesselType,
  type VesselTypeLookup,
} from './layers/teamBeaconsLayer';
import {
  appendContactDetailsLink,
  appendDistanceAndHops,
  appendPopupActions,
  appendPopupLine,
  knownContactKey,
} from './locationPopup';

const FETCH_DEBOUNCE_MS = 300;
const COORDS_LINE = 'text-xs text-muted-foreground/80 mt-1 font-mono select-all';

export interface UseTeamBeaconsOptions {
  enabled: boolean;
  /** Fetch every beacon in the window (to draw tracks), not just the newest per sender. */
  trails: boolean;
  /** Window lower bound (exclusive), Unix seconds; null = no bound. */
  since: number | null;
  /** Window upper bound (inclusive), Unix seconds; null = now. */
  until: number | null;
  contacts: Contact[];
  config: RadioConfig | null | undefined;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
  onNavigateToMessage?: (target: SearchNavigateTarget) => void;
  onOpenContactInfo?: (publicKey: string) => void;
}

export interface TeamBeaconPopupDeps {
  t: TFn;
  contacts: Contact[];
  config: RadioConfig | null | undefined;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
  onNavigateToMessage?: (target: SearchNavigateTarget) => void;
  onOpenContactInfo?: (publicKey: string) => void;
  onAction?: () => void;
}

type ChannelPin = TeamBeaconPoint | TeamWaypointPin;

/** Vessel types set by hand on contacts, by lower-case key. */
export function vesselTypeLookup(contacts: Contact[]): VesselTypeLookup {
  const lookup = new Map<string, VesselType>();
  for (const contact of contacts) {
    if (contact.vessel_type) lookup.set(contact.public_key.toLowerCase(), contact.vessel_type);
  }
  return lookup;
}

function senderName(pin: ChannelPin, t: TFn): string {
  if (pin.outgoing) return t('map_shared_locations_you');
  return pin.sender_name || t('map_shared_locations_unknown_sender');
}

function channelName(pin: ChannelPin): string {
  return pin.conversation_name || pin.conversation_key.slice(0, 12);
}

function navigateTarget(pin: ChannelPin): SearchNavigateTarget {
  return {
    id: pin.message_id,
    type: 'CHAN',
    conversation_key: pin.conversation_key,
    conversation_name: channelName(pin),
  };
}

function appendSenderLine(
  el: HTMLElement,
  text: string,
  pin: ChannelPin,
  deps: TeamBeaconPopupDeps
) {
  const line = appendPopupLine(el, text);
  const contactKey = pin.outgoing ? null : knownContactKey(pin.sender_key, deps.contacts);
  if (contactKey) appendContactDetailsLink(line, contactKey, deps);
}

/** DOM body of a beacon popup. `trailCount` is that sender's beacons on the map. */
export function buildTeamBeaconPopup(
  beacon: TeamBeaconPoint,
  deps: TeamBeaconPopupDeps & { trailCount: number }
): HTMLElement {
  const { t } = deps;
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';

  const vesselType = teamBeaconVesselType(beacon, vesselTypeLookup(deps.contacts));
  const kind = t(beacon.kind === 'topology' ? 'team_topology_beacon' : 'team_beacon');
  appendPopupLine(el, `${teamBeaconIcon(beacon, vesselType)} ${kind}`, 'font-medium');
  if (vesselType) appendPopupLine(el, t(`vessel_type_${vesselType}`));
  appendSenderLine(el, t('map_beacons_from', { sender: senderName(beacon, t) }), beacon, deps);
  appendPopupLine(el, t('map_shared_locations_in_channel', { name: channelName(beacon) }));
  appendPopupLine(el, t('map_shared_locations_received', { time: formatTime(beacon.received_at) }));
  appendPopupLine(
    el,
    formatCoordinates(beacon.lat, beacon.lon, deps.coordinateFormat, 6),
    COORDS_LINE
  );
  for (const detail of teamBeaconDetails(teamBeaconStatus(beacon), t)) appendPopupLine(el, detail);
  if (deps.trailCount > 1) {
    appendPopupLine(el, t('map_beacons_trail_points', { count: deps.trailCount }));
  }
  appendDistanceAndHops(el, beacon, deps);
  appendPopupActions(el, beacon, navigateTarget(beacon), deps);
  return el;
}

/** DOM body of a waypoint popup. */
export function buildTeamWaypointPopup(
  waypoint: TeamWaypointPin,
  deps: TeamBeaconPopupDeps
): HTMLElement {
  const { t } = deps;
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';

  appendPopupLine(
    el,
    `${teamWaypointIcon(waypoint.waypoint_type)} ${waypoint.name}`,
    'font-medium'
  );
  appendPopupLine(el, teamWaypointTypeName(waypoint.waypoint_type, t));
  if (waypoint.description) appendPopupLine(el, waypoint.description, 'text-xs');
  appendSenderLine(
    el,
    t('map_beacons_waypoint_from', { sender: senderName(waypoint, t) }),
    waypoint,
    deps
  );
  appendPopupLine(el, t('map_shared_locations_in_channel', { name: channelName(waypoint) }));
  appendPopupLine(
    el,
    t('map_shared_locations_received', { time: formatTime(waypoint.received_at) })
  );
  appendPopupLine(
    el,
    formatCoordinates(waypoint.lat, waypoint.lon, deps.coordinateFormat, 6),
    COORDS_LINE
  );
  if (!waypoint.route_complete) {
    appendPopupLine(el, t('team_route_incomplete'));
  } else if (waypoint.route.length >= 2) {
    appendPopupLine(el, t('team_route_points', { count: waypoint.route.length }));
  }
  appendDistanceAndHops(el, waypoint, deps);
  appendPopupActions(el, waypoint, navigateTarget(waypoint), deps);
  return el;
}

export function useTeamBeacons(opts: UseTeamBeaconsOptions) {
  const t = useT();
  const [beacons, setBeacons] = useState<TeamBeaconPoint[]>([]);
  const [waypoints, setWaypoints] = useState<TeamWaypointPin[]>([]);
  const [truncated, setTruncated] = useState(false);
  const layerRef = useRef<ReturnType<typeof createTeamBeaconsLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const beaconsRef = useRef<TeamBeaconPoint[]>([]);
  const waypointsRef = useRef<TeamWaypointPin[]>([]);
  // Latest options for the click handlers, which the layer binds once.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, trails, since, until } = opts;

  // Contacts change often (every advert); only a changed vessel type repaints the pins.
  const vesselSignature = opts.contacts
    .filter((c) => c.vessel_type)
    .map((c) => `${c.public_key.toLowerCase()}:${c.vessel_type}`)
    .join('|');
  const vesselTypes = useMemo(
    () => vesselTypeLookup(optsRef.current.contacts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vesselSignature]
  );
  const vesselTypesRef = useRef(vesselTypes);
  vesselTypesRef.current = vesselTypes;

  useEffect(() => {
    if (!enabled) {
      setBeacons([]);
      setWaypoints([]);
      setTruncated(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // The map's preset window is fractional seconds; the API takes integers.
      // received_at is whole seconds, so flooring keeps (since, until] exact.
      api
        .getTeamBeacons(
          {
            since: since != null ? Math.floor(since) : undefined,
            until: until != null ? Math.floor(until) : undefined,
            latestPerSender: !trails,
          },
          controller.signal
        )
        .then((res) => {
          setBeacons(res.beacons);
          setWaypoints(res.waypoints);
          setTruncated(res.truncated);
        })
        .catch((err) => {
          if (!isAbortError(err)) console.error('Failed to load TEAM beacons:', err);
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, trails, since, until]);

  const showPopup = useCallback(
    (lat: number, lon: number, build: (popup: MlPopup) => HTMLElement) => {
      const map = mapRef.current;
      if (!map) return;
      popupRef.current?.remove();
      const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '300px' });
      popupRef.current = popup.setLngLat([lon, lat]).setDOMContent(build(popup)).addTo(map);
    },
    []
  );

  const popupDeps = useCallback((popup: MlPopup): TeamBeaconPopupDeps => {
    const o = optsRef.current;
    return {
      t: tRef.current,
      contacts: o.contacts,
      config: o.config,
      distanceUnit: o.distanceUnit,
      coordinateFormat: o.coordinateFormat,
      onNavigateToMessage: o.onNavigateToMessage,
      onOpenContactInfo: o.onOpenContactInfo,
      onAction: () => popup.remove(),
    };
  }, []);

  const openBeaconPopup = useCallback(
    (messageId: number) => {
      const beacon = beaconsRef.current.find((b) => b.message_id === messageId);
      if (!beacon) return;
      const sender = teamBeaconSenderId(beacon);
      const trailCount = beaconsRef.current.filter((b) => teamBeaconSenderId(b) === sender).length;
      showPopup(beacon.lat, beacon.lon, (popup) =>
        buildTeamBeaconPopup(beacon, { ...popupDeps(popup), trailCount })
      );
    },
    [showPopup, popupDeps]
  );

  const openWaypointPopup = useCallback(
    (messageId: number) => {
      const waypoint = waypointsRef.current.find((w) => w.message_id === messageId);
      if (!waypoint) return;
      showPopup(waypoint.lat, waypoint.lon, (popup) =>
        buildTeamWaypointPopup(waypoint, popupDeps(popup))
      );
    },
    [showPopup, popupDeps]
  );

  // Push data and visibility to the layer.
  useEffect(() => {
    beaconsRef.current = beacons;
    waypointsRef.current = waypoints;
    layerRef.current?.setData(beacons, waypoints, opts.config?.name ?? '', vesselTypes);
  }, [beacons, waypoints, opts.config?.name, vesselTypes]);
  useEffect(() => {
    layerRef.current?.setVisible(enabled);
    if (!enabled) popupRef.current?.remove();
  }, [enabled]);

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    []
  );

  /** Create the layer on a ready map (call from MapView's handleReady). */
  const attach = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const layer = createTeamBeaconsLayer(map, {
        onBeaconClick: openBeaconPopup,
        onWaypointClick: openWaypointPopup,
      });
      layer.ensure();
      layer.setData(
        beaconsRef.current,
        waypointsRef.current,
        optsRef.current.config?.name ?? '',
        vesselTypesRef.current
      );
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
    },
    [openBeaconPopup, openWaypointPopup]
  );

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(
      beaconsRef.current,
      waypointsRef.current,
      optsRef.current.config?.name ?? '',
      vesselTypesRef.current
    );
    layer.setVisible(optsRef.current.enabled);
  }, []);

  const senderCount = useMemo(() => countTeamBeaconSenders(beacons), [beacons]);

  return { attach, reattach, senderCount, waypointCount: waypoints.length, truncated };
}
