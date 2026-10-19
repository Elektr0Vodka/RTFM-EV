// Map "antenna register" layer: registered transmitters from the Dutch
// Antenneregister next to the chosen LoRa mesh band (868: 700/800/900 MHz
// mobile masts; 433: 400-470 MHz PAMR / base stations and licensed amateur
// stations), so a strong one close to a node can desensitise it.
//
// Reads the backend cache (GET /antenna-register/sites), which is only filled
// by a manual sync in Settings. MapView owns the toggle; this hook owns fetch,
// layer and popup.

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
import { appendPopupLine } from './locationPopup';

export interface UseAntennaRegisterOptions {
  enabled: boolean;
  band: AntennaBand;
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

export function useAntennaRegister(opts: UseAntennaRegisterOptions) {
  const t = useT();
  const [sites, setSites] = useState<AntennaRegisterSiteSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const layerRef = useRef<ReturnType<typeof createAntennaRegisterLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const popupAbortRef = useRef<AbortController | null>(null);
  const sitesRef = useRef<AntennaRegisterSiteSummary[]>([]);
  // Latest options for the click handler, which the layer binds once.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, band } = opts;
  const shown = useMemo(() => sitesForBand(sites, band), [sites, band]);

  // Fetch the whole cache each time the layer is switched on (it only changes
  // on a manual sync, so there is nothing to poll for).
  useEffect(() => {
    if (!enabled) {
      setSites([]);
      setLoaded(false);
      return;
    }
    const controller = new AbortController();
    api
      .getAntennaRegisterSites(controller.signal)
      .then((res) => {
        setSites(res.sites);
        setLoaded(true);
      })
      .catch((err) => {
        if (!isAbortError(err)) {
          console.error('Failed to load antenna register sites:', err);
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [enabled]);

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
    popupRef.current = popup;
    const controller = new AbortController();
    popupAbortRef.current = controller;
    api
      .getAntennaRegisterSite(props.id, controller.signal)
      .then((site) => {
        const o = optsRef.current;
        popup.setDOMContent(
          buildAntennaSitePopup(site, {
            t: tRef.current,
            band: o.band,
            config: o.config,
            distanceUnit: o.distanceUnit,
            coordinateFormat: o.coordinateFormat,
          })
        );
      })
      .catch((err) => {
        if (!isAbortError(err)) body.textContent = tRef.current('map_antennas_load_failed');
      });
  }, []);

  // Push data and visibility to the layer.
  useEffect(() => {
    sitesRef.current = shown;
    layerRef.current?.setData(shown, band);
    popupAbortRef.current?.abort();
    popupRef.current?.remove();
  }, [shown, band]);
  useEffect(() => {
    layerRef.current?.setVisible(enabled);
    if (!enabled) {
      popupAbortRef.current?.abort();
      popupRef.current?.remove();
    }
  }, [enabled]);

  useEffect(
    () => () => {
      popupAbortRef.current?.abort();
      popupRef.current?.remove();
    },
    []
  );

  /** Create the layer on a ready map (call from MapView's handleReady). */
  const attach = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const layer = createAntennaRegisterLayer(map, { onClick: openPopup });
      layer.ensure();
      layer.setData(sitesRef.current, optsRef.current.band);
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
    layer.setData(sitesRef.current, optsRef.current.band);
    layer.setVisible(optsRef.current.enabled);
  }, []);

  return { attach, reattach, sites: shown, loaded };
}
