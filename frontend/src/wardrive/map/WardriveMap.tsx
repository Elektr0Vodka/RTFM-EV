// Stored wardrive data on the repo's MiniMap: track lines and reception
// points coloured by RSSI, a tap shows every stored field of a reception;
// on the owner's Tools > Wardrive Map tab also the drivers on the road now.
// Used on the wardrive page (Drives tab) and in Tools > Wardrive.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { useT } from '../../i18n';
import { NODE_LABEL_FONT } from '../../map/layers/nodesLayer';
import { MiniMap } from '../../map/MiniMap';
import { useCoordinateFormat } from '../../utils/coordinateFormat';
import type { WardriveData, WardriveLiveDriver } from '../api';
import { liveGeoJson, receptionDetails } from './details';
import { rssiColor, toGeoJson } from './geo';

const NO_LIVE: WardriveLiveDriver[] = [];
const LIVE_COLOR = '#22c55e';

const LINE_COLOR = '#a78bfa';
const LEGEND: [number | null, string][] = [
  [-75, '≥ -80'],
  [-85, '-80 … -90'],
  [-95, '-90 … -100'],
  [-105, '-100 … -110'],
  [-115, '< -110'],
];

/** `fill`: take the height the parent leaves (a flex column), at least 320 px;
 * otherwise a fixed 320 px box. */
export function WardriveMap({
  data,
  className,
  fill = false,
  live = NO_LIVE,
  focus = null,
}: {
  data: WardriveData;
  className?: string;
  fill?: boolean;
  /** Drivers on the road now (the owner's map). */
  live?: WardriveLiveDriver[];
  /** Fly here; a new nonce flies again to the same place. */
  focus?: { lat: number; lon: number; nonce: number } | null;
}) {
  const t = useT();
  const coords = useCoordinateFormat();
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const geo = useMemo(() => toGeoJson(data), [data]);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const dataRef = useRef(data);
  dataRef.current = data;
  const liveGeo = useMemo(() => liveGeoJson(live), [live]);
  const liveRef = useRef(liveGeo);
  liveRef.current = liveGeo;
  const detailsRef = useRef({ t, coords });
  detailsRef.current = { t, coords };

  const setData = useCallback((map: MlMap, fit: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    m.getSource('wd-lines')?.setData(geoRef.current.lines);
    m.getSource('wd-points')?.setData(geoRef.current.points);
    m.getSource('wd-live-drivers')?.setData(liveRef.current);
    if (fit && geoRef.current.bounds) {
      map.fitBounds(geoRef.current.bounds, { padding: 32, maxZoom: 15, duration: 0 });
    }
  }, []);

  const ensureLayers = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      if (!m.getSource('wd-lines')) {
        m.addSource('wd-lines', { type: 'geojson', data: geoRef.current.lines });
        m.addLayer({
          id: 'wd-lines',
          type: 'line',
          source: 'wd-lines',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': LINE_COLOR, 'line-width': 3, 'line-opacity': 0.75 },
        });
      }
      if (!m.getSource('wd-points')) {
        m.addSource('wd-points', { type: 'geojson', data: geoRef.current.points });
        m.addLayer({
          id: 'wd-points',
          type: 'circle',
          source: 'wd-points',
          paint: {
            'circle-radius': 5,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#111827',
            'circle-stroke-width': 1,
          },
        });
      }
      if (!m.getSource('wd-live-drivers')) {
        m.addSource('wd-live-drivers', { type: 'geojson', data: liveRef.current });
        m.addLayer({
          id: 'wd-live-drivers',
          type: 'circle',
          source: 'wd-live-drivers',
          paint: {
            'circle-radius': 9,
            'circle-color': '#ffffff',
            'circle-stroke-color': LIVE_COLOR,
            'circle-stroke-width': 4,
          },
        });
        m.addLayer({
          id: 'wd-live-labels',
          type: 'symbol',
          source: 'wd-live-drivers',
          layout: {
            'text-field': ['get', 'label'],
            'text-font': NODE_LABEL_FONT,
            'text-size': 13,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#111827',
            'text-halo-width': 1.5,
          },
        });
      }
      setData(map, false);
    },
    [setData]
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      setData(map, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', 'wd-points', (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const row = dataRef.current.obs[Number(f.properties?.i)];
        if (!row) return;
        // Text nodes only: names and ids come from the mesh.
        const { t: tt, coords: fmt } = detailsRef.current;
        const list = document.createElement('dl');
        list.className = 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs';
        for (const d of receptionDetails(row, tt, fmt)) {
          const dt = document.createElement('dt');
          dt.className = 'text-muted-foreground';
          dt.textContent = d.label;
          const dd = document.createElement('dd');
          dd.className = 'break-all';
          dd.textContent = d.value;
          list.append(dt, dd);
        }
        popupRef.current?.remove();
        popupRef.current = new MlPopup({ closeButton: true, offset: 10, maxWidth: '320px' })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setDOMContent(list)
          .addTo(map);
      });
      m.on('mouseenter', 'wd-points', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'wd-points', () => {
        m.getCanvas().style.cursor = '';
      });
    },
    [ensureLayers, setData]
  );

  useEffect(() => {
    if (mapRef.current) setData(mapRef.current, true);
  }, [geo, setData]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mapRef.current as any)?.getSource('wd-live-drivers')?.setData(liveGeo);
  }, [liveGeo]);

  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: 15, duration: 800 });
    }
  }, [focus]);

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    []
  );

  return (
    <div className={`${fill ? 'flex min-h-0 flex-1 flex-col' : ''} ${className ?? ''}`.trim()}>
      <div
        className={`${fill ? 'min-h-80 flex-1' : 'h-80'} overflow-hidden rounded border border-border`}
      >
        <MiniMap
          zoom={11}
          center={[5.3, 52.1]}
          onReady={handleReady}
          ariaLabel={t('wardrive_map_aria')}
          onBasemapReapply={() => {
            if (mapRef.current) ensureLayers(mapRef.current);
          }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('wardrive_map_legend')}</span>
        {LEGEND.map(([sample, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: rssiColor(sample) }}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: rssiColor(null) }}
          />
          {t('wardrive_map_unknown')}
        </span>
      </div>
    </div>
  );
}
