// Map "shared locations" layer: location shares from chat (DMs and channels),
// fetched for the map's time window and drawn as pins. Clicking a pin opens a
// popup with who shared it, where, when, and a jump back to the message.
//
// Local view only: this reads GET /messages/locations and never forwards
// anything. MapView owns the toggles; this hook owns fetch, layer and popup.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { SearchNavigateTarget } from '../components/SearchView';
import type { Contact, RadioConfig, SharedLocation } from '../types';
import { useT } from '../i18n';
import { formatTime } from '../utils/messageParser';
import { calculateDistance, formatDistance, isValidLocation } from '../utils/pathUtils';
import type { DistanceUnit } from '../utils/distanceUnits';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import { createSharedLocationsLayer, sharedLocationTitle } from './layers/sharedLocationsLayer';

const FETCH_DEBOUNCE_MS = 300;

const FORMAT_KEYS: Record<SharedLocation['format'], string> = {
  marker: 'map_shared_locations_format_marker',
  mgrs: 'map_shared_locations_format_mgrs',
  decimal: 'map_shared_locations_format_decimal',
};

export interface UseSharedLocationsOptions {
  enabled: boolean;
  latestPerSender: boolean;
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

type Translate = ReturnType<typeof useT>;

function hopCount(loc: SharedLocation): number | null {
  const counts = (loc.paths ?? [])
    .map((p) => (p.path_len != null ? p.path_len : Math.floor(p.path.length / 2)))
    .filter((n) => Number.isFinite(n));
  return counts.length ? Math.min(...counts) : null;
}

function precisionLabel(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

function conversationLabel(loc: SharedLocation, t: Translate): string {
  const name = loc.conversation_name || loc.conversation_key.slice(0, 12);
  return loc.type === 'CHAN'
    ? t('map_shared_locations_in_channel', { name })
    : t('map_shared_locations_in_dm', { name });
}

/** Contact key of whoever sent the share, when it is a known contact. */
function senderContactKey(loc: SharedLocation, contacts: Contact[]): string | null {
  if (loc.outgoing) return null;
  const key = (loc.type === 'PRIV' ? loc.conversation_key : loc.sender_key)?.toLowerCase();
  if (!key) return null;
  return contacts.some((c) => c.public_key.toLowerCase() === key) ? key : null;
}

export interface SharedLocationPopupDeps {
  t: Translate;
  contacts: Contact[];
  config: RadioConfig | null | undefined;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
  onNavigateToMessage?: (target: SearchNavigateTarget) => void;
  onOpenContactInfo?: (publicKey: string) => void;
  onAction?: () => void;
}

/** DOM body of a shared-location popup. Exported for unit testing. */
export function buildSharedLocationPopup(
  loc: SharedLocation,
  deps: SharedLocationPopupDeps
): HTMLElement {
  const { t } = deps;
  const ownName = deps.config?.name ?? '';
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';

  const line = (text: string, className = 'text-xs text-muted-foreground') => {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    el.append(div);
    return div;
  };

  line(sharedLocationTitle(loc, ownName) || t('map_shared_location'), 'font-medium');

  const sender = loc.outgoing
    ? t('map_shared_locations_you')
    : loc.sender_name || loc.conversation_name || t('map_shared_locations_unknown_sender');
  const fromLine = line(t('map_shared_locations_from', { sender }));
  const senderKey = senderContactKey(loc, deps.contacts);
  if (senderKey && deps.onOpenContactInfo) {
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'ml-1 text-primary underline hover:text-primary/80';
    details.textContent = t('map_node_details');
    details.addEventListener('click', () => {
      deps.onOpenContactInfo?.(senderKey);
      deps.onAction?.();
    });
    fromLine.append(details);
  }
  line(conversationLabel(loc, t));
  line(t('map_shared_locations_received', { time: formatTime(loc.received_at) }));

  line(
    formatCoordinates(loc.lat, loc.lon, deps.coordinateFormat, 6),
    'text-xs text-muted-foreground/80 mt-1 font-mono select-all'
  );
  if (loc.format === 'mgrs') {
    line(
      t('map_shared_locations_as_sent', { text: loc.raw }),
      'text-xs text-muted-foreground font-mono'
    );
    if (loc.precision_m != null) {
      line(t('map_shared_locations_grid_square', { size: precisionLabel(loc.precision_m) }));
    }
  }
  line(t(FORMAT_KEYS[loc.format]));

  const own = deps.config;
  if (own && isValidLocation(own.lat, own.lon)) {
    const km = calculateDistance(own.lat, own.lon, loc.lat, loc.lon);
    if (km != null) {
      line(t('map_shared_locations_distance', { distance: formatDistance(km, deps.distanceUnit) }));
    }
  }
  const hops = hopCount(loc);
  if (hops != null) {
    line(
      hops === 0
        ? t('map_shared_locations_direct')
        : t('map_shared_locations_hops', { count: hops })
    );
  }

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap gap-3 pt-1';
  if (deps.onNavigateToMessage) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'text-xs text-primary underline hover:text-primary/80';
    open.textContent = t('map_shared_locations_open_in_chat');
    open.addEventListener('click', () => {
      deps.onNavigateToMessage?.({
        id: loc.message_id,
        type: loc.type,
        conversation_key: loc.conversation_key,
        conversation_name: loc.conversation_name || loc.conversation_key.slice(0, 12),
      });
      deps.onAction?.();
    });
    actions.append(open);
  }
  const external = document.createElement('a');
  external.className = 'text-xs text-primary underline hover:text-primary/80';
  external.href = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=16/${loc.lat}/${loc.lon}`;
  external.target = '_blank';
  external.rel = 'noopener noreferrer';
  external.textContent = t('map_shared_locations_open_osm');
  actions.append(external);
  el.append(actions);
  return el;
}

export function useSharedLocations(opts: UseSharedLocationsOptions) {
  const t = useT();
  const [locations, setLocations] = useState<SharedLocation[]>([]);
  const [truncated, setTruncated] = useState(false);
  const layerRef = useRef<ReturnType<typeof createSharedLocationsLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const locationsRef = useRef<SharedLocation[]>([]);
  // Latest options for the click handler, which the layer binds once.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, latestPerSender, since, until } = opts;

  useEffect(() => {
    if (!enabled) {
      setLocations([]);
      setTruncated(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // The map's preset window is fractional seconds; the API takes integers.
      // received_at is whole seconds, so flooring keeps (since, until] exact.
      api
        .getSharedLocations(
          {
            since: since != null ? Math.floor(since) : undefined,
            until: until != null ? Math.floor(until) : undefined,
            latestPerSender,
          },
          controller.signal
        )
        .then((res) => {
          setLocations(res.locations);
          setTruncated(res.truncated);
        })
        .catch((err) => {
          if (!isAbortError(err)) console.error('Failed to load shared locations:', err);
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, latestPerSender, since, until]);

  const openPopup = useCallback((messageId: number) => {
    const map = mapRef.current;
    const loc = locationsRef.current.find((l) => l.message_id === messageId);
    if (!map || !loc) return;
    const o = optsRef.current;
    popupRef.current?.remove();
    const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '300px' });
    const el = buildSharedLocationPopup(loc, {
      t: tRef.current,
      contacts: o.contacts,
      config: o.config,
      distanceUnit: o.distanceUnit,
      coordinateFormat: o.coordinateFormat,
      onNavigateToMessage: o.onNavigateToMessage,
      onOpenContactInfo: o.onOpenContactInfo,
      onAction: () => popup.remove(),
    });
    popupRef.current = popup.setLngLat([loc.lon, loc.lat]).setDOMContent(el).addTo(map);
  }, []);

  // Push data and visibility to the layer.
  useEffect(() => {
    locationsRef.current = locations;
    layerRef.current?.setData(locations, opts.config?.name ?? '');
  }, [locations, opts.config?.name]);
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
      const layer = createSharedLocationsLayer(map, { onClick: openPopup });
      layer.ensure();
      layer.setData(locationsRef.current, optsRef.current.config?.name ?? '');
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
    },
    [openPopup]
  );

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(locationsRef.current, optsRef.current.config?.name ?? '');
    layer.setVisible(optsRef.current.enabled);
  }, []);

  return { attach, reattach, locations, truncated };
}
