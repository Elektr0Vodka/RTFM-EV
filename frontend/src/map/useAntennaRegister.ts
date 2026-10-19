// Map "antenna register" layer: registered transmitters from the Dutch
// Antenneregister next to the chosen LoRa mesh band (868: 700/800/900 MHz
// mobile masts; 433: 400-470 MHz PAMR / base stations and licensed amateur
// stations), so a strong one close to a node can desensitise it.
//
// Reads the backend cache (GET /antenna-register/sites), which is only filled
// by a manual sync in Settings. MapView owns the toggles; this hook owns fetch,
// the GL dot layer, the deck.gl masts + patterns and the popup.
//
// Speed: the site list is cached at module level (it survives toggles and map
// remounts) and only refetched when the backend's last sync time changed.
// Toggling is a visibility change and the band is a filter, so no new data
// goes to MapLibre for either.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { TFn } from '../i18n';
import type { AntennaRegisterSite, AntennaRegisterSiteSummary, RadioConfig } from '../types';
import type { DistanceUnit } from '../utils/distanceUnits';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import { calculateDistance, formatDistance, isValidLocation } from '../utils/pathUtils';
import { useT } from '../i18n';
import {
  ANTENNA_BAND_GROUPS,
  createAntennaRegisterLayer,
  sitesForBand,
  type AntennaBand,
} from './layers/antennaRegisterLayer';
import {
  createAntennaDeckOverlay,
  EMPTY_ANTENNA_DECK_STATE,
  type AntennaDeckState,
} from './layers/antennaDeckLayer';
import { buildPatternPolygons, centreMhz, freeSpaceReachM } from './antennaPatterns';
import { appendPopupLine } from './locationPopup';

export interface AntennaPatternOptions {
  enabled: boolean;
  /** Patterns are fetched and drawn from this map zoom up. */
  minZoom: number;
  /** Received level (dBm) the wedge edge marks. */
  levelDbm: number;
}

export interface UseAntennaRegisterOptions {
  enabled: boolean;
  band: AntennaBand;
  /** 3D buildings on: draw masts at their registered height, patterns at antenna height. */
  buildings3D: boolean;
  patterns: AntennaPatternOptions;
  config: RadioConfig | null | undefined;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
}

export interface AntennaSitePopupDeps {
  t: TFn;
  /** Mesh band shown on the map: only that band's transmitters are listed. */
  band: AntennaBand;
  config: RadioConfig | null | undefined;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
  /** When set, each transmitter also gets its free-space reach to this level. */
  levelDbm?: number | null;
}

const num = (v: number | null) => (v == null ? '?' : v.toLocaleString(undefined));

/** DOM body of an antenna-site popup. Exported for unit testing. */
export function buildAntennaSitePopup(
  site: AntennaRegisterSite,
  deps: AntennaSitePopupDeps
): HTMLElement {
  const { t } = deps;
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';
  const line = (text: string, className?: string) => appendPopupLine(el, text, className);

  line(t('map_antennas_site_title'), 'font-medium');
  const where = [site.place || site.municipality, site.postcode].filter(Boolean).join(' ');
  if (where) line(where);
  const own = deps.config;
  if (own && isValidLocation(own.lat, own.lon)) {
    const km = calculateDistance(own.lat, own.lon, site.lat, site.lon);
    if (km != null) {
      line(t('map_shared_locations_distance', { distance: formatDistance(km, deps.distanceUnit) }));
    }
  }

  const group = ANTENNA_BAND_GROUPS[deps.band];
  for (const tx of site.transmitters.filter((x) => group.includes(x.band))) {
    const directions = tx.bearings_deg.length
      ? tx.bearings_deg.map((b) => `${Math.round(b)}°`).join(', ')
      : t('map_antennas_omni');
    line(`${tx.system} ${tx.frequency}`, 'text-xs font-medium mt-1');
    line(
      t('map_antennas_tx_detail', {
        sectors: tx.sectors,
        directions:
          tx.omni && tx.bearings_deg.length
            ? `${directions}, ${t('map_antennas_omni')}`
            : directions,
        height: num(tx.height_m),
        power: num(tx.power_dbw),
      })
    );
    const freq = centreMhz(tx.frequency);
    if (deps.levelDbm != null && tx.power_dbw != null && freq != null) {
      const km = freeSpaceReachM(tx.power_dbw, freq, deps.levelDbm) / 1000;
      line(
        t('map_antennas_tx_reach', {
          level: deps.levelDbm,
          distance: formatDistance(km, deps.distanceUnit),
        })
      );
    }
  }

  if (deps.band === '433' && site.bands.includes('amateur')) {
    line(t('map_antennas_amateur'), 'text-xs font-medium mt-1');
    line(t('map_antennas_amateur_detail'));
  }

  line(
    formatCoordinates(site.lat, site.lon, deps.coordinateFormat, 5),
    'text-xs text-muted-foreground/80 mt-1 font-mono select-all'
  );
  line(t('map_antennas_source'), 'text-[0.6875rem] text-muted-foreground mt-1');
  return el;
}

// Site list cache shared by every mount: the register only changes on a sync.
let siteCache: { syncedAt: number | null; sites: AntennaRegisterSiteSummary[] } | null = null;

/** Test hook: forget the cached site list. */
export function resetAntennaSiteCache(): void {
  siteCache = null;
}

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface View extends Box {
  zoom: number;
}

const PATTERN_FETCH_DEBOUNCE_MS = 250;
// The pattern fetch covers the view plus this fraction on every side, so small
// pans reuse it and wedges of sites just off-screen still reach in.
const PATTERN_BOX_PAD = 0.25;

const padBox = (b: Box): Box => {
  const dx = (b.east - b.west) * PATTERN_BOX_PAD;
  const dy = (b.north - b.south) * PATTERN_BOX_PAD;
  return { west: b.west - dx, south: b.south - dy, east: b.east + dx, north: b.north + dy };
};
const contains = (outer: Box, inner: Box) =>
  inner.west >= outer.west &&
  inner.east <= outer.east &&
  inner.south >= outer.south &&
  inner.north <= outer.north;

export function useAntennaRegister(opts: UseAntennaRegisterOptions) {
  const t = useT();
  const [sites, setSites] = useState<AntennaRegisterSiteSummary[]>(() => siteCache?.sites ?? []);
  const [loaded, setLoaded] = useState(() => siteCache != null);
  const [syncedAt, setSyncedAt] = useState<number | null>(() => siteCache?.syncedAt ?? null);
  const [view, setView] = useState<View | null>(null);
  const [patternSites, setPatternSites] = useState<AntennaRegisterSite[]>([]);
  const [patternsTruncated, setPatternsTruncated] = useState(false);
  // Site whose popup is open; its wedges are drawn emphasised.
  const [selectedSite, setSelectedSite] = useState<AntennaRegisterSite | null>(null);
  const layerRef = useRef<ReturnType<typeof createAntennaRegisterLayer> | null>(null);
  const deckRef = useRef<ReturnType<typeof createAntennaDeckOverlay> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const popupAbortRef = useRef<AbortController | null>(null);
  const sitesRef = useRef<AntennaRegisterSiteSummary[]>(sites);
  // Box the current pattern sites cover (and the sync they came from).
  const patternBoxRef = useRef<{ box: Box; syncedAt: number | null; truncated: boolean } | null>(
    null
  );
  // Latest options for the click handler, which the layer binds once.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, band, buildings3D } = opts;
  const { enabled: patternsOn, minZoom, levelDbm } = opts.patterns;
  const shown = useMemo(() => sitesForBand(sites, band), [sites, band]);

  // On each switch-on: show the cached list at once, then refetch only if the
  // backend has synced since (one tiny status call).
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const cached = siteCache;
    // No cache: one request (it carries the sync time). Cached: a status check
    // first, and the list only when a sync happened since.
    const fresh = cached
      ? api
          .getAntennaRegisterStatus()
          .then((status) =>
            status.last_synced_at === cached.syncedAt
              ? null
              : api.getAntennaRegisterAllSites(controller.signal)
          )
      : api.getAntennaRegisterAllSites(controller.signal);
    fresh
      .then((res) => {
        if (!res) return;
        siteCache = { syncedAt: res.syncedAt, sites: res.sites };
        setSites(res.sites);
        setSyncedAt(res.syncedAt);
      })
      .catch((err) => {
        if (!isAbortError(err)) console.error('Failed to load antenna register sites:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [enabled]);

  // The view only matters for patterns; skip the state update (and the MapView
  // re-render) on every pan otherwise.
  const reportView = useCallback((map: MlMap) => {
    const o = optsRef.current;
    if (!o.enabled || !o.patterns.enabled) return;
    const b = map.getBounds();
    setView({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
      zoom: map.getZoom(),
    });
  }, []);

  // Patterns switched on: report the current view (moveend only does it while on).
  useEffect(() => {
    if (enabled && patternsOn && mapRef.current) reportView(mapRef.current);
  }, [enabled, patternsOn, reportView]);

  // Radiation pattern sites for the (padded) view, from the chosen zoom up.
  const patternsActive = enabled && patternsOn && view != null && view.zoom >= minZoom;
  useEffect(() => {
    if (!patternsActive || !view) {
      if (!patternsActive) {
        setPatternSites([]);
        setPatternsTruncated(false);
        patternBoxRef.current = null;
      }
      return;
    }
    const prev = patternBoxRef.current;
    if (prev && !prev.truncated && prev.syncedAt === syncedAt && contains(prev.box, view)) return;
    const box = padBox(view);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .getAntennaRegisterFullSites(box, controller.signal)
        .then((res) => {
          patternBoxRef.current = { box, syncedAt, truncated: res.truncated };
          setPatternSites(res.sites);
          setPatternsTruncated(res.truncated);
        })
        .catch((err) => {
          if (!isAbortError(err)) console.error('Failed to load antenna patterns:', err);
        });
    }, PATTERN_FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [patternsActive, view, syncedAt]);

  const patterns = useMemo(
    () => (patternsActive ? buildPatternPolygons(patternSites, band, levelDbm, buildings3D) : []),
    [patternsActive, patternSites, band, levelDbm, buildings3D]
  );
  // The open popup's site, at any zoom while patterns are on.
  const selectedPatterns = useMemo(
    () =>
      enabled && patternsOn && selectedSite
        ? buildPatternPolygons([selectedSite], band, levelDbm, buildings3D)
        : [],
    [enabled, patternsOn, selectedSite, band, levelDbm, buildings3D]
  );

  const openPopup = useCallback((props: { id: number }, lngLat: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;
    const translate = tRef.current;
    popupAbortRef.current?.abort();
    popupRef.current?.remove();
    const body = document.createElement('div');
    body.className = 'text-sm text-muted-foreground';
    body.textContent = translate('map_antennas_loading');
    const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '320px' })
      .setLngLat(lngLat)
      .setDOMContent(body)
      .addTo(map);
    popup.on('close', () => {
      if (popupRef.current === popup) setSelectedSite(null);
    });
    popupRef.current = popup;
    const controller = new AbortController();
    popupAbortRef.current = controller;
    api
      .getAntennaRegisterSite(props.id, controller.signal)
      .then((site) => {
        const o = optsRef.current;
        if (popupRef.current === popup) setSelectedSite(site);
        popup.setDOMContent(
          buildAntennaSitePopup(site, {
            t: tRef.current,
            band: o.band,
            config: o.config,
            distanceUnit: o.distanceUnit,
            coordinateFormat: o.coordinateFormat,
            levelDbm: o.patterns.enabled ? o.patterns.levelDbm : null,
          })
        );
      })
      .catch((err) => {
        if (!isAbortError(err)) body.textContent = tRef.current('map_antennas_load_failed');
      });
  }, []);

  const closePopup = () => {
    popupAbortRef.current?.abort();
    popupRef.current?.remove();
  };

  // Push data, band and visibility to the GL layer (data only when it changed).
  useEffect(() => {
    sitesRef.current = sites;
    layerRef.current?.setData(sites);
  }, [sites]);
  useEffect(() => {
    layerRef.current?.setBand(band);
    closePopup();
  }, [band]);
  useEffect(() => {
    layerRef.current?.setVisible(enabled);
    if (!enabled) closePopup();
  }, [enabled]);

  // deck.gl masts (3D buildings on) and patterns. The ref lets attach() hand the
  // current state to an overlay created later.
  const deckStateRef = useRef<AntennaDeckState>(EMPTY_ANTENNA_DECK_STATE);
  useEffect(() => {
    deckStateRef.current = {
      band,
      masts: enabled && buildings3D ? shown : [],
      patterns: enabled ? patterns : [],
      selected: selectedPatterns,
    };
    deckRef.current?.set(deckStateRef.current);
  }, [enabled, buildings3D, band, shown, patterns, selectedPatterns]);

  useEffect(
    () => () => {
      closePopup();
      deckRef.current?.destroy();
      deckRef.current = null;
    },
    []
  );

  /** Create the layers on a ready map (call from MapView's handleReady). */
  const attach = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const layer = createAntennaRegisterLayer(map, { onClick: openPopup });
      layer.ensure();
      layer.setData(sitesRef.current);
      layer.setBand(optsRef.current.band);
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
      deckRef.current?.destroy();
      deckRef.current = createAntennaDeckOverlay(map);
      deckRef.current.set(deckStateRef.current);
      reportView(map);
      map.on('moveend', () => reportView(map));
    },
    [openPopup, reportView]
  );

  /** Re-add the GL layer after a basemap style swap (deck.gl re-adds itself). */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(sitesRef.current);
    layer.setBand(optsRef.current.band);
    layer.setVisible(optsRef.current.enabled);
  }, []);

  return {
    attach,
    reattach,
    sites: shown,
    loaded,
    patternCount: patterns.length,
    patternsTruncated,
    patternsBelowZoom: enabled && patternsOn && view != null && view.zoom < minZoom,
  };
}
