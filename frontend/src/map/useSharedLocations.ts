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
import type { DistanceUnit } from '../utils/distanceUnits';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import { createSharedLocationsLayer, sharedLocationTitle } from './layers/sharedLocationsLayer';
import {
  appendContactDetailsLink,
  appendDistanceAndHops,
  appendPopupActions,
  appendPopupLine,
  knownContactKey,
} from './locationPopup';

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
  return knownContactKey(loc.type === 'PRIV' ? loc.conversation_key : loc.sender_key, contacts);
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

  const line = (text: string, className?: string) => appendPopupLine(el, text, className);

  line(sharedLocationTitle(loc, ownName) || t('map_shared_location'), 'font-medium');

  const sender = loc.outgoing
    ? t('map_shared_locations_you')
    : loc.sender_name || loc.conversation_name || t('map_shared_locations_unknown_sender');
  const fromLine = line(t('map_shared_locations_from', { sender }));
  const senderKey = senderContactKey(loc, deps.contacts);
  if (senderKey) appendContactDetailsLink(fromLine, senderKey, deps);
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

  appendDistanceAndHops(el, loc, deps);
  appendPopupActions(
    el,
    loc,
    {
      id: loc.message_id,
      type: loc.type,
      conversation_key: loc.conversation_key,
      conversation_name: loc.conversation_name || loc.conversation_key.slice(0, 12),
    },
    deps
  );
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
