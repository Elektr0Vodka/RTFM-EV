// Map "Trackers" layer: ATAK users (TAK-MESHCORE positions), MeshCore SAR
// fast-GPS beacons and the map objects ATAK users shared, fetched for the map's
// time window and kept up to date from the WS `tracker` event. Each tracker's
// newest fix is a dot; with trails on, its older fixes form a track.
//
// Local view only: this reads GET /trackers and never forwards anything. MapView
// owns the toggles; this hook owns fetch, layer and popup.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { TrackerObject, TrackerPosition } from '../types';
import { useT, type TFn } from '../i18n';
import { formatTime } from '../utils/messageParser';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import { subscribeTrackerEvents } from '../utils/trackerEvents';
import { countTrackers, createTrackersLayer, trackerId } from './layers/trackersLayer';
import { appendPopupLine } from './locationPopup';

const FETCH_DEBOUNCE_MS = 300;
const COORDS_LINE = 'text-xs text-muted-foreground/80 mt-1 font-mono select-all';

export interface UseTrackersOptions {
  enabled: boolean;
  /** Fetch every fix in the window (to draw tracks), not just the newest per tracker. */
  trails: boolean;
  /** Window lower bound (exclusive), Unix seconds; null = no bound. */
  since: number | null;
  /** Window upper bound (inclusive), Unix seconds; null = now. */
  until: number | null;
  coordinateFormat: CoordinateFormat;
}

const TRACKER_SOURCE_KEYS: Record<TrackerPosition['source'], string> = {
  atak: 'tracker_popup_source_atak',
  sar_fast_gps: 'tracker_popup_source_sar',
  meshcoreng: 'tracker_popup_source_meshcoreng',
};

/** DOM body of a tracker popup. `trailCount` is that tracker's fixes on the map. */
export function buildTrackerPopup(
  p: TrackerPosition,
  deps: { t: TFn; coordinateFormat: CoordinateFormat; trailCount: number }
): HTMLElement {
  const { t } = deps;
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';
  appendPopupLine(el, p.display_name || p.identity, 'font-medium');
  appendPopupLine(el, t(TRACKER_SOURCE_KEYS[p.source]));
  if (p.team) appendPopupLine(el, t('tracker_popup_team', { team: p.team }));
  if (p.speed_mps != null) {
    appendPopupLine(el, t('tracker_popup_speed', { kmh: (p.speed_mps * 3.6).toFixed(1) }));
  }
  if (p.battery_pct != null) {
    appendPopupLine(el, t('tracker_popup_battery', { pct: p.battery_pct }));
  }
  appendPopupLine(el, t('tracker_popup_heard', { time: formatTime(p.received_at) }));
  appendPopupLine(el, formatCoordinates(p.lat, p.lon, deps.coordinateFormat, 6), COORDS_LINE);
  if (deps.trailCount > 1) {
    appendPopupLine(el, t('map_beacons_trail_points', { count: deps.trailCount }));
  }
  return el;
}

/** DOM body of an ATAK map object popup. */
export function buildTrackerObjectPopup(
  o: TrackerObject,
  deps: { t: TFn; coordinateFormat: CoordinateFormat }
): HTMLElement {
  const { t } = deps;
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';
  appendPopupLine(el, o.callsign || o.uid, 'font-medium');
  appendPopupLine(el, t('tracker_popup_object', { type: o.cot_type }));
  if (o.remarks) appendPopupLine(el, o.remarks, 'text-xs');
  if (o.sender) appendPopupLine(el, t('tracker_popup_shared_by', { sender: o.sender }));
  appendPopupLine(el, t('tracker_popup_heard', { time: formatTime(o.received_at) }));
  appendPopupLine(el, formatCoordinates(o.lat, o.lon, deps.coordinateFormat, 6), COORDS_LINE);
  return el;
}

/** The most fixes the server returns per request (POSITION_LIMIT in app/routers/trackers.py). */
export const TRACKER_POSITION_LIMIT = 5000;

/**
 * Add a live fix to the list (newest first) the way a refetch would show it:
 * fixes at or before `since` leave the window and the list stays within `limit`,
 * so a tab left open through a long exercise does not grow without end.
 */
export function mergeTrackerPosition(
  positions: TrackerPosition[],
  p: TrackerPosition,
  trails: boolean,
  since: number | null,
  limit = TRACKER_POSITION_LIMIT
): TrackerPosition[] {
  const key = trackerId(p);
  const rest = trails ? positions : positions.filter((x) => trackerId(x) !== key);
  const inWindow = since == null ? rest : rest.filter((x) => x.received_at > since);
  return [p, ...inWindow].slice(0, limit);
}

export function useTrackers(opts: UseTrackersOptions) {
  const t = useT();
  const [positions, setPositions] = useState<TrackerPosition[]>([]);
  const [objects, setObjects] = useState<TrackerObject[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const layerRef = useRef<ReturnType<typeof createTrackersLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const positionsRef = useRef<TrackerPosition[]>([]);
  const objectsRef = useRef<TrackerObject[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, trails, since, until } = opts;

  useEffect(() => {
    if (!enabled) {
      setPositions([]);
      setObjects([]);
      setTruncated(false);
      setCounts({});
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .getTrackers(
          {
            since: since != null ? Math.floor(since) : undefined,
            until: until != null ? Math.floor(until) : undefined,
            latestPerIdentity: !trails,
          },
          controller.signal
        )
        .then((res) => {
          setPositions(res.positions);
          setObjects(res.objects);
          setTruncated(res.truncated);
          setCounts(res.counts ?? {});
        })
        .catch((err) => {
          if (!isAbortError(err)) console.error('Failed to load trackers:', err);
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, trails, since, until]);

  // Live updates while the window is open-ended (ends "now").
  useEffect(() => {
    if (!enabled || until != null) return;
    return subscribeTrackerEvents((event) => {
      if (event.kind === 'position') {
        setPositions((current) => mergeTrackerPosition(current, event.data, trails, since));
      } else {
        setObjects((current) => [event.data, ...current.filter((o) => o.uid !== event.data.uid)]);
      }
    });
  }, [enabled, trails, since, until]);

  const showPopup = useCallback((lat: number, lon: number, body: HTMLElement) => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();
    const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '300px' });
    popupRef.current = popup.setLngLat([lon, lat]).setDOMContent(body).addTo(map);
  }, []);

  const openTrackerPopup = useCallback(
    (key: string, fixId: number) => {
      const fixes = positionsRef.current.filter((p) => trackerId(p) === key);
      const fix = fixes.find((p) => (p.id ?? p.received_at) === fixId) ?? fixes[0];
      if (!fix) return;
      showPopup(
        fix.lat,
        fix.lon,
        buildTrackerPopup(fix, {
          t: tRef.current,
          coordinateFormat: optsRef.current.coordinateFormat,
          trailCount: fixes.length,
        })
      );
    },
    [showPopup]
  );

  const openObjectPopup = useCallback(
    (uid: string) => {
      const obj = objectsRef.current.find((o) => o.uid === uid);
      if (!obj) return;
      showPopup(
        obj.lat,
        obj.lon,
        buildTrackerObjectPopup(obj, {
          t: tRef.current,
          coordinateFormat: optsRef.current.coordinateFormat,
        })
      );
    },
    [showPopup]
  );

  useEffect(() => {
    positionsRef.current = positions;
    objectsRef.current = objects;
    layerRef.current?.setData(positions, objects);
  }, [positions, objects]);
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
      const layer = createTrackersLayer(map, {
        onTrackerClick: openTrackerPopup,
        onObjectClick: openObjectPopup,
      });
      layer.ensure();
      layer.setData(positionsRef.current, objectsRef.current);
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
    },
    [openTrackerPopup, openObjectPopup]
  );

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(positionsRef.current, objectsRef.current);
    layer.setVisible(optsRef.current.enabled);
  }, []);

  const trackerCount = useMemo(() => countTrackers(positions), [positions]);

  return { attach, reattach, trackerCount, objectCount: objects.length, truncated, counts };
}
